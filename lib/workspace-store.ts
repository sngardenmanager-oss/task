import { seedState } from '@/lib/seed';
import { getSupabaseAdmin, isSupabaseConfigured } from '@/lib/supabase-server';
import { LEGACY_TEAM_ID } from '@/lib/team-access';
import type { WorkspaceState } from '@/lib/types';

type StoredRow = { team_id: string; payload: WorkspaceState; updated_at: string };

/** 로컬 실행(Supabase 미설정)용 팀별 메모리 저장소입니다. */
const localStates = new Map<string, WorkspaceState>();

/** 팀 하나의 작업공간을 읽습니다. 팀마다 workspace_state 한 행입니다. */
export async function readWorkspaceState(
  teamId: string = LEGACY_TEAM_ID,
): Promise<WorkspaceState> {
  return (await readWorkspaceRow(teamId)).state;
}

/** 작업공간과 그 행의 버전(마지막 저장 시각)을 함께 읽습니다. 버전은 동시 저장 확인에 씁니다. */
export async function readWorkspaceRow(
  teamId: string = LEGACY_TEAM_ID,
): Promise<{ state: WorkspaceState; version: string | null }> {
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
    return { state: structuredClone(localStates.get(teamId)!), version: null };
  }

  const { data, error } = await getSupabaseAdmin()
    .from('workspace_state')
    .select('team_id,payload,updated_at')
    .eq('team_id', teamId)
    .maybeSingle<StoredRow>();

  if (error) throw new Error(`Supabase read failed: ${error.message}`);
  if (data?.payload) return { state: data.payload, version: data.updated_at };
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
  if (insertError?.code === '23505') return readWorkspaceRow(teamId);
  if (insertError)
    throw new Error(`Supabase seed failed: ${insertError.message}`);
  return readWorkspaceRow(teamId);
}

export class WorkspaceConflict extends Error {}

/** 동시 저장에 안전한 수정: 읽은 뒤 다른 저장이 끼어들었으면(버전이 바뀌었으면) 최신 값으로 다시 읽어
 * mutate를 다시 적용합니다. 그래서 두 사람이 거의 같은 순간에 저장해도 한쪽 수정이 사라지지 않습니다.
 * mutate 안에서 던진 오류(권한 검사 등)는 그대로 전달됩니다. */
export async function updateWorkspaceState(
  teamId: string,
  mutate: (state: WorkspaceState) => WorkspaceState | Promise<WorkspaceState>,
  /** 이미 읽어 둔 행이 있으면 첫 시도에 다시 읽지 않고 씁니다(전송량 절약). */
  initial?: { state: WorkspaceState; version: string | null },
  attempts = 6,
): Promise<{ before: WorkspaceState; after: WorkspaceState; persisted: boolean }> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const { state: before, version } =
      attempt === 0 && initial ? initial : await readWorkspaceRow(teamId);
    const after = await mutate(structuredClone(before));
    if (!isSupabaseConfigured()) {
      localStates.set(teamId, structuredClone(after));
      return { before, after, persisted: false };
    }
    // 새 버전은 반드시 이전 버전보다 뒤로 둡니다(같은 1/1000초에 두 번 저장돼도 구분되도록).
    const next = new Date(
      Math.max(Date.now(), version ? Date.parse(version) + 1 : 0),
    ).toISOString();
    let query = getSupabaseAdmin()
      .from('workspace_state')
      .update({ payload: after, updated_at: next })
      .eq('team_id', teamId);
    if (version) query = query.eq('updated_at', version);
    const { data, error } = await query.select('team_id');
    if (error) throw new Error(`Supabase write failed: ${error.message}`);
    if (data?.length) return { before, after, persisted: true };
    // 그 사이 다른 저장이 먼저 됨: 잠깐 기다렸다 최신 값으로 다시 합칩니다.
    await new Promise((resolve) => setTimeout(resolve, 40 + Math.random() * 80));
  }
  throw new WorkspaceConflict(
    '여러 사람이 동시에 저장하고 있습니다. 잠시 후 자동으로 다시 저장합니다.',
  );
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
