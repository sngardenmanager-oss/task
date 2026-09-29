import type { Member, Role, Team, TeamMembership } from './types';

/** 팀 분리 전의 데이터가 옮겨 간 파크사업팀입니다. */
export const LEGACY_TEAM_ID = 'park';
/** 마스터의 '전체 팀' 통합 관제 화면을 가리키는 값입니다. 실제 팀 id로는 쓰지 않습니다. */
export const ALL_TEAMS_ID = '__all__';

export class TeamAccessError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
  }
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

/** 요청한 사람이 이번 요청에서 들어갈 팀을 정합니다.
 * 마스터는 모든 활성 팀에 들어갈 수 있고, 그 밖의 사람은 자기 소속 팀 하나에만 들어갈 수 있습니다. */
export function resolveTeamAccess({
  email,
  isMaster,
  requestedTeamId,
  teams,
  memberships,
}: {
  email: string;
  isMaster: boolean;
  requestedTeamId?: string | null;
  teams: Team[];
  memberships: TeamMembership[];
}): { team: Team; accessibleTeams: Team[] } {
  const activeTeams = teams
    .filter((team) => team.active)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const requested = requestedTeamId?.trim() || null;

  if (isMaster) {
    const team = requested
      ? activeTeams.find((item) => item.id === requested)
      : (activeTeams.find((item) => item.id === LEGACY_TEAM_ID) ??
        activeTeams[0]);
    if (!team)
      throw new TeamAccessError('팀을 찾을 수 없습니다.', 404, 'team_not_found');
    return { team, accessibleTeams: activeTeams };
  }

  const normalized = normalizeEmail(email);
  const membership = memberships.find(
    (item) =>
      item.active &&
      item.email === normalized &&
      activeTeams.some((team) => team.id === item.teamId),
  );
  if (!membership) {
    const retired = memberships.some(
      (item) => item.email === normalized && !item.active,
    );
    if (retired)
      throw new TeamAccessError(
        '비활성화된 계정입니다. 관리자에게 문의해 주세요.',
        403,
        'account_inactive',
      );
    throw new TeamAccessError(
      '가입 신청이 접수되어 관리자 승인을 기다리고 있습니다.',
      403,
      'approval_pending',
    );
  }
  if (requested && requested !== membership.teamId)
    throw new TeamAccessError(
      '이 팀에 접근할 권한이 없습니다.',
      403,
      'team_forbidden',
    );
  const team = activeTeams.find((item) => item.id === membership.teamId)!;
  return { team, accessibleTeams: [team] };
}

/** 가입 승인 권한.
 * 마스터는 어느 팀에나 모든 역할로 승인합니다. 팀 관리자는 자기 팀에 팀원·조회 역할로만 승인합니다.
 * 그래서 새 팀의 첫 관리자는 마스터만 정할 수 있습니다. */
export function approvalProblem({
  isMaster,
  actorRole,
  actorTeamId,
  targetTeamId,
  role,
}: {
  isMaster: boolean;
  actorRole: Role;
  actorTeamId: string;
  targetTeamId: string;
  role: Role;
}): string | null {
  if (!['admin', 'member', 'commenter'].includes(role))
    return '권한을 확인해 주세요.';
  if (isMaster) return null;
  if (actorRole !== 'admin') return '가입 승인은 관리자만 처리할 수 있습니다.';
  if (targetTeamId !== actorTeamId)
    return '다른 팀의 가입은 마스터만 승인할 수 있습니다.';
  if (role === 'admin') return '관리자 지정은 마스터만 할 수 있습니다.';
  return null;
}

export type MembershipChange =
  | { kind: 'upsert'; membership: TeamMembership }
  | { kind: 'deactivate'; email: string };

/** 팀 작업공간의 members가 바뀐 뒤 소속 기준표를 맞추는 계획을 만듭니다.
 * - 팀 관리자가 퇴사 처리(비활성)하면 소속도 비활성으로.
 * - 역할이 바뀌면 소속표의 역할도 같이.
 * 새 소속은 여기서 만들지 않습니다. 가입 승인·팀 배정 API로만 생깁니다. */
export function planMembershipSync(
  teamId: string,
  members: Member[],
  memberships: TeamMembership[],
): MembershipChange[] {
  const changes: MembershipChange[] = [];
  const seen = new Set<string>();
  for (const member of members) {
    const email = normalizeEmail(member.email ?? '');
    if (!email.includes('@') || seen.has(email)) continue;
    seen.add(email);
    const own = memberships.find(
      (item) => item.teamId === teamId && item.email === email && item.active,
    );
    if (!own) continue;
    if (!member.active) {
      changes.push({ kind: 'deactivate', email });
      continue;
    }
    if (own.role === member.role && own.memberId === member.id) continue;
    changes.push({
      kind: 'upsert',
      membership: {
        teamId,
        email,
        memberId: member.id,
        role: member.role,
        active: true,
      },
    });
  }
  return changes;
}

/** 저장 요청으로는 비활성(퇴사·내보내기) 멤버를 다시 살리지 못하게 합니다.
 * 오래 열어 둔 화면이 예전 멤버 목록을 보내도 서버의 비활성 상태가 유지됩니다. 복귀는 가입 승인으로만 합니다. */
export function keepRetiredMembers(before: Member[], merged: Member[]): Member[] {
  const retired = new Set(
    before.filter((member) => !member.active).map((member) => member.id),
  );
  return merged.map((member) =>
    retired.has(member.id) && member.active
      ? { ...member, active: false }
      : member,
  );
}

/** 주간보고서 저장소의 행 키. 파크사업팀은 팀 분리 전부터 쓰던 '__team__' 행을 그대로 씁니다. */
export function reportOwnerFor(teamId: string) {
  return teamId === LEGACY_TEAM_ID ? '__team__' : `team:${teamId}`;
}
