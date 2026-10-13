import {
  ApiError,
  apiErrorResponse,
  authenticateRequest,
  isMasterEmail,
  requestedTeam,
  requireTeamAccess,
} from '@/lib/auth-server';
import { PLANNER_URL, plannerTeamId, readPlannerSummary } from '@/lib/planner-sync';
import { getSupabaseAdmin, isSupabaseConfigured } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
const headers = { 'cache-control': 'private, no-store, max-age=0' };

/** 경영플래너가 계산한 '목표 대비 현황'. 마스터, 파크사업팀(관리자·팀원), 경영플래너에서 권한을 받은 사람만 봅니다. */
async function allowed(email: string, request: Request) {
  if (isMasterEmail(email)) return true;
  const { actor, team } = await requireTeamAccess(email, requestedTeam(request));
  if (team.id === plannerTeamId() && actor.role !== 'commenter') return true;
  const { data } = await getSupabaseAdmin().from('planner_access').select('role').eq('email', email.toLowerCase()).maybeSingle();
  return Boolean(data);
}

export async function GET(request: Request) {
  try {
    if (!isSupabaseConfigured()) return Response.json({ summary: null }, { headers });
    const user = await authenticateRequest(request);
    if (!(await allowed(user.email!, request))) throw new ApiError('경영 지표를 볼 권한이 없습니다.', 403);
    return Response.json({ summary: await readPlannerSummary(), plannerUrl: PLANNER_URL }, { headers });
  } catch (error) {
    return apiErrorResponse(error, '경영 현황을 불러오지 못했습니다.');
  }
}
