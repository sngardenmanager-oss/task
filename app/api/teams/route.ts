import {
  ApiError,
  apiErrorResponse,
  authenticateRequest,
  isMasterEmail,
  requireMaster,
  requireTeamAccess,
} from '@/lib/auth-server';
import { normalizeEmail } from '@/lib/team-access';
import { placeMemberInTeam, removeMemberFromTeam } from '@/lib/team-members';
import {
  createTeam,
  listMemberships,
  listTeams,
  updateTeam,
  upsertMembership,
} from '@/lib/team-store';
import {
  readAllWorkspaces,
  readWorkspaceState,
  updateWorkspaceState,
} from '@/lib/workspace-store';
import type { Role, TeamDirectoryEntry } from '@/lib/types';

export const dynamic = 'force-dynamic';
const headers = { 'cache-control': 'private, no-store, max-age=0' };
const roles: Role[] = ['admin', 'member', 'commenter'];
const colorPattern = /^#[0-9a-f]{6}$/i;

/** 마스터의 팀 관리 화면 데이터: 모든 팀과 모든 소속(이름 포함). */
async function directory() {
  const [teams, memberships, workspaces] = await Promise.all([
    listTeams(),
    listMemberships(),
    readAllWorkspaces(),
  ]);
  const people: TeamDirectoryEntry[] = memberships.map((membership) => {
    const member = workspaces
      .get(membership.teamId)
      ?.members.find((item) => normalizeEmail(item.email) === membership.email);
    return { ...membership, name: member?.name ?? membership.email.split('@')[0] };
  });
  return { teams, people };
}

export async function GET(request: Request) {
  try {
    const user = await authenticateRequest(request);
    requireMaster(user.email!);
    return Response.json(await directory(), { headers });
  } catch (error) {
    return apiErrorResponse(error, '팀 목록을 불러오지 못했습니다.');
  }
}

type Body =
  | { action: 'createTeam'; name?: string; color?: string }
  | { action: 'updateTeam'; teamId?: string; name?: string; color?: string; active?: boolean }
  | { action: 'moveMember'; email?: string; toTeamId?: string; role?: Role }
  | { action: 'setRole'; email?: string; teamId?: string; role?: Role }
  | { action: 'removeMember'; email?: string; teamId?: string };

function asUserError(error: unknown): never {
  if (error instanceof Error && !error.message.startsWith('Supabase'))
    throw new ApiError(error.message, 409);
  throw error;
}

export async function POST(request: Request) {
  try {
    const user = await authenticateRequest(request);
    const body = (await request.json()) as Body;

    // 팀에서 내보내기는 그 팀 관리자도 할 수 있습니다(팀원·조회 사용자만).
    if (body.action === 'removeMember') {
      const email = normalizeEmail(body.email ?? '');
      if (!email || !body.teamId) throw new ApiError('내보낼 사람과 팀을 확인해 주세요.', 400);
      const context = await requireTeamAccess(user.email!, body.teamId);
      if (!context.isMaster && context.actor.role !== 'admin')
        throw new ApiError('팀에서 내보내기는 관리자만 할 수 있습니다.', 403);
      if (email === normalizeEmail(user.email!))
        throw new ApiError('자기 자신은 내보낼 수 없습니다.', 400);
      if (isMasterEmail(email)) throw new ApiError('이 사용자는 내보낼 수 없습니다.', 400);
      const target = context.state.members.find(
        (item) => normalizeEmail(item.email) === email,
      );
      if (!context.isMaster && target?.role === 'admin')
        throw new ApiError('관리자는 내보낼 수 없습니다.', 403);
      const state = await removeMemberFromTeam(body.teamId, email);
      return Response.json(
        context.isMaster ? { state, ...(await directory()) } : { state },
        { headers },
      );
    }

    requireMaster(user.email!);

    if (body.action === 'createTeam') {
      const name = body.name?.trim();
      const color = body.color?.trim() ?? '#2f6b4f';
      if (!name) throw new ApiError('팀 이름을 입력해 주세요.', 400);
      if (!colorPattern.test(color)) throw new ApiError('색상 값을 확인해 주세요.', 400);
      const teams = await listTeams();
      if (teams.some((team) => team.name === name))
        throw new ApiError('같은 이름의 팀이 이미 있습니다.', 409);
      const team = await createTeam({ name, color });
      return Response.json({ team, ...(await directory()) }, { headers });
    }

    if (body.action === 'updateTeam') {
      if (!body.teamId) throw new ApiError('팀을 확인해 주세요.', 400);
      const patch: { name?: string; color?: string; active?: boolean } = {};
      if (body.name !== undefined) {
        if (!body.name.trim()) throw new ApiError('팀 이름을 입력해 주세요.', 400);
        patch.name = body.name.trim();
      }
      if (body.color !== undefined) {
        if (!colorPattern.test(body.color)) throw new ApiError('색상 값을 확인해 주세요.', 400);
        patch.color = body.color;
      }
      if (body.active !== undefined) patch.active = Boolean(body.active);
      await updateTeam(body.teamId, patch);
      return Response.json(await directory(), { headers });
    }

    if (body.action === 'moveMember') {
      const email = normalizeEmail(body.email ?? '');
      const role = body.role;
      if (!email || !body.toTeamId || !role || !roles.includes(role))
        throw new ApiError('옮길 사람, 팀, 권한을 확인해 주세요.', 400);
      const current = (await listMemberships({ email })).find((item) => item.active);
      if (!current) throw new ApiError('소속된 팀이 없는 사람입니다. 가입 승인으로 배정해 주세요.', 404);
      if (current.teamId === body.toTeamId)
        throw new ApiError('이미 그 팀에 소속되어 있습니다. 권한만 바꾸려면 권한을 변경해 주세요.', 400);
      const source = await readWorkspaceState(current.teamId);
      const person = source.members.find((item) => normalizeEmail(item.email) === email);
      await removeMemberFromTeam(current.teamId, email);
      try {
        await placeMemberInTeam(body.toTeamId, {
          memberId: person?.id ?? current.memberId,
          name: person?.name ?? email.split('@')[0],
          email,
          role,
        });
      } catch (error) {
        asUserError(error);
      }
      return Response.json(await directory(), { headers });
    }

    if (body.action === 'setRole') {
      const email = normalizeEmail(body.email ?? '');
      const role = body.role;
      if (!email || !body.teamId || !role || !roles.includes(role))
        throw new ApiError('사람, 팀, 권한을 확인해 주세요.', 400);
      const membership = (await listMemberships({ teamId: body.teamId, email }))[0];
      if (!membership?.active) throw new ApiError('그 팀에 소속된 사람이 아닙니다.', 404);
      await updateWorkspaceState(body.teamId, (state) => ({
        ...state,
        members: state.members.map((item) =>
          normalizeEmail(item.email) === email ? { ...item, role } : item,
        ),
      }));
      await upsertMembership({ ...membership, role });
      return Response.json(await directory(), { headers });
    }

    throw new ApiError('지원하지 않는 요청입니다.', 400);
  } catch (error) {
    return apiErrorResponse(error, '팀 정보를 변경하지 못했습니다.');
  }
}
