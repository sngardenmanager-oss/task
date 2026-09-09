import { getSupabaseAdmin, isSupabaseConfigured } from '@/lib/supabase-server';
import { readWorkspaceState, writeWorkspaceState } from '@/lib/workspace-store';

export const dynamic = 'force-dynamic';

function placeholderAdmin(state: Awaited<ReturnType<typeof readWorkspaceState>>) {
  return state.members.find(
    (member) =>
      member.role === 'admin' && member.email.toLowerCase() === 'admin@local.test',
  );
}

export async function GET() {
  try {
    if (!isSupabaseConfigured()) {
      return Response.json({ available: false, configured: false });
    }
    const state = await readWorkspaceState();
    return Response.json(
      { available: Boolean(placeholderAdmin(state)), configured: true },
      { headers: { 'cache-control': 'private, no-store, max-age=0' } },
    );
  } catch {
    return Response.json({ available: false, configured: false }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return Response.json({ error: 'Supabase가 설정되지 않았습니다.' }, { status: 503 });
  }

  let body: { email?: string; password?: string; name?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: '올바른 요청이 아닙니다.' }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? '';
  const name = body.name?.trim();
  if (!email || !email.includes('@')) {
    return Response.json({ error: '올바른 이메일을 입력해 주세요.' }, { status: 400 });
  }
  if (password.length < 8) {
    return Response.json({ error: '비밀번호는 8자 이상이어야 합니다.' }, { status: 400 });
  }

  const state = await readWorkspaceState();
  const admin = placeholderAdmin(state);
  if (!admin) {
    return Response.json({ error: '최초 관리자 설정이 이미 완료되었습니다.' }, { status: 409 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: name ? { display_name: name } : undefined,
  });
  if (error || !data.user) {
    const message = error?.message.toLowerCase().includes('already')
      ? '이미 가입된 이메일입니다.'
      : '관리자 계정을 만들지 못했습니다.';
    return Response.json({ error: message }, { status: error?.message.includes('already') ? 409 : 500 });
  }

  const previousName = admin.name;
  admin.email = email;
  if (name) admin.name = name;
  try {
    const persisted = await writeWorkspaceState(state);
    if (!persisted) throw new Error('Supabase persistence is unavailable.');
  } catch {
    admin.email = 'admin@local.test';
    admin.name = previousName;
    await supabase.auth.admin.deleteUser(data.user.id).catch(() => undefined);
    return Response.json({ error: '관리자 정보를 저장하지 못했습니다.' }, { status: 500 });
  }

  return Response.json({ ok: true }, { status: 201 });
}
