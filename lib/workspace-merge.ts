import type { Comment, Member, Role, Task, TaskLink, WorkspaceState } from './types';

/** 저장 요청(바뀐 항목만)을 서버의 최신 작업공간에 합치는 규칙입니다. */

/** 서버 목록의 순서는 그대로 두고, 받은 항목으로 바꿔 끼웁니다. 새 항목은 뒤에 붙이고 지운 항목은 뺍니다.
 * (순서를 바꾸면 댓글 전용 사용자의 "댓글 말고 바뀐 것 없음" 검사가 순서 차이를 수정으로 오해합니다.) */
export function mergeById<T extends { id: string }>(
  before: T[],
  incoming: T[],
  deletedIds: Set<string>,
) {
  const incomingById = new Map(incoming.map((item) => [item.id, item]));
  const result = before
    .filter((item) => !deletedIds.has(item.id))
    .map((item) => incomingById.get(item.id) ?? item);
  const known = new Set(before.map((item) => item.id));
  for (const item of incoming)
    if (!known.has(item.id) && !deletedIds.has(item.id)) {
      result.push(item);
      known.add(item.id);
    }
  return result;
}

/** 두 사람이 같은 업무에 동시에 연결을 걸어도 한쪽이 사라지지 않도록 연결은 id 기준 합집합으로 합칩니다.
 * 해제한 연결은 removedAt이 남아 있으므로 한쪽이라도 해제했으면 해제 상태를 유지합니다. */
export function mergeTaskLinks(before: Task | undefined, incoming: Task): Task {
  if (!before?.links?.length) return incoming;
  const merged = new Map<string, TaskLink>(before.links.map((link) => [link.id, link]));
  for (const link of incoming.links ?? []) {
    const previous = merged.get(link.id);
    merged.set(link.id, previous?.removedAt && !link.removedAt ? previous : link);
  }
  return { ...incoming, links: [...merged.values()] };
}

/** 댓글은 id 기준 합집합으로 합칩니다. 두 사람이 같은 업무에 동시에 댓글을 달아도 둘 다 남습니다.
 * 관리자가 지운 댓글은 삭제 기록(deletedIds)으로 빠집니다. */
export function mergeComments(
  before: Comment[] | undefined,
  incoming: Comment[] | undefined,
  deletedIds: Set<string>,
) {
  const byId = new Map<string, Comment>();
  for (const comment of [...(before ?? []), ...(incoming ?? [])])
    if (!deletedIds.has(comment.id)) byId.set(comment.id, comment);
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function mergeIncomingState(
  before: WorkspaceState,
  incoming: WorkspaceState,
  requestedDeletedIds: Set<string>,
  role: Role,
): WorkspaceState {
  const deletedIds = new Set([...(before.deletedIds ?? []), ...requestedDeletedIds]);
  const beforeTasks = new Map(before.tasks.map((task) => [task.id, task]));
  const beforeNotes = new Map(before.notes.map((note) => [note.id, note]));

  // 댓글 전용 사용자는 댓글만 가져옵니다. 화면이 예전 값을 가지고 있어도 다른 내용은 서버 값을 그대로 둡니다.
  const incomingTasks =
    role === 'commenter'
      ? (incoming.tasks ?? []).flatMap((task) => {
          const current = beforeTasks.get(task.id);
          return current ? [{ ...current, comments: task.comments }] : [];
        })
      : (incoming.tasks ?? []);
  const incomingNotes =
    role === 'commenter'
      ? (incoming.notes ?? []).flatMap((note) => {
          const current = beforeNotes.get(note.id);
          return current ? [{ ...current, comments: note.comments }] : [];
        })
      : (incoming.notes ?? []);
  const commenterOnly = role === 'commenter';

  return {
    members: mergeById(before.members, commenterOnly ? [] : (incoming.members ?? []), deletedIds),
    categories: mergeById(
      before.categories,
      commenterOnly ? [] : (incoming.categories ?? []),
      deletedIds,
    ),
    tasks: mergeById(before.tasks, incomingTasks, deletedIds).map((task) => {
      const previous = beforeTasks.get(task.id);
      const linked = mergeTaskLinks(previous, task);
      return { ...linked, comments: mergeComments(previous?.comments, task.comments, deletedIds) };
    }),
    routines: mergeById(before.routines, commenterOnly ? [] : (incoming.routines ?? []), deletedIds),
    notes: mergeById(before.notes, incomingNotes, deletedIds).map((note) => {
      const previous = beforeNotes.get(note.id);
      return previous?.comments || note.comments
        ? { ...note, comments: mergeComments(previous?.comments, note.comments, deletedIds) }
        : note;
    }),
    projectTemplates: mergeById(
      before.projectTemplates ?? [],
      commenterOnly ? [] : (incoming.projectTemplates ?? []),
      deletedIds,
    ),
    deletedIds: [...deletedIds],
  };
}

function withoutComments(state: WorkspaceState) {
  return {
    ...state,
    deletedIds: state.deletedIds ?? [],
    tasks: state.tasks.map(({ comments: _comments, ...task }) => task),
    notes: state.notes.map(({ comments: _comments, ...note }) => note),
  };
}

/** 역할별 저장 권한 검사. 문제가 있으면 안내 문장을, 없으면 null을 돌려줍니다. */
export function updateProblem(
  before: WorkspaceState,
  after: WorkspaceState,
  actor: Pick<Member, 'role'>,
): string | null {
  if (actor.role === 'admin') return null;

  if (actor.role === 'commenter') {
    if (JSON.stringify(withoutComments(before)) !== JSON.stringify(withoutComments(after)))
      return '댓글 사용자는 댓글만 작성할 수 있습니다.';
    for (const task of before.tasks) {
      const next = after.tasks.find((item) => item.id === task.id);
      if (!next || next.comments.length < task.comments.length)
        return '기존 댓글은 삭제할 수 없습니다.';
    }
    for (const note of before.notes) {
      const next = after.notes.find((item) => item.id === note.id);
      if (!next || (next.comments ?? []).length < (note.comments ?? []).length)
        return '기존 특이사항 댓글은 삭제할 수 없습니다.';
    }
    return null;
  }

  if (
    JSON.stringify(before.members) !== JSON.stringify(after.members) ||
    JSON.stringify(before.categories) !== JSON.stringify(after.categories)
  )
    return '사용자와 업무 분류는 관리자만 변경할 수 있습니다.';
  for (const task of after.tasks) {
    const previous = before.tasks.find((item) => item.id === task.id);
    if (previous && previous.status === task.status && previous.completedAt !== task.completedAt)
      return '실제 완료일은 관리자만 확인·변경할 수 있습니다.';
    if (task.status === 'completed' && previous?.status !== 'completed')
      return '최종 완료는 관리자만 처리할 수 있습니다.';
  }
  return null;
}
