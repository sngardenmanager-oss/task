import {
  ApiError,
  apiErrorResponse,
  authenticateRequest,
  requestedTeam,
  requireTeamAccess,
} from '@/lib/auth-server';
import { getSupabaseAdmin, isSupabaseConfigured } from '@/lib/supabase-server';
import { recordMasterAlert } from '@/lib/master-alerts';
import { pruneImportHistory, REQUEST_LIMIT_BYTES } from '@/lib/retention';
import { LEGACY_TEAM_ID, reportOwnerFor } from '@/lib/team-access';
import { reportValidation, validateStatistic, sameReportValue } from '@/lib/reports';
import { reportLocked, transitionReport, WorkflowError, workflowActionLabels, type WorkflowInput } from '@/lib/report-workflow';
import {
  migrateOwnerStores,
  mergeSharedStore,
  ReportShareError,
  TEAM_REPORT_OWNER,
  type ReportSaveBases,
} from '@/lib/report-share';
import type { ReportStore } from '@/lib/report-types';
import { validateJejuStore } from '@/lib/jeju-arrivals';

export const dynamic = 'force-dynamic';
const headers = { 'cache-control': 'private, no-store, max-age=0' };
async function context(request: Request) {
  const user = await authenticateRequest(request);
  const { actor, team, state } = await requireTeamAccess(
    user.email!,
    requestedTeam(request),
  );
  // Revenue and executive reports are available to report authors and admins.
  if (actor.role === 'commenter')
    throw new ApiError(
      '보고서는 업무 작성자와 관리자만 이용할 수 있습니다.',
      403,
    );
  if (!isSupabaseConfigured())
    throw new ApiError('보고서 서버 저장소가 설정되지 않았습니다.', 503);
  return { actor, teamId: team.id, state };
}
function storeError(message: string): never {
  console.error('Reports storage:', message);
  throw new ApiError(
    '보고서 저장소를 사용할 수 없습니다. 데이터베이스 연결과 보고서 테이블을 확인해 주세요.',
    503,
  );
}
type StoredRow = { owner_id: string; version: number; payload: ReportStore; updated_at?: string };

/** 팀 공용 보고서 저장소를 읽습니다. 팀마다 한 행입니다(파크사업팀은 기존 TEAM_REPORT_OWNER 행).
 * 파크사업팀은 처음 한 번 예전 작성자별 저장소를 합쳐 만듭니다(예전 행은 그대로 둔다). 새 팀은 빈 저장소로 시작합니다. */
async function readTeamStore(
  teamId: string,
): Promise<{ version: number; store: ReportStore }> {
  const db = getSupabaseAdmin();
  const owner = reportOwnerFor(teamId);
  const { data, error } = await db
    .from('weekly_report_state')
    .select('owner_id,version,payload')
    .eq('owner_id', owner)
    .maybeSingle<StoredRow>();
  if (error) storeError(error.message);
  if (data) return { version: data.version, store: data.payload };
  let legacy: StoredRow[] = [];
  if (teamId === LEGACY_TEAM_ID) {
    const { data: legacyRows, error: legacyError } = await db
      .from('weekly_report_state')
      .select('owner_id,version,payload,updated_at')
      .neq('owner_id', TEAM_REPORT_OWNER)
      .not('owner_id', 'like', 'team:%');
    if (legacyError) storeError(legacyError.message);
    legacy = (legacyRows ?? []) as StoredRow[];
  }
  const store = migrateOwnerStores(legacy);
  const { error: insertError } = await db.from('weekly_report_state').insert({
    owner_id: owner,
    version: 1,
    payload: store,
    updated_at: new Date().toISOString(),
  });
  // 동시에 다른 요청이 먼저 만들었으면 그 값을 다시 읽는다.
  if (insertError?.code === '23505') return readTeamStore(teamId);
  if (insertError) storeError(insertError.message);
  return { version: 1, store };
}

export async function GET(request: Request) {
  try {
    const { teamId } = await context(request);
    const { version, store } = await readTeamStore(teamId);
    return Response.json({ store, version }, { headers });
  } catch (error) {
    return apiErrorResponse(error, '보고서를 불러오지 못했습니다.');
  }
}

