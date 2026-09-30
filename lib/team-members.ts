import { normalizeEmail } from '@/lib/team-access';
import {
  deleteMembership,
  listMemberships,
  listTeams,
  upsertMembership,
} from '@/lib/team-store';
import { updateWorkspaceState } from '@/lib/workspace-store';
import type { Member, Role } from '@/lib/types';

/** 사람을 팀에 넣습니다. 소속 기준표와 그 팀 작업공간의 members를 함께 맞춥니다.
 * 예전에 이 팀에 있던 사람이면 기존 멤버 기록(과거 업무 연결)을 다시 활성화합니다. */
export async function placeMemberInTeam(
  teamId: string,
  person: { memberId: string; name: string; email: string; role: Role },
): Promise<Member> {
  const email = normalizeEmail(person.email);
  const team = (await listTeams()).find((item) => item.id === teamId);
  if (!team?.active) throw new Error('팀을 찾을 수 없습니다.');
  const existingActive = (await listMemberships({ email })).find(
    (item) => item.active && item.teamId !== teamId,
  );
  if (existingActive) throw new Error('이미 다른 팀에 소속된 계정입니다.');

  let member!: Member;
  await updateWorkspaceState(teamId, (state) => {
    const previous = state.members.find(
      (item) => normalizeEmail(item.email) === email,
    );
    member = previous
      ? { ...previous, role: person.role, team: team.name, active: true }
      : {
          id: person.memberId,
          name: person.name,
          email,
          role: person.role,
          team: team.name,
          active: true,
        };
    const placed = member;
    return {
      ...state,
      members: previous
        ? state.members.map((item) => (item.id === previous.id ? placed : item))
        : [...state.members, placed],
    };
  });
  await upsertMembership({
    teamId,
    email,
    memberId: member.id,
    role: member.role,
    active: true,
  });
  return member;
}

/** 팀에서 내보냅니다. 과거 기록은 남기고(멤버 비활성) 소속을 지워 가입 승인 대기로 돌려보냅니다.
 * 미완료 업무·루틴은 그 팀의 다른 관리자에게 넘깁니다. */
export async function removeMemberFromTeam(teamId: string, email: string) {
  const normalized = normalizeEmail(email);
  const { after: state } = await updateWorkspaceState(teamId, (state) => {
    const target = state.members.find(
      (item) => normalizeEmail(item.email) === normalized,
    );
    if (target) {
      const heir = state.members.find(
        (item) => item.active && item.role === 'admin' && item.id !== target.id,
      );
      state.members = state.members.map((item) =>
        item.id === target.id ? { ...item, active: false } : item,
      );
      if (heir) {
        state.tasks = state.tasks.map((task) => {
          const collaborators = task.collaborators.filter(
            (id) => id !== target.id,
          );
          if (task.assigneeId === target.id && task.status !== 'completed')
            return { ...task, assigneeId: heir.id, collaborators };
          return collaborators.length === task.collaborators.length
            ? task
            : { ...task, collaborators };
        });
        state.routines = state.routines.map((routine) =>
          routine.assigneeId === target.id
            ? { ...routine, assigneeId: heir.id }
            : routine,
        );
      }
    }
    return state;
  });
  await deleteMembership(teamId, normalized);
  return state;
}
