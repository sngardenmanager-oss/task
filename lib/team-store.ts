import { randomUUID } from 'node:crypto';
import { seedState } from '@/lib/seed';
import { getSupabaseAdmin, isSupabaseConfigured } from '@/lib/supabase-server';
import { LEGACY_TEAM_ID, normalizeEmail } from '@/lib/team-access';
import type { Role, Team, TeamMembership, WorkspaceState } from '@/lib/types';

type TeamRow = {
  id: string;
  name: string;
  color: string;
  active: boolean;
  sort_order: number;
};
type MembershipRow = {
  team_id: string;
  email: string;
  member_id: string;
  role: Role;
  active: boolean;
};

const toTeam = (row: TeamRow): Team => ({
  id: row.id,
  name: row.name,
  color: row.color,
  active: row.active,
  sortOrder: row.sort_order,
});
const toMembership = (row: MembershipRow): TeamMembership => ({
  teamId: row.team_id,
  email: row.email,
  memberId: row.member_id,
  role: row.role,
  active: row.active,
});

/** Supabase 없이 로컬에서 실행할 때 쓰는 기본값입니다. */
const localTeams: Team[] = [
  { id: LEGACY_TEAM_ID, name: '파크사업팀', color: '#2f6b4f', active: true, sortOrder: 0 },
];
const localMemberships = (): TeamMembership[] =>
  seedState.members.map((member) => ({
    teamId: LEGACY_TEAM_ID,
    email: normalizeEmail(member.email),
    memberId: member.id,
    role: member.role,
    active: member.active,
  }));

function fail(action: string, message: string): never {
  throw new Error(`Supabase ${action} failed: ${message}`);
}

export async function listTeams(): Promise<Team[]> {
  if (!isSupabaseConfigured()) return structuredClone(localTeams);
  const { data, error } = await getSupabaseAdmin()
    .from('teams')
    .select('id,name,color,active,sort_order')
    .order('sort_order')
    .order('name');
  if (error) fail('teams read', error.message);
  return (data as TeamRow[]).map(toTeam);
}

export async function listMemberships(filter?: {
  teamId?: string;
  email?: string;
}): Promise<TeamMembership[]> {
  if (!isSupabaseConfigured())
    return localMemberships().filter(
      (item) =>
        (!filter?.teamId || item.teamId === filter.teamId) &&
        (!filter?.email || item.email === normalizeEmail(filter.email)),
    );
  let query = getSupabaseAdmin()
    .from('team_memberships')
    .select('team_id,email,member_id,role,active');
  if (filter?.teamId) query = query.eq('team_id', filter.teamId);
  if (filter?.email) query = query.eq('email', normalizeEmail(filter.email));
  const { data, error } = await query;
  if (error) fail('memberships read', error.message);
  return (data as MembershipRow[]).map(toMembership);
}

export function emptyWorkspaceState(): WorkspaceState {
  return {
    members: [],
    categories: [
      { id: 'general', name: '일반업무', color: '#5f7f70', active: true },
    ],
    tasks: [],
    routines: [],
    notes: [],
    projectTemplates: [],
    deletedIds: [],
  };
}

/** 새 팀과 빈 작업공간을 함께 만듭니다. */
export async function createTeam(input: {
  name: string;
  color: string;
}): Promise<Team> {
  const db = getSupabaseAdmin();
  const teams = await listTeams();
  const team: Team = {
    id: `team-${randomUUID().slice(0, 8)}`,
    name: input.name,
    color: input.color,
    active: true,
    sortOrder: Math.max(0, ...teams.map((item) => item.sortOrder)) + 1,
  };
  const { error } = await db.from('teams').insert({
    id: team.id,
    name: team.name,
    color: team.color,
    active: team.active,
    sort_order: team.sortOrder,
  });
  if (error) fail('team insert', error.message);
  const { error: stateError } = await db.from('workspace_state').insert({
    team_id: team.id,
    payload: emptyWorkspaceState(),
    updated_at: new Date().toISOString(),
  });
  if (stateError) {
    await db.from('teams').delete().eq('id', team.id);
    fail('team workspace insert', stateError.message);
  }
  return team;
}

export async function updateTeam(
  teamId: string,
  patch: Partial<Pick<Team, 'name' | 'color' | 'active'>>,
) {
  const { error } = await getSupabaseAdmin()
    .from('teams')
    .update(patch)
    .eq('id', teamId);
  if (error) fail('team update', error.message);
}

export async function upsertMembership(membership: TeamMembership) {
  const { error } = await getSupabaseAdmin()
    .from('team_memberships')
    .upsert({
      team_id: membership.teamId,
      email: normalizeEmail(membership.email),
      member_id: membership.memberId,
      role: membership.role,
      active: membership.active,
    });
  if (error) {
    if (error.code === '23505')
      throw new Error('이미 다른 팀에 소속된 계정입니다.');
    fail('membership upsert', error.message);
  }
}

export async function deactivateMembership(teamId: string, email: string) {
  const { error } = await getSupabaseAdmin()
    .from('team_memberships')
    .update({ active: false })
    .eq('team_id', teamId)
    .eq('email', normalizeEmail(email));
  if (error) fail('membership update', error.message);
}

/** 팀에서 내보낸 사람은 소속 행을 지워 가입 승인 대기 목록으로 돌려보냅니다. */
export async function deleteMembership(teamId: string, email: string) {
  const { error } = await getSupabaseAdmin()
    .from('team_memberships')
    .delete()
    .eq('team_id', teamId)
    .eq('email', normalizeEmail(email));
  if (error) fail('membership delete', error.message);
}
