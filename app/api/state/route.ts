import {
  ApiError,
  apiErrorResponse,
  authenticateRequest,
  masterEmailCount,
  requestedTeam,
  requireTeamAccess,
} from '@/lib/auth-server';
import { keepRetiredMembers, planMembershipSync } from '@/lib/team-access';
import {
  deactivateMembership,
  listMemberships,
  upsertMembership,
} from '@/lib/team-store';
import { writeWorkspaceState } from '@/lib/workspace-store';
import type { Member, Task, TaskLink, WorkspaceState } from '@/lib/types';

export const dynamic = 'force-dynamic';

function withoutComments(state: WorkspaceState) {
  return {
    ...state,
    deletedIds: state.deletedIds ?? [],
    tasks: state.tasks.map(({ comments: _comments, ...task }) => task),
    notes: state.notes.map(({ comments: _comments, ...note }) => note),
  };
}

function mergeById<T extends { id: string }>(
  before: T[],
  incoming: T[],
  deletedIds: Set<string>,
) {
  const incomingIds = new Set(incoming.map((item) => item.id));
  return [
    ...incoming.filter((item) => !deletedIds.has(item.id)),
    ...before.filter(
      (item) => !incomingIds.has(item.id) && !deletedIds.has(item.id),
    ),
  ];
}

/** 두 사람이 같은 업무에 동시에 연결을 걸어도 한쪽이 사라지지 않도록 연결은 id 기준 합집합으로 합칩니다.
 * 해제한 연결은 removedAt이 남아 있으므로 한쪽이라도 해제했으면 해제 상태를 유지합니다. */
function mergeTaskLinks(before: Task | undefined, incoming: Task): Task {
  if (!before?.links?.length) return incoming;
  const merged = new Map<string, TaskLink>(
    before.links.map((link) => [link.id, link]),
  );
  for (const link of incoming.links ?? []) {
    const previous = merged.get(link.id);
    merged.set(
      link.id,
      previous?.removedAt && !link.removedAt ? previous : link,
    );
  }
  return { ...incoming, links: [...merged.values()] };
}

function mergeIncomingState(
  before: WorkspaceState,
  incoming: WorkspaceState,
  requestedDeletedIds: Set<string>,
): WorkspaceState {
  const deletedIds = new Set([
    ...(before.deletedIds ?? []),
    ...requestedDeletedIds,
  ]);
  const beforeTasks = new Map(before.tasks.map((task) => [task.id, task]));
  return {
    members: mergeById(before.members, incoming.members, deletedIds),
    categories: mergeById(before.categories, incoming.categories, deletedIds),
    tasks: mergeById(before.tasks, incoming.tasks, deletedIds).map((task) =>
      mergeTaskLinks(beforeTasks.get(task.id), task),
    ),
    routines: mergeById(before.routines, incoming.routines, deletedIds),
    notes: mergeById(before.notes, incoming.notes, deletedIds),
    projectTemplates: mergeById(
      before.projectTemplates ?? [],
      incoming.projectTemplates ?? [],
      deletedIds,
    ),
    deletedIds: [...deletedIds],
  };
}

