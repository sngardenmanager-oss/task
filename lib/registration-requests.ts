import { getSupabaseAdmin } from '@/lib/supabase-server';
import type { RegistrationRequest, WorkspaceState } from '@/lib/types';

export async function listPendingRegistrations(state: WorkspaceState): Promise<RegistrationRequest[]> {
  const memberEmails = new Set(state.members.map((member) => member.email.trim().toLowerCase()));
  const { data, error } = await getSupabaseAdmin().auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(`Supabase auth users read failed: ${error.message}`);

  return data.users
    .filter((user) => user.email && !memberEmails.has(user.email.toLowerCase()))
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
