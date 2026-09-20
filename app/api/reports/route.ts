import {
  ApiError,
  apiErrorResponse,
  authenticateRequest,
  requireWorkspaceMember,
} from '@/lib/auth-server';
import { getSupabaseAdmin, isSupabaseConfigured } from '@/lib/supabase-server';
import { readWorkspaceState } from '@/lib/workspace-store';
import {
  emptyReportStore,
  reportValidation,
  validateStatistic,
  sameReportValue,
} from '@/lib/reports';
import type { ReportStore } from '@/lib/report-types';

export const dynamic = 'force-dynamic';
const headers = { 'cache-control': 'private, no-store, max-age=0' };
async function context(request: Request) {
  const user = await authenticateRequest(request);
  const workspace = await readWorkspaceState();
  const actor = requireWorkspaceMember(workspace, user.email!);
  // Revenue and executive reports are available to report authors and admins.
  if (actor.role === 'commenter')
    throw new ApiError(
      '보고서는 업무 작성자와 관리자만 이용할 수 있습니다.',
      403,
    );
  if (!isSupabaseConfigured())
    throw new ApiError('보고서 서버 저장소가 설정되지 않았습니다.', 503);
  return actor;
}
function storeError(message: string): never {
  console.error('Reports storage:', message);
  throw new ApiError(
    '보고서 저장소를 사용할 수 없습니다. 데이터베이스 연결과 보고서 테이블을 확인해 주세요.',
    503,
  );
}
export async function GET(request: Request) {
  try {
    const actor = await context(request);
    const { data, error } = await getSupabaseAdmin()
      .from('weekly_report_state')
      .select('version,payload')
      .eq('owner_id', actor.id)
      .maybeSingle();
    if (error) storeError(error.message);
    return Response.json(
      {
        store: data?.payload ?? emptyReportStore(),
        version: data?.version ?? 0,
      },
      { headers },
    );
  } catch (error) {
    return apiErrorResponse(error, '보고서를 불러오지 못했습니다.');
  }
}
export async function PUT(request: Request) {
  try {
    const actor = await context(request);
    const body = await request.text();
    if (body.length > 12_000_000)
      throw new ApiError('보고서 저장량이 요청 한도를 넘었습니다.', 413);
    const input = JSON.parse(body) as { version: number; store: ReportStore };
    const store = input.store;
    if (
      !store ||
      !Number.isInteger(input.version) ||
      !Array.isArray(store.reports) ||
      !Array.isArray(store.tracks) ||
      !Array.isArray(store.statistics) ||
      !Array.isArray(store.imports) ||
      !store.archiveLinks
    )
      throw new ApiError('보고서 데이터 형식이 올바르지 않습니다.', 400);
    if (new Set(store.reports.map((r) => r.id)).size !== store.reports.length)
      throw new ApiError('보고서 번호가 중복되었습니다.', 400);
    for (const report of store.reports) {
      if (report.ownerId !== actor.id)
        throw new ApiError('본인이 작성한 보고서만 저장할 수 있습니다.', 403);
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
    const db = getSupabaseAdmin();
    const { data: before, error: readError } = await db
      .from('weekly_report_state')
      .select('version,payload')
      .eq('owner_id', actor.id)
      .maybeSingle();
    if (readError) storeError(readError.message);
    if ((before?.version ?? 0) !== input.version)
      throw new ApiError(
        '다른 창에서 변경되었습니다. 현재 작성 내용은 유지됩니다. 서버 자료를 다시 불러온 뒤 반영해 주세요.',
        409,
      );
    for (const report of (before?.payload as ReportStore | undefined)
      ?.reports ?? [])
      if (
        report.status === 'final' &&
        !sameReportValue(
          report,
          store.reports.find((r) => r.id === report.id),
        )
      )
        throw new ApiError(
          '확정본은 변경하거나 삭제할 수 없습니다. 수정본을 작성해 주세요.',
          409,
        );
    const version = input.version + 1;
    const value = {
      owner_id: actor.id,
      version,
      payload: store,
      updated_at: new Date().toISOString(),
    };
    if (!before) {
      const { error } = await db.from('weekly_report_state').insert(value);
      if (error?.code === '23505')
        throw new ApiError(
          '다른 창에서 먼저 저장했습니다. 다시 불러와 주세요.',
          409,
        );
      if (error) storeError(error.message);
    } else {
      const { data, error } = await db
        .from('weekly_report_state')
        .update(value)
        .eq('owner_id', actor.id)
        .eq('version', input.version)
        .select('version')
        .maybeSingle();
      if (error) storeError(error.message);
      if (!data)
        throw new ApiError(
          '동시에 수정된 자료가 있습니다. 다시 불러와 주세요.',
          409,
        );
    }
    return Response.json({ version, store }, { headers });
  } catch (error) {
    if (error instanceof SyntaxError)
      return Response.json(
        { error: '올바른 JSON 데이터가 필요합니다.' },
        { status: 400 },
      );
    return apiErrorResponse(error, '보고서를 저장하지 못했습니다.');
  }
}