function validateStore(store: ReportStore) {
  if (new Set(store.reports.map((r) => r.id)).size !== store.reports.length)
    throw new ApiError('보고서 번호가 중복되었습니다.', 400);
  const jejuIssue = validateJejuStore(store);
  if (jejuIssue) throw new ApiError(jejuIssue, 400);
  for (const report of store.reports) {
    const issue = reportValidation(report);
    if (issue) throw new ApiError(issue, 400);
    if (
      !['draft', 'final'].includes(report.status) ||
      report.templateVersion !== 1
    )
      throw new ApiError('지원하지 않는 보고서 형식입니다.', 400);
  }
  if (
    new Set(store.statistics.map((s) => s.date)).size !==
      store.statistics.length ||
    store.statistics.some((s) => validateStatistic(s).length)
  )
    throw new ApiError('통계 날짜 또는 값을 확인해 주세요.', 400);
  for (const link of Object.values(store.archiveLinks))
    if (typeof link !== 'string' || (link && !/^https?:\/\//i.test(link)))
      throw new ApiError('외부 보관 링크 형식을 확인해 주세요.', 400);
}

/** 저장은 팀 저장소 전체를 덮어쓰지 않고, 요청자가 바꾼 부분만 최신 서버 값에 병합한다.
 * 그 사이 다른 사람이 저장해 버전이 바뀌었으면 다시 읽어 병합을 반복한다. */
export async function PUT(request: Request) {
  try {
    const { actor, teamId } = await context(request);
    const body = await request.text();
    // 서버가 한 번에 받을 수 있는 양(4.5MB)보다 조금 낮은 4MB를 바이트 기준으로 확인합니다.
    // 막히면 직원에게는 일반 안내만 하고, 마스터에게만 알림을 남깁니다.
    const bytes = Buffer.byteLength(body, 'utf8');
    if (bytes > REQUEST_LIMIT_BYTES) {
      await recordMasterAlert({ kind: 'report_full', teamId, bytes });
      throw new ApiError(
        '보고서 저장 공간이 부족해 지금은 저장하지 못했습니다. 작성한 내용은 화면에 그대로 있으니 잠시 후 다시 저장해 주세요.',
        413,
      );
    }
    const input = JSON.parse(body) as {
      version: number;
      store: ReportStore;
      bases?: ReportSaveBases;
    };
    const incoming = input.store;
    if (
      !incoming ||
      !Array.isArray(incoming.reports) ||
      !Array.isArray(incoming.tracks) ||
      !Array.isArray(incoming.statistics) ||
      !Array.isArray(incoming.imports) ||
      !incoming.archiveLinks
    )
      throw new ApiError('보고서 데이터 형식이 올바르지 않습니다.', 400);
    const db = getSupabaseAdmin();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const before = await readTeamStore(teamId);
      for (const candidate of incoming.reports) {
        if (input.bases?.reports && !(candidate.id in input.bases.reports)) continue;
        const current = before.store.reports.find(report => report.id === candidate.id);
        if (current && sameReportValue(current, candidate)) continue;
        if (candidate.status === 'final' || (current && reportLocked(current)))
          throw new ApiError('제출·확정된 보고서는 수정할 수 없습니다. 보완 요청 또는 정정본을 이용해 주세요.', 409);
        if (!sameReportValue(candidate.workflow, current?.workflow))
          throw new ApiError('보고 처리 이력은 공식 제출·검토 기능으로만 변경할 수 있습니다.', 403);
        if (current && input.bases?.reports?.[candidate.id] && !sameReportValue(current, input.bases.reports[candidate.id]))
          throw new ApiError('다른 사람이 이 보고서를 수정했습니다. 현재 내용을 복사해 둔 뒤 최신 보고서를 불러와 비교해 주세요.', 409);
      }
      let store: ReportStore;
      try {
        // CSV·입도객 업로드는 최근 1건만 되돌리기 복사본을 남깁니다.
        store = pruneImportHistory(
          mergeSharedStore(before.store, incoming, input.bases ?? {}, actor),
        );
      } catch (error) {
        if (error instanceof ReportShareError)
          throw new ApiError(error.message, error.status);
        throw error;
      }
      validateStore(store);
      const version = before.version + 1;
      const { data, error } = await db
        .from('weekly_report_state')
        .update({
          version,
          payload: store,
          audit_context: { id: actor.id, name: actor.name, role: actor.role, requestId: crypto.randomUUID(), action: '보고 저장' },
          updated_at: new Date().toISOString(),
        })
        .eq('owner_id', reportOwnerFor(teamId))
        .eq('version', before.version)
        .select('version')
        .maybeSingle();
      if (error) storeError(error.message);
      if (data) return Response.json({ version, store }, { headers });
    }
    throw new ApiError(
      '여러 사람이 동시에 저장하고 있습니다. 잠시 후 다시 저장해 주세요.',
      409,
    );
  } catch (error) {
    if (error instanceof SyntaxError)
      return Response.json(
        { error: '올바른 JSON 데이터가 필요합니다.' },
        { status: 400 },
      );
    return apiErrorResponse(error, '보고서를 저장하지 못했습니다.');
  }
}

/** Official transitions are server-authenticated and recorded atomically by the DB trigger. */
export async function POST(request: Request) {
  try {
    const { actor, teamId, state } = await context(request);
    const input = await request.json() as WorkflowInput & { reportId: string };
    if (!input || typeof input.reportId !== 'string') throw new ApiError('보고서를 선택해 주세요.', 400);
    const before = await readTeamStore(teamId);
    const report = before.store.reports.find(item => item.id === input.reportId);
    if (!report) throw new ApiError('보고서 초안을 먼저 저장해 주세요.', 404);
    const members = state.members.some(member => member.id === actor.id) ? state.members : [...state.members, actor];
    let next;
    try { next = transitionReport(report, input, actor, { ...state, members }, before.store); }
    catch (error) { if (error instanceof WorkflowError) throw new ApiError(error.message, error.status); throw error; }
    if (next === report) return Response.json({ ...before }, { headers });
    const store = { ...before.store, reports: before.store.reports.map(item => item.id === next.id ? next : item) };
    const version = before.version + 1;
    const { data, error } = await getSupabaseAdmin().from('weekly_report_state').update({
      version, payload: store, updated_at: new Date().toISOString(),
      audit_context: { id: actor.id, name: actor.name, role: actor.role, requestId: input.requestId, action: workflowActionLabels[input.action], note: input.note?.slice(0, 4000) ?? '' },
    }).eq('owner_id', reportOwnerFor(teamId)).eq('version', before.version).select('version').maybeSingle();
    if (error) storeError(error.message);
    if (!data) throw new ApiError('다른 저장과 겹쳤습니다. 최신 보고서를 확인한 뒤 다시 처리해 주세요.', 409);
    return Response.json({ version, store }, { headers });
  } catch (error) { return apiErrorResponse(error, '보고 처리를 저장하지 못했습니다.'); }
}
