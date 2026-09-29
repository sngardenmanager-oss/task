import {
  apiErrorResponse,
  authenticateRequest,
  requestedTeam,
  requireTeamAccess,
} from '@/lib/auth-server';
import { recordMasterAlert } from '@/lib/master-alerts';

export const dynamic = 'force-dynamic';

/** 직원 화면에서 보고서가 너무 커서 보내기 전에 막혔을 때, 그 사실만 조용히 남깁니다(응답에는 아무 정보도 없음). */
export async function POST(request: Request) {
  try {
    const user = await authenticateRequest(request);
    const { team } = await requireTeamAccess(user.email!, requestedTeam(request));
    const body = (await request.json().catch(() => ({}))) as { bytes?: number };
    await recordMasterAlert({
      kind: 'report_full',
      teamId: team.id,
      bytes: typeof body.bytes === 'number' ? body.bytes : undefined,
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return apiErrorResponse(error, '처리하지 못했습니다.');
  }
}
