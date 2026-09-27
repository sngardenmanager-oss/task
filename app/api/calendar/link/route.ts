import {
  apiErrorResponse,
  authenticateRequest,
  requireWorkspaceMember,
} from '@/lib/auth-server';
import { calendarFeedToken } from '@/lib/calendar-feed';
import { readWorkspaceState } from '@/lib/workspace-store';

export const dynamic = 'force-dynamic';

/** 로그인한 사용자 본인의 구글 캘린더 구독 주소를 돌려줍니다. */
export async function GET(request: Request) {
  try {
    const [user, state] = await Promise.all([
      authenticateRequest(request),
      readWorkspaceState(),
    ]);
    const actor = requireWorkspaceMember(state, user.email!);
    const url = new URL('/api/calendar/feed', request.url);
    url.searchParams.set('m', actor.id);
    url.searchParams.set('t', calendarFeedToken(actor.id));
    return Response.json(
      { url: url.toString() },
      { headers: { 'cache-control': 'private, no-store, max-age=0' } },
    );
  } catch (error) {
    return apiErrorResponse(error, '구독 링크를 만들지 못했습니다.');
  }
}
