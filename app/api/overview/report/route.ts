import {
  ApiError,
  apiErrorResponse,
  authenticateRequest,
  requireMaster,
} from '@/lib/auth-server';
import {
  autoTeamRows,
  combinedWeek,
  countOverdue,
  pickWeekReport,
  reportRows,
  type CombinedTeamReport,
} from '@/lib/combined-report';
import { listCompanyEvents } from '@/lib/company-events-store';
import type { ReportStore } from '@/lib/report-types';
import { todayKst } from '@/lib/reports';
import { getSupabaseAdmin, isSupabaseConfigured } from '@/lib/supabase-server';
import { reportOwnerFor } from '@/lib/team-access';
import { listTeams } from '@/lib/team-store';
import { readAllWorkspaces } from '@/lib/workspace-store';

export const dynamic = 'force-dynamic';
const headers = { 'cache-control': 'private, no-store, max-age=0' };

async function readReportStores(owners: string[]) {
  if (!isSupabaseConfigured() || !owners.length) return new Map<string, ReportStore>();
  const { data, error } = await getSupabaseAdmin()
    .from('weekly_report_state')
    .select('owner_id,payload')
    .in('owner_id', owners);
  if (error) throw new Error(`Supabase report read failed: ${error.message}`);
  return new Map(
    (data as { owner_id: string; payload: ReportStore }[]).map((row) => [
      row.owner_id,
      row.payload,
    ]),
  );
}

/** 마스터 전용 전체 팀 통합 보고서. ?meetingDate=YYYY-MM-DD (기본: 오늘) */
export async function GET(request: Request) {
  try {
    const user = await authenticateRequest(request);
    requireMaster(user.email!);
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
      readReportStores(teams.map((team) => reportOwnerFor(team.id))),
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
    return Response.json(
      {
        week,
        teams,
        reports,
        companyEvents,
      },
      { headers },
    );
  } catch (error) {
    return apiErrorResponse(error, '통합 보고서를 만들지 못했습니다.');
  }
}
