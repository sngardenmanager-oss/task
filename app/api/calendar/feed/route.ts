import { isValidCalendarFeedToken } from '@/lib/calendar-feed';
import { buildCalendarIcs } from '@/lib/ical';
import { readWorkspaceState } from '@/lib/workspace-store';

export const dynamic = 'force-dynamic';

/** 구글 캘린더 등 외부 캘린더가 주기적으로 읽어 가는 iCalendar 구독 피드입니다.
 * 로그인 대신 /api/calendar/link가 발급한 서명 토큰으로 확인하며, 활성 사용자만 받을 수 있습니다. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const memberId = searchParams.get('m') ?? '';
  const token = searchParams.get('t') ?? '';
  try {
    if (!memberId || !token || !isValidCalendarFeedToken(memberId, token))
      return new Response('Not found', { status: 404 });
    const state = await readWorkspaceState();
    const member = state.members.find((item) => item.id === memberId);
    if (!member?.active) return new Response('Not found', { status: 404 });
    return new Response(buildCalendarIcs(state, '스누피가든 업무캘린더'), {
      headers: {
        'content-type': 'text/calendar; charset=utf-8',
        'content-disposition': 'inline; filename="snoopygarden-work.ics"',
        'cache-control': 'private, max-age=300',
      },
    });
  } catch (error) {
    console.error('Calendar feed:', error);
    return new Response('Calendar unavailable', { status: 503 });
  }
}
