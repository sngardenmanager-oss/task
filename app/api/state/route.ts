import {
  ApiError,
  apiErrorResponse,
  authenticateRequest,
  requireWorkspaceMember,
} from '@/lib/auth-server';
import { readWorkspaceState, writeWorkspaceState } from '@/lib/workspace-store';
import type { Member, WorkspaceState } from '@/lib/types';

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

function mergeIncomingState(
  before: WorkspaceState,
  incoming: WorkspaceState,
  requestedDeletedIds: Set<string>,
): WorkspaceState {
  const deletedIds = new Set([
    ...(before.deletedIds ?? []),
    ...requestedDeletedIds,
  ]);
  return {
    members: mergeById(before.members, incoming.members, deletedIds),
    categories: mergeById(before.categories, incoming.categories, deletedIds),
    tasks: mergeById(before.tasks, incoming.tasks, deletedIds),
    routines: mergeById(before.routines, incoming.routines, deletedIds),
    notes: mergeById(before.notes, incoming.notes, deletedIds),
    news: mergeById(before.news, incoming.news, deletedIds),
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
    if (task.status === 'completed' && previous?.status !== 'completed') {
      throw new ApiError('최종 완료는 관리자만 처리할 수 있습니다.', 403);
    }
  }
}

export async function GET(request: Request) {
  try {
    const [user, state] = await Promise.all([
      authenticateRequest(request),
      readWorkspaceState(),
    ]);
    const actor = requireWorkspaceMember(state, user.email!);
    return Response.json(
      { state, actor, pendingRegistrations: [] },
      { headers: { 'cache-control': 'private, no-store, max-age=0' } },
    );
  } catch (error) {
    return apiErrorResponse(error, '데이터를 불러오지 못했습니다.');
  }
}

export async function PUT(request: Request) {
  try {
    const [user, incoming, before] = await Promise.all([
      authenticateRequest(request),
      request.json() as Promise<{
        state?: WorkspaceState;
        deletedIds?: string[];
      }>,
      readWorkspaceState(),
    ]);
    if (!incoming.state) {
      return Response.json(
        { error: '저장할 데이터가 없습니다.' },
        { status: 400 },
      );
    }

    const actor = requireWorkspaceMember(before, user.email!);
    const deletedIds = new Set(
      (incoming.deletedIds ?? []).filter(
        (id): id is string => typeof id === 'string' && id.length > 0,
      ),
    );
    if (deletedIds.size > 0 && actor.role !== 'admin') {
      throw new ApiError('삭제는 관리자만 할 수 있습니다.', 403);
    }
    const mergedState = mergeIncomingState(before, incoming.state, deletedIds);
    validateUpdate(before, mergedState, actor);
    const persisted = await writeWorkspaceState(mergedState);
    return Response.json(
      { ok: true, localOnly: !persisted, actor, state: mergedState },
      { headers: { 'cache-control': 'private, no-store, max-age=0' } },
    );
  } catch (error) {
    return apiErrorResponse(error, '저장하지 못했습니다.');
  }
}
