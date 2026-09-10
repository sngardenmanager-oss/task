import { createClient, type User } from '@supabase/supabase-js';
import type { Member, WorkspaceState } from '@/lib/types';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}

function publicSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_ANON_KEY;
  return { url, key };
}

export async function authenticateRequest(request: Request): Promise<User> {
  const authorization = request.headers.get('authorization');
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new ApiError('로그인이 필요합니다.', 401);

  const { url, key } = publicSupabaseConfig();
  if (!url || !key)
    throw new ApiError('로그인 서비스가 설정되지 않았습니다.', 503);

  const supabase = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user?.email)
    throw new ApiError('로그인 세션이 만료되었습니다.', 401);
  return data.user;
}

function isMasterEmail(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  return (process.env.MASTER_EMAILS ?? '')
    .split(',')
    .map((candidate) => candidate.trim().toLowerCase())
    .filter(Boolean)
    .includes(normalizedEmail);
}

export function requireWorkspaceMember(
  state: WorkspaceState,
  email: string,
): Member {
  const member = state.members.find(
    (candidate) => candidate.email.toLowerCase() === email.toLowerCase(),
  );
  if (isMasterEmail(email)) {
    return member
      ? { ...member, role: 'admin', active: true }
      : {
          id: 'system-master',
          name: '마스터 관리자',
          email: email.toLowerCase(),
          role: 'admin',
          team: '전체',
          active: true,
        };
  }
  if (!member) {
    throw new ApiError(
      '가입 신청이 접수되어 관리자 승인을 기다리고 있습니다.',
      403,
      'approval_pending',
    );
  }
  if (!member.active) {
    throw new ApiError(
      '비활성화된 계정입니다. 관리자에게 문의해 주세요.',
      403,
      'account_inactive',
    );
  }
  return member;
}

export function apiErrorResponse(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }
  const message = error instanceof Error ? error.message : fallback;
  console.error(message);
  return Response.json({ error: fallback }, { status: 500 });
}