function validateUpdate(
  before: WorkspaceState,
  after: WorkspaceState,
  actor: Member,
) {
  if (actor.role === 'admin') return;

  if (actor.role === 'commenter') {
    if (
      JSON.stringify(withoutComments(before)) !==
      JSON.stringify(withoutComments(after))
    ) {
      throw new ApiError('댓글 사용자는 댓글만 작성할 수 있습니다.', 403);
    }
    for (const task of before.tasks) {
      const next = after.tasks.find((item) => item.id === task.id);
      if (!next || next.comments.length < task.comments.length) {
        throw new ApiError('기존 댓글은 삭제할 수 없습니다.', 403);
      }
    }
    for (const note of before.notes) {
      const next = after.notes.find((item) => item.id === note.id);
      const previousComments = note.comments ?? [];
      const nextComments = next?.comments ?? [];
      if (!next || nextComments.length < previousComments.length) {
        throw new ApiError('기존 특이사항 댓글은 삭제할 수 없습니다.', 403);
      }
    }
    return;
  }

  if (
    JSON.stringify(before.members) !== JSON.stringify(after.members) ||
    JSON.stringify(before.categories) !== JSON.stringify(after.categories)
  ) {
    throw new ApiError(
      '사용자와 업무 분류는 관리자만 변경할 수 있습니다.',
      403,
    );
  }
  for (const task of after.tasks) {
    const previous = before.tasks.find((item) => item.id === task.id);
    if (previous && previous.status === task.status && previous.completedAt !== task.completedAt) {
      throw new ApiError('실제 완료일은 관리자만 확인·변경할 수 있습니다.', 403);
    }
    if (task.status === 'completed' && previous?.status !== 'completed') {
      throw new ApiError('최종 완료는 관리자만 처리할 수 있습니다.', 403);
    }
  }
}

/** 팀 작업공간의 members 변경(퇴사 처리·역할 변경)을 소속 기준표에 반영합니다. */
async function syncMemberships(teamId: string, members: Member[]) {
  const memberships = await listMemberships({ teamId });
  for (const change of planMembershipSync(teamId, members, memberships)) {
    if (change.kind === 'deactivate')
      await deactivateMembership(teamId, change.email);
    else await upsertMembership(change.membership);
  }
}

export async function GET(request: Request) {
  try {
    const user = await authenticateRequest(request);
    const { state, actor, team, teams, isMaster } = await requireTeamAccess(
      user.email!,
      requestedTeam(request),
    );
    return Response.json(
      {
        state,
        actor,
        team,
        teams,
        isMaster,
        signedInEmail: user.email!.toLowerCase(),
        masterConfigured: masterEmailCount(),
        pendingRegistrations: [],
      },
      { headers: { 'cache-control': 'private, no-store, max-age=0' } },
    );
  } catch (error) {
    return apiErrorResponse(error, '데이터를 불러오지 못했습니다.');
  }
}

export async function PUT(request: Request) {
  try {
    const [user, incoming] = await Promise.all([
      authenticateRequest(request),
      request.json() as Promise<{
        state?: WorkspaceState;
        deletedIds?: string[];
      }>,
    ]);
    if (!incoming.state) {
      return Response.json(
        { error: '저장할 데이터가 없습니다.' },
        { status: 400 },
      );
    }

    const {
      state: before,
      actor,
      team,
    } = await requireTeamAccess(user.email!, requestedTeam(request));
    const deletedIds = new Set(
      (incoming.deletedIds ?? []).filter(
        (id): id is string => typeof id === 'string' && id.length > 0,
      ),
    );
    if (deletedIds.size > 0 && actor.role !== 'admin') {
      throw new ApiError('삭제는 관리자만 할 수 있습니다.', 403);
    }
    const mergedState = mergeIncomingState(before, incoming.state, deletedIds);
    mergedState.members = keepRetiredMembers(before.members, mergedState.members);
    validateUpdate(before, mergedState, actor);
    const changedAt = new Date().toISOString();
    mergedState.tasks = mergedState.tasks.map(task => {
      const previous = before.tasks.find(item => item.id === task.id);
      if (!previous || previous.status === task.status) return task;
      return { ...task, completedAt: task.status === "completed" ? changedAt : undefined, statusHistory: [...(previous.statusHistory ?? []), { at: changedAt, actorId: actor.id, from: previous.status, to: task.status }] };
    });
    const persisted = await writeWorkspaceState(team.id, mergedState);
    if (
      persisted &&
      JSON.stringify(before.members) !== JSON.stringify(mergedState.members)
    )
      await syncMemberships(team.id, mergedState.members);
    return Response.json(
      { ok: true, localOnly: !persisted, actor, state: mergedState },
      { headers: { 'cache-control': 'private, no-store, max-age=0' } },
    );
  } catch (error) {
    return apiErrorResponse(error, '저장하지 못했습니다.');
  }
}
