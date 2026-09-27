import { createHmac, timingSafeEqual } from 'node:crypto';

/** 구글 캘린더 구독 링크용 토큰입니다. 로그인 헤더를 보낼 수 없는 외부 캘린더를 위해
 * 사용자 id를 서버 비밀값으로 서명해 링크에 넣습니다. 따로 저장하지 않으므로 같은 사용자는
 * 항상 같은 링크를 받습니다. 링크를 막으려면 사용자를 비활성화하거나 CALENDAR_FEED_SECRET을 바꿉니다. */
function feedSecret() {
  const secret =
    process.env.CALENDAR_FEED_SECRET ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error('캘린더 구독 서명 키가 설정되지 않았습니다.');
  return secret;
}

export function calendarFeedToken(memberId: string) {
  return createHmac('sha256', feedSecret())
    .update(`calendar-feed:v1:${memberId}`)
    .digest('base64url')
    .slice(0, 32);
}

export function isValidCalendarFeedToken(memberId: string, token: string) {
  const expected = Buffer.from(calendarFeedToken(memberId));
  const received = Buffer.from(token);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
