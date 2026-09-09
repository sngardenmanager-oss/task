import { ApiError, apiErrorResponse, authenticateRequest, requireWorkspaceMember } from '@/lib/auth-server';
import { listPendingRegistrations } from '@/lib/registration-requests';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { readWorkspaceState, writeWorkspaceState } from '@/lib/workspace-store';
import type { Member, Role } from '@/lib/types';

export const dynamic = 'force-dynamic';

async function requireAdmin(request: Request) {
  const user = await authenticateRequest(request);
  const state = await readWorkspaceState();
  const actor = requireWorkspaceMember(state, user.email!);
  if (actor.role !== 'admin') throw new ApiError('가입 승인은 관리자만 처리할 수 있습니다.', 403);
  return { state };
}

export async function GET(request: Request) {
  try {
    const { state } = await requireAdmin(request);
    const registrations = await listPendingRegistrations(state);
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
    const { state } = await requireAdmin(request);
    const body = (await request.json()) as { id?: string; role?: Role; team?: string };
    const id = body.id?.trim();
    const team = body.team?.trim();
    const role = body.role;
    if (!id || !team || (role !== 'member' && role !== 'commenter')) {
      throw new ApiError('승인할 계정, 소속, 권한을 확인해 주세요.', 400);
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.auth.admin.getUserById(id);
    const authUser = data.user;
    if (error || !authUser?.email) throw new ApiError('가입 신청 계정을 찾지 못했습니다.', 404);

    const email = authUser.email.trim().toLowerCase();
    if (state.members.some((member) => member.email.toLowerCase() === email)) {
      throw new ApiError('이미 사용자 목록에 등록된 계정입니다.', 409);
    }

    const displayName = authUser.user_metadata?.display_name;
    const name = typeof displayName === 'string' && displayName.trim()
      ? displayName.trim()
      : email.split('@')[0];
    const member: Member = {
      id: `member-${authUser.id}`,
      name,
      email,
      role,
      team,
      active: true,
    };

    if (!authUser.email_confirmed_at) {
      const { error: confirmError } = await supabase.auth.admin.updateUserById(id, { email_confirm: true });
      if (confirmError) throw new Error(`Supabase email confirmation failed: ${confirmError.message}`);
    }

    state.members.push(member);
    const persisted = await writeWorkspaceState(state);
    if (!persisted) throw new Error('Supabase persistence is unavailable.');

    const registrations = await listPendingRegistrations(state);
    return Response.json(
      { member, registrations },
      { headers: { 'cache-control': 'private, no-store, max-age=0' } },
    );
  } catch (error) {
    return apiErrorResponse(error, '가입 승인을 완료하지 못했습니다.');
  }
}
