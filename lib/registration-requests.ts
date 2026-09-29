import { isMasterEmail } from '@/lib/auth-server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { listMemberships } from '@/lib/team-store';
import type { RegistrationRequest } from '@/lib/types';

/** 어느 팀에도 소속 기록이 없는 로그인 계정이 가입 승인 대기자입니다.
 * 퇴사(비활성) 기록이 있는 사람은 대기 목록에 다시 나오지 않고, 팀에서 내보낸 사람은 다시 나옵니다. */
export async function listPendingRegistrations(): Promise<RegistrationRequest[]> {
  const memberships = await listMemberships();
  const knownEmails = new Set(memberships.map((item) => item.email));
  const { data, error } = await getSupabaseAdmin().auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(`Supabase auth users read failed: ${error.message}`);

  return data.users
    .filter(
      (user) =>
        user.email &&
        !knownEmails.has(user.email.toLowerCase()) &&
        !isMasterEmail(user.email),
    )
    .map((user) => {
      const displayName = user.user_metadata?.display_name;
      return {
        id: user.id,
        name: typeof displayName === 'string' && displayName.trim()
          ? displayName.trim()
          : user.email!.split('@')[0],
        email: user.email!,
        requestedAt: user.created_at,
        emailConfirmed: Boolean(user.email_confirmed_at),
      };
    })
    .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt));
}
