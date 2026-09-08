import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { seedState } from '@/lib/seed';
import type { Member, WorkspaceState } from '@/lib/types';

export const dynamic = 'force-dynamic';

type StoredRow = { payload: string };

async function readState(): Promise<WorkspaceState> {
  try {
    const row = await env.DB.prepare('SELECT payload FROM workspace_state WHERE id = ?')
      .bind(1)
      .first<StoredRow>();
    if (row?.payload) return JSON.parse(row.payload) as WorkspaceState;
    await env.DB.prepare('INSERT INTO workspace_state (id, payload, updated_at) VALUES (?, ?, ?)')
      .bind(1, JSON.stringify(seedState), new Date().toISOString())
      .run();
  } catch {
    return structuredClone(seedState);
  }
  return structuredClone(seedState);
}

async function writeState(state: WorkspaceState) {
  await env.DB.prepare(
    'INSERT INTO workspace_state (id, payload, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at',
  )
    .bind(1, JSON.stringify(state), new Date().toISOString())
    .run();
}

function getActor(state: WorkspaceState, email: string | null): Member {
  if (!email) return state.members.find((member) => member.role === 'admin') ?? state.members[0];
  return (
    state.members.find((member) => member.email.toLowerCase() === email.toLowerCase() && member.active) ??
    { id: `guest-${email}`, name: email.split('@')[0], email, role: 'commenter', team: '외부 공유', active: true }
  );
}

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
      throw new Error('댓글 사용자는 댓글만 작성할 수 있습니다.');
    }
    for (const task of before.tasks) {
      const next = after.tasks.find((item) => item.id === task.id);
      if (!next || next.comments.length < task.comments.length) throw new Error('기존 댓글은 삭제할 수 없습니다.');
    }
    return;
  }

  if (JSON.stringify(before.members) !== JSON.stringify(after.members) || JSON.stringify(before.categories) !== JSON.stringify(after.categories)) {
    throw new Error('사용자와 업무 분류는 관리자만 변경할 수 있습니다.');
  }
  for (const task of after.tasks) {
    const previous = before.tasks.find((item) => item.id === task.id);
    if (task.status === 'completed' && previous?.status !== 'completed') {
      throw new Error('최종 완료는 관리자만 처리할 수 있습니다.');
    }
  }
}

export async function GET() {
  const state = await readState();
  const user = await getChatGPTUser();
  const placeholderAdmin = state.members.find((member) => member.email === 'admin@local.test');
  if (user && placeholderAdmin) {
    placeholderAdmin.email = user.email;
    placeholderAdmin.name = user.fullName ?? placeholderAdmin.name;
    try { await writeState(state); } catch { /* local preview can use the seed fallback */ }
  }
  const actor = getActor(state, user?.email ?? null);
  return Response.json({ state, actor });
}

export async function PUT(request: Request) {
  const incoming = (await request.json()) as { state?: WorkspaceState };
  if (!incoming.state) return Response.json({ error: '저장할 데이터가 없습니다.' }, { status: 400 });

  const before = await readState();
  const user = await getChatGPTUser();
  const actor = getActor(before, user?.email ?? null);
  try {
    validateUpdate(before, incoming.state, actor);
    await writeState(incoming.state);
    return Response.json({ ok: true, actor });
  } catch (error) {
    const message = error instanceof Error ? error.message : '저장하지 못했습니다.';
    if (message.includes('no such table')) return Response.json({ ok: true, localOnly: true, actor });
    return Response.json({ error: message }, { status: 403 });
  }
}
