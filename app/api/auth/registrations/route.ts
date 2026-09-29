import {
  ApiError,
  apiErrorResponse,
  authenticateRequest,
  isMasterEmail,
  requestedTeam,
  requireTeamAccess,
} from '@/lib/auth-server';
import { listPendingRegistrations } from '@/lib/registration-requests';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { approvalProblem } from '@/lib/team-access';
import { placeMemberInTeam } from '@/lib/team-members';
import { deleteMembership, listMemberships } from '@/lib/team-store';
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

/** 가입 대기 계정 또는 퇴사·내보낸 계정을 완전히 삭제합니다(로그인 계정 자체 삭제).
 * 삭제하면 같은 이메일로 다시 가입할 수 있고, 다시 가입하면 가입 대기 목록에 나옵니다.
 * 팀에 소속된(활성) 계정은 먼저 내보내야 합니다. 팀 관리자는 자기 팀의 퇴사자와 무소속 대기자만 지울 수 있습니다.
 * ?id=<로그인 계정 id> 또는 ?email=<이메일> */
export async function DELETE(request: Request) {
  try {
    const context = await requireApprover(request);
    const params = new URL(request.url).searchParams;
    const id = params.get('id')?.trim();
    const email = params.get('email')?.trim().toLowerCase();
    if (!id && !email) throw new ApiError('삭제할 계정을 확인해 주세요.', 400);

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) throw new Error(`Supabase auth users read failed: ${error.message}`);
    const authUser = data.users.find((user) =>
      id ? user.id === id : user.email?.toLowerCase() === email,
    );
    const targetEmail = (authUser?.email ?? email ?? '').toLowerCase();
    if (!targetEmail) throw new ApiError('계정을 찾을 수 없습니다.', 404);
    if (isMasterEmail(targetEmail) || targetEmail === context.actor.email.toLowerCase())
      throw new ApiError('이 계정은 삭제할 수 없습니다.', 400);

    const memberships = await listMemberships({ email: targetEmail });
    if (memberships.some((item) => item.active))
      throw new ApiError('팀에 소속된 계정입니다. 먼저 팀에서 내보내 주세요.', 409);
    if (
      !context.isMaster &&
      memberships.some((item) => item.teamId !== context.team.id)
    )
      throw new ApiError('이 팀의 계정만 삭제할 수 있습니다.', 403);

    if (authUser) {
      const { error: deleteError } = await supabase.auth.admin.deleteUser(authUser.id);
      if (deleteError)
        throw new Error(`Supabase auth user delete failed: ${deleteError.message}`);
    }
    // 퇴사 기록(비활성 소속)도 지워 다시 가입하면 대기 목록에 나오게 합니다. 과거 업무 기록은 팀 데이터에 그대로 남습니다.
    for (const item of memberships) await deleteMembership(item.teamId, targetEmail);

    const registrations = await listPendingRegistrations();
    return Response.json(
      { registrations },
      { headers: { 'cache-control': 'private, no-store, max-age=0' } },
    );
  } catch (error) {
    return apiErrorResponse(error, '계정을 삭제하지 못했습니다.');
  }
}
