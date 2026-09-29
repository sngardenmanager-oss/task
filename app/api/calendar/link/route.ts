import {
  apiErrorResponse,
  authenticateRequest,
  requestedTeam,
  requireTeamAccess,
} from '@/lib/auth-server';
import { teamCalendarFeedToken } from '@/lib/calendar-feed';
import { ALL_TEAMS_ID } from '@/lib/team-access';

export const dynamic = 'force-dynamic';

/** 로그인한 사용자 본인의 구글 캘린더 구독 주소를 돌려줍니다.
 * 링크에는 팀이 서명되어 있어 그 팀 업무만 나옵니다. 마스터는 ?team=__all__로 전체 팀 링크를 받습니다. */
export async function GET(request: Request) {
  try {
    const user = await authenticateRequest(request);
    const requested = requestedTeam(request);
    const wantsAll = requested === ALL_TEAMS_ID;
    const { actor, team, isMaster } = await requireTeamAccess(
      user.email!,
      wantsAll ? null : requested,
    );
    const teamId = wantsAll && isMaster ? ALL_TEAMS_ID : team.id;
    const memberId = isMaster ? 'master' : actor.id;
    const url = new URL('/api/calendar/feed', request.url);
    url.searchParams.set('g', teamId);
    url.searchParams.set('m', memberId);
    url.searchParams.set('t', teamCalendarFeedToken(teamId, memberId));
    return Response.json(
      { url: url.toString() },
      { headers: { 'cache-control': 'private, no-store, max-age=0' } },
    );
  } catch (error) {
    return apiErrorResponse(error, '구독 링크를 만들지 못했습니다.');
  }
}
