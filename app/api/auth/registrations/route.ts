import {
  ApiError,
  apiErrorResponse,
  authenticateRequest,
  requestedTeam,
  requireTeamAccess,
} from '@/lib/auth-server';
import { listPendingRegistrations } from '@/lib/registration-requests';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { approvalProblem } from '@/lib/team-access';
import { placeMemberInTeam } from '@/lib/team-members';
import type { Role } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** 가입 승인은 마스터와 팀 관리자만 합니다. 팀 관리자는 자기 팀으로만 승인합니다. */
async function requireApprover(request: Request) {
  const user = await authenticateRequest(request);
  const context = await requireTeamAccess(user.email!, requestedTeam(request));
  if (!context.isMaster && context.actor.role !== 'admin')
    throw new ApiError('가입 승인은 관리자만 처리할 수 있습니다.', 403);
  return context;
}

export async function GET(request: Request) {
  try {
    await requireApprover(request);
    const registrations = await listPendingRegistrations();
    return Response.json(
      { registrations },
      { headers: { 'cache-control': 'private, no-store, max-age=0' } },
    );
  } catch (error) {
    return apiErrorResponse(error, '가입 대기 목록을 불러오지 못했습니다.');
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await requireApprover(request);
    const body = (await request.json()) as {
      id?: string;
      role?: Role;
      teamId?: string;
    };
    const id = body.id?.trim();
    const teamId = body.teamId?.trim() || context.team.id;
    const role = body.role;
    if (!id || !role) {
      throw new ApiError('승인할 계정, 팀, 권한을 확인해 주세요.', 400);
    }
    const problem = approvalProblem({
      isMaster: context.isMaster,
      actorRole: context.actor.role,
      actorTeamId: context.team.id,
      targetTeamId: teamId,
      role,
    });
    if (problem) throw new ApiError(problem, 403);

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.auth.admin.getUserById(id);
    const authUser = data.user;
    if (error || !authUser?.email)
      throw new ApiError('가입 신청 계정을 찾지 못했습니다.', 404);

    const email = authUser.email.trim().toLowerCase();
    const pending = await listPendingRegistrations();
    if (!pending.some((item) => item.id === authUser.id))
      throw new ApiError('이미 팀에 소속되었거나 승인할 수 없는 계정입니다.', 409);

    const displayName = authUser.user_metadata?.display_name;
    const name =
      typeof displayName === 'string' && displayName.trim()
        ? displayName.trim()
        : email.split('@')[0];

    if (!authUser.email_confirmed_at) {
      const { error: confirmError } = await supabase.auth.admin.updateUserById(
        id,
        { email_confirm: true },
      );
      if (confirmError)
        throw new Error(
          `Supabase email confirmation failed: ${confirmError.message}`,
        );
    }

    let member;
    try {
      member = await placeMemberInTeam(teamId, {
        memberId: `member-${authUser.id}`,
        name,
        email,
        role,
      });
    } catch (placeError) {
      if (
        placeError instanceof Error &&
        !placeError.message.startsWith('Supabase')
      )
        throw new ApiError(placeError.message, 409);
      throw placeError;
    }

    const registrations = await listPendingRegistrations();
    return Response.json(
      { member, teamId, registrations },
      { headers: { 'cache-control': 'private, no-store, max-age=0' } },
    );
  } catch (error) {
    return apiErrorResponse(error, '가입 승인을 완료하지 못했습니다.');
  }
}
