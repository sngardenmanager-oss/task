import { ApiError, apiErrorResponse, authenticateRequest, requireWorkspaceMember } from '@/lib/auth-server';
import { listPendingRegistrations } from '@/lib/registration-requests';
import { readWorkspaceState, writeWorkspaceState } from '@/lib/workspace-store';
import type { Member, WorkspaceState } from '@/lib/types';

export const dynamic = 'force-dynamic';

function withoutComments(state: WorkspaceState) {
  return {
    ...state,
    tasks: state.tasks.map(({ comments: _comments, ...task }) => task),
  };
}

function validateUpdate(before: WorkspaceState, after: WorkspaceState, actor: Member) {
  if (actor.role === 'admin') return;

  if (actor.role === 'commenter') {
    if (JSON.stringify(withoutComments(before)) !== JSON.stringify(withoutComments(after))) {
      throw new ApiError('댓글 사용자는 댓글만 작성할 수 있습니다.', 403);
    }
    for (const task of before.tasks) {
      const next = after.tasks.find((item) => item.id === task.id);
      if (!next || next.comments.length < task.comments.length) {
        throw new ApiError('기존 댓글은 삭제할 수 없습니다.', 403);
      }
    }
    return;
  }

  if (
    JSON.stringify(before.members) !== JSON.stringify(after.members) ||
    JSON.stringify(before.categories) !== JSON.stringify(after.categories)
  ) {
    throw new ApiError('사용자와 업무 분류는 관리자만 변경할 수 있습니다.', 403);
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
    const user = await authenticateRequest(request);
    const state = await readWorkspaceState();
    const actor = requireWorkspaceMember(state, user.email!);
    const pendingRegistrations = actor.role === 'admin'
      ? await listPendingRegistrations(state)
      : [];
    return Response.json(
      { state, actor, pendingRegistrations },
      { headers: { 'cache-control': 'private, no-store, max-age=0' } },
    );
  } catch (error) {
    return apiErrorResponse(error, '데이터를 불러오지 못했습니다.');
  }
}

export async function PUT(request: Request) {
  try {
    const user = await authenticateRequest(request);
    const incoming = (await request.json()) as { state?: WorkspaceState };
    if (!incoming.state) {
      return Response.json({ error: '저장할 데이터가 없습니다.' }, { status: 400 });
    }

    const before = await readWorkspaceState();
    const actor = requireWorkspaceMember(before, user.email!);
    validateUpdate(before, incoming.state, actor);
    const persisted = await writeWorkspaceState(incoming.state);
    return Response.json(
      { ok: true, localOnly: !persisted, actor },
      { headers: { 'cache-control': 'private, no-store, max-age=0' } },
    );
  } catch (error) {
    return apiErrorResponse(error, '저장하지 못했습니다.');
  }
}
