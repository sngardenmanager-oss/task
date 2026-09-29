import type { WorkspaceState } from './types';

/** 저장할 때 "내가 실제로 바꾼 항목"만 보내기 위한 계산입니다.
 * 기준(base) = 마지막으로 서버와 맞춘 상태. 이것과 다른 항목만 보내면,
 * 오래 열어 둔 화면이 다른 사람이 고친 항목을 예전 값으로 덮어쓰지 않습니다. */

const collections = [
  'members',
  'categories',
  'tasks',
  'routines',
  'notes',
  'projectTemplates',
] as const;
type Collection = (typeof collections)[number];

export type WorkspaceDelta = Pick<WorkspaceState, Exclude<Collection, 'projectTemplates'>> & {
  projectTemplates: NonNullable<WorkspaceState['projectTemplates']>;
};

function items(state: WorkspaceState, key: Collection): { id: string }[] {
  return (state[key] ?? []) as { id: string }[];
}

export function diffWorkspace(base: WorkspaceState, current: WorkspaceState): WorkspaceDelta {
  const delta = {} as Record<Collection, { id: string }[]>;
  for (const key of collections) {
    const before = new Map(items(base, key).map((item) => [item.id, JSON.stringify(item)]));
    delta[key] = items(current, key).filter(
      (item) => before.get(item.id) !== JSON.stringify(item),
    );
  }
  return delta as unknown as WorkspaceDelta;
}

export function isEmptyDelta(delta: WorkspaceDelta) {
  return collections.every((key) => !(delta[key] ?? []).length);
}

/** 서버 최신 상태 위에 내 변경분을 얹습니다. 지운 항목은 빼고, 순서는 서버 기준을 유지합니다. */
export function applyDelta(
  state: WorkspaceState,
  delta: WorkspaceDelta,
  deletedIds: Iterable<string> = [],
): WorkspaceState {
  const deleted = new Set([...(state.deletedIds ?? []), ...deletedIds]);
  const next = { ...state, deletedIds: [...deleted] } as WorkspaceState;
  for (const key of collections) {
    const changed = new Map((delta[key] ?? []).map((item) => [item.id, item]));
    const merged = items(state, key).map((item) => changed.get(item.id) ?? item);
    const known = new Set(merged.map((item) => item.id));
    for (const item of changed.values()) if (!known.has(item.id)) merged.push(item);
    (next as unknown as Record<Collection, { id: string }[]>)[key] = merged.filter(
      (item) => !deleted.has(item.id),
    );
  }
  return next;
}

/** 서버로 보내는 모양(WorkspaceState와 같은 필드, 바뀐 항목만). */
export function deltaAsState(delta: WorkspaceDelta): WorkspaceState {
  return { ...delta, deletedIds: [] };
}
