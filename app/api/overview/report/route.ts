import {
  ApiError,
  apiErrorResponse,
  authenticateRequest,
  requireMaster,
} from '@/lib/auth-server';
import { createHash } from 'node:crypto';
import {
  autoTeamRows,
  combinedWeek,
  countOverdue,
  pickWeekReport,
  reportRows,
  type CombinedWeek,
  type CombinedTeamReport,
} from '@/lib/combined-report';
import { listCompanyEvents } from '@/lib/company-events-store';
import type { ReportDocument, ReportStore } from '@/lib/report-types';
import { todayKst } from '@/lib/reports';
import { getSupabaseAdmin, isSupabaseConfigured } from '@/lib/supabase-server';
import { reportOwnerFor } from '@/lib/team-access';
import { listTeams } from '@/lib/team-store';
import { readAllWorkspaces } from '@/lib/workspace-store';

export const dynamic = 'force-dynamic';
const headers = { 'cache-control': 'private, no-store, max-age=0' };

async function readReportStores(owners: string[], week: CombinedWeek) {
  if (!isSupabaseConfigured() || !owners.length) return new Map<string, ReportStore>();
  const { data, error } = await getSupabaseAdmin()
    .from('weekly_report_state')
    .select('owner_id,payload')
    .in('owner_id', owners);
  if (error) throw new Error(`Supabase report read failed: ${error.message}`);
  const stores = new Map<string, ReportStore>(
    (data as { owner_id: string; payload: ReportStore }[]).map((row) => [
      row.owner_id,
      row.payload,
    ]),
  );
  // 정기 정리로 활성 목록에서 빠진 확정본도 당시 회의 자료에 포함합니다.
  let offset = 0;
  for (;;) {
    const { data: archived, error: archiveError } = await getSupabaseAdmin()
      .from('report_archive').select('owner_id,payload').in('owner_id', owners)
      .gte('payload->config->>meetingDate', week.planStart)
      .lte('payload->config->>meetingDate', week.planEnd)
      .order('owner_id').order('report_id').range(offset, offset + 199);
    if (archiveError) throw archiveError;
    for (const row of (archived ?? []) as { owner_id: string; payload: ReportDocument }[]) {
      const store = stores.get(row.owner_id) ?? { reports: [], tracks: [], statistics: [], imports: [], archiveLinks: {} };
      if (!store.reports.some(report => report.id === row.payload.id)) store.reports.push(row.payload);
      stores.set(row.owner_id, store);
    }
    if (!archived || archived.length < 200) break;
    offset += archived.length;
  }
  return stores;
}

/** 마스터 전용 전체 팀 통합 보고서. ?meetingDate=YYYY-MM-DD (기본: 오늘) */
export async function GET(request: Request) {
  try {
    const user = await authenticateRequest(request);
    requireMaster(user.email!);
    const params = new URL(request.url).searchParams;
    if (params.has('archive')) {
      let query = getSupabaseAdmin().from('meeting_records').select(params.get('id') ? '*' : 'id,meeting_date,actor,note,recorded_at');
      if (params.get('id')) query = query.eq('id', params.get('id')!);
      const { data, error } = await query.order('recorded_at', { ascending: false }).limit(50);
      if (error) throw error;
      return Response.json({ items: data }, { headers });
    }
    const meetingDate =
      new URL(request.url).searchParams.get('meetingDate') || todayKst();
    let week;
    try {
      week = combinedWeek(meetingDate);
    } catch (error) {
      throw new ApiError(error instanceof Error ? error.message : '날짜 오류', 400);
    }
    const teams = (await listTeams()).filter((team) => team.active);
    const [workspaces, stores, events] = await Promise.all([
      readAllWorkspaces(),
      readReportStores(teams.map((team) => reportOwnerFor(team.id)), week),
      listCompanyEvents().catch(() => []),
    ]);
    const today = todayKst();
    const reports: CombinedTeamReport[] = teams.map((team) => {
      const state = workspaces.get(team.id);
      const overdue = state ? countOverdue(state, today) : 0;
      const report = pickWeekReport(stores.get(reportOwnerFor(team.id)) ?? null, week);
      if (report)
        return {
          teamId: team.id,
          source: report.status === 'final' ? 'final' : 'draft',
          reportId: report.id,
          revision: report.revision,
          reportTitle: report.config.title,
          author: report.config.author,
          updatedAt: report.finalizedAt ?? report.updatedAt,
          ...reportRows(report),
          overdue,
        };
      const rows = state ? autoTeamRows(state, week) : { before: [], after: [] };
      return { teamId: team.id, source: 'auto', ...rows, overdue };
    });
    const companyEvents = events.filter(
      (event) =>
        event.date <= week.planEnd && (event.endDate ?? event.date) >= week.actualStart,
    );
    const payload = {
        week,
        teams,
        reports,
        companyEvents,
      };
    return Response.json({ ...payload, fingerprint: createHash('sha256').update(JSON.stringify(payload)).digest('hex') }, { headers });
  } catch (error) {
    return apiErrorResponse(error, '통합 보고서를 만들지 못했습니다.');
  }
}

export async function POST(request: Request) {
  try {
    const user = await authenticateRequest(request); requireMaster(user.email!);
    const input = await request.json() as { id: string; meetingDate: string; fingerprint: string; note: string };
    if (!input || !/^[a-zA-Z0-9_-]{8,100}$/.test(input.id ?? '') || typeof input.note !== 'string' || input.note.length > 4000) throw new ApiError('회의 정보와 사유를 확인해 주세요.', 400);
    const db = getSupabaseAdmin();
    const { data: existing } = await db.from('meeting_records').select('*').eq('id', input.id).maybeSingle();
    if (existing) return Response.json({ item: existing }, { headers });
    const url = new URL(request.url); url.search = new URLSearchParams({ meetingDate: input.meetingDate }).toString();
    const response = await GET(new Request(url, { headers: request.headers }));
    const payload = await response.json() as { error?: string; fingerprint: string; reports: CombinedTeamReport[] };
    if (!response.ok) throw new ApiError(payload.error ?? '회의 자료 조회 실패', response.status);
    if (payload.fingerprint !== input.fingerprint) throw new ApiError('회의 자료가 변경됐습니다. 새로고침 후 다시 확인해 주세요.', 409);
    if (payload.reports.some(report => report.source !== 'final') && !input.note.trim()) throw new ApiError('미확정 팀이 있습니다. 예외 확정 사유를 입력해 주세요.', 400);
    const { data, error } = await db.from('meeting_records').insert({ id: input.id, meeting_date: input.meetingDate, payload, actor: { id: user.id, name: user.email }, note: input.note.trim() }).select('*').single();
    if (error) throw error;
    return Response.json({ item: data }, { headers });
  } catch(error) { return apiErrorResponse(error, '통합 회의본을 확정하지 못했습니다.'); }
}
