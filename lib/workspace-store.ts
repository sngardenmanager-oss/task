import { seedState } from '@/lib/seed';
import { getSupabaseAdmin, isSupabaseConfigured } from '@/lib/supabase-server';
import type { WorkspaceState } from '@/lib/types';

type StoredRow = { payload: WorkspaceState };

export async function readWorkspaceState(): Promise<WorkspaceState> {
  if (!isSupabaseConfigured()) return structuredClone(seedState);

  const { data, error } = await getSupabaseAdmin()
    .from('workspace_state')
    .select('payload')
    .eq('id', 1)
    .maybeSingle<StoredRow>();

  if (error) throw new Error(`Supabase read failed: ${error.message}`);
  if (data?.payload) return data.payload;

  const initialState = structuredClone(seedState);
  const { error: insertError } = await getSupabaseAdmin().from('workspace_state').insert({
    id: 1,
    payload: initialState,
    updated_at: new Date().toISOString(),
  });
  if (insertError) throw new Error(`Supabase seed failed: ${insertError.message}`);
  return initialState;
}

export async function writeWorkspaceState(state: WorkspaceState): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const { error } = await getSupabaseAdmin().from('workspace_state').upsert({
    id: 1,
    payload: state,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Supabase write failed: ${error.message}`);
  return true;
}
