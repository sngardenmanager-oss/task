import { seedState } from '@/lib/seed';
import { getSupabaseAdmin, isSupabaseConfigured } from '@/lib/supabase-server';
import { LEGACY_TEAM_ID } from '@/lib/team-access';
import type { WorkspaceState } from '@/lib/types';

type StoredRow = { team_id: string; payload: WorkspaceState };

/** 로컬 실행(Supabase 미설정)용 팀별 메모리 저장소입니다. */
const localStates = new Map<string, WorkspaceState>();

/** 팀 하나의 작업공간을 읽습니다. 팀마다 workspace_state 한 행입니다. */
export async function readWorkspaceState(
  teamId: string = LEGACY_TEAM_ID,
): Promise<WorkspaceState> {
  if (!isSupabaseConfigured()) {
    if (!localStates.has(teamId))
      localStates.set(
        teamId,
        teamId === LEGACY_TEAM_ID
          ? structuredClone(seedState)
          : {
              members: [],
              categories: [],
              tasks: [],
              routines: [],
              notes: [],
              projectTemplates: [],
              deletedIds: [],
            },
      );
    return structuredClone(localStates.get(teamId)!);
  }

  const { data, error } = await getSupabaseAdmin()
    .from('workspace_state')
    .select('team_id,payload')
    .eq('team_id', teamId)
    .maybeSingle<StoredRow>();

  if (error) throw new Error(`Supabase read failed: ${error.message}`);
  if (data?.payload) return data.payload;
  if (teamId !== LEGACY_TEAM_ID)
    throw new Error(`Workspace for team ${teamId} does not exist.`);

  // 새로 설치한 DB: 파크사업팀 공간을 기본 데이터로 만듭니다(최초 관리자 설정 전 상태).
  const initialState = structuredClone(seedState);
  const { error: insertError } = await getSupabaseAdmin()
    .from('workspace_state')
    .insert({
      team_id: LEGACY_TEAM_ID,
      payload: initialState,
      updated_at: new Date().toISOString(),
    });
  if (insertError?.code === '23505') return readWorkspaceState(teamId);
  if (insertError)
    throw new Error(`Supabase seed failed: ${insertError.message}`);
  return initialState;
}

export async function writeWorkspaceState(
  teamId: string,
  state: WorkspaceState,
): Promise<boolean> {
  if (!isSupabaseConfigured()) {
    localStates.set(teamId, structuredClone(state));
    return false;
  }

  const { data, error } = await getSupabaseAdmin()
    .from('workspace_state')
    .update({ payload: state, updated_at: new Date().toISOString() })
    .eq('team_id', teamId)
    .select('team_id');
  if (error) throw new Error(`Supabase write failed: ${error.message}`);
  if (!data?.length)
    throw new Error(`Workspace for team ${teamId} does not exist.`);
  return true;
}

/** 마스터 통합 관제용. 모든 팀의 작업공간을 팀 id별로 돌려줍니다. */
export async function readAllWorkspaces(): Promise<
  Map<string, WorkspaceState>
> {
  if (!isSupabaseConfigured()) {
    await readWorkspaceState(LEGACY_TEAM_ID);
    return new Map(
      [...localStates].map(([id, state]) => [id, structuredClone(state)]),
    );
  }
  const { data, error } = await getSupabaseAdmin()
    .from('workspace_state')
    .select('team_id,payload')
    .not('team_id', 'is', null);
  if (error) throw new Error(`Supabase read failed: ${error.message}`);
  return new Map(
    (data as StoredRow[]).map((row) => [row.team_id, row.payload]),
  );
}
