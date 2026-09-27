import type { Member } from './types';
import type {
  JejuArrival,
  ReportDocument,
  ReportStore,
  ReportTrack,
  Statistic,
} from './report-types';
import { emptyReportStore, sameReportValue, saveReport } from './reports';

/** 보고서 저장소를 팀 공용 한 곳(weekly_report_state의 TEAM_REPORT_OWNER 행)으로 합쳐 쓰기 위한 병합 규칙입니다.
 * 여러 사람이 같은 초안을 동시에 고쳐도 서로의 변경이 지워지지 않도록, 저장 요청을 통째로 덮어쓰지 않고
 * "요청한 사람이 실제로 바꾼 부분"만 서버의 최신 저장소에 반영합니다. */
export const TEAM_REPORT_OWNER = '__team__';

export class ReportShareError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

type OwnerRow = { owner_id: string; payload: ReportStore; updated_at?: string };

function byDate<T extends { date: string }>(rows: T[]) {
  return [...rows].sort((a, b) => a.date.localeCompare(b.date));
}

function upsertByDate<T extends { date: string }>(rows: T[], next: T[]) {
  const dates = new Set(next.map((row) => row.date));
  return byDate([
    ...rows.filter((row) => !dates.has(row.date)),
    ...structuredClone(next),
  ]);
}

/** 예전 작성자별 저장소들을 팀 저장소 하나로 합칩니다. 최근에 저장한 사람의 통계 값이 우선합니다.
 * "내 업무" 범위의 추적 항목은 작성자별 키(mine:작성자id)로 바꿔 서로 섞이지 않게 합니다. */
export function migrateOwnerStores(rows: OwnerRow[]): ReportStore {
  const store = emptyReportStore();
  const ordered = [...rows].sort((a, b) =>
    (a.updated_at ?? '').localeCompare(b.updated_at ?? ''),
  );
  const tracks = new Map<string, ReportTrack>();
  for (const { owner_id: ownerId, payload } of ordered) {
    if (!payload) continue;
    for (const report of payload.reports ?? [])
      if (!store.reports.some((item) => item.id === report.id))
        store.reports.push(report);
    for (const track of payload.tracks ?? []) {
      const scopeKey =
        track.scopeKey === 'mine' ? 'mine:' + ownerId : track.scopeKey;
      const key = track.id + '|' + scopeKey;
      const previous = tracks.get(key);
      if (!previous || track.history.length >= previous.history.length)
        tracks.set(key, { ...track, scopeKey });
    }
    store.statistics = upsertByDate(store.statistics, payload.statistics ?? []);
    store.imports.push(...(payload.imports ?? []));
    if (payload.jejuArrivals?.length)
      store.jejuArrivals = upsertByDate(
        store.jejuArrivals ?? [],
        payload.jejuArrivals,
      );
    if (payload.jejuImports?.length)
      store.jejuImports = [...(store.jejuImports ?? []), ...payload.jejuImports];
    store.archiveLinks = { ...store.archiveLinks, ...payload.archiveLinks };
  }
  store.tracks = [...tracks.values()];
  store.imports.sort((a, b) => a.at.localeCompare(b.at));
  store.jejuImports?.sort((a, b) => a.at.localeCompare(b.at));
  return store;
}

/** 목록을 id 기준으로 3-way 병합합니다. 내가 바꾸지 않은 항목은 서버(다른 사람)의 최신 값을 쓰고,
 * 내가 바꾼 항목은 내 값을 씁니다. 다른 사람이 새로 추가한 항목은 뒤에 붙입니다. */
function mergeList<T extends { id: string }>(base: T[], mine: T[], theirs: T[]) {
  const baseById = new Map(base.map((item) => [item.id, item]));
  const theirsById = new Map(theirs.map((item) => [item.id, item]));
  const result: T[] = [];
  for (const item of mine) {
    const original = baseById.get(item.id);
    if (!original) {
      result.push(item);
      continue;
    }
    const latest = theirsById.get(item.id);
    if (sameReportValue(item, original)) {
      // 나는 그대로 두었다: 다른 사람이 지웠으면 지우고, 고쳤으면 그 값을 쓴다.
      if (latest) result.push(latest);
    } else result.push(item);
  }
  const mineIds = new Set(mine.map((item) => item.id));
  for (const item of theirs)
    if (!mineIds.has(item.id) && !baseById.has(item.id)) result.push(item);
  return result;
}

/** 같은 초안을 여러 사람이 고쳤을 때 행(체크·문구)과 안건은 항목 단위로, 나머지 설정은 필드 단위로 합칩니다. */
export function mergeReportDraft(
  base: ReportDocument,
  mine: ReportDocument,
  theirs: ReportDocument,
): ReportDocument {
  const merged = { ...theirs } as Record<string, unknown>;
  const baseRecord = base as unknown as Record<string, unknown>;
  const mineRecord = mine as unknown as Record<string, unknown>;
  for (const key of Object.keys(mineRecord)) {
    if (key === 'rows' || key === 'agendas' || key === 'news') continue;
    if (!sameReportValue(mineRecord[key], baseRecord[key]))
      merged[key] = mineRecord[key];
  }
  return {
    ...(merged as unknown as ReportDocument),
    rows: mergeList(base.rows, mine.rows, theirs.rows),
    agendas: mergeList(base.agendas, mine.agendas, theirs.agendas),
    news: mergeList(base.news, mine.news, theirs.news),
  };
}

function applyImports<
  Row extends { date: string },
  Entry extends {
    id: string;
    before: (Row | null)[];
    after: Row[];
    undoneAt?: string;
  },
>(
  label: string,
  rows: Row[],
  entries: Entry[],
  incoming: Entry[],
): { rows: Row[]; entries: Entry[] } {
  let nextRows = rows;
  const nextEntries = [...entries];
  for (const entry of incoming) {
    const index = nextEntries.findIndex((item) => item.id === entry.id);
    if (index < 0) {
      // 새 업로드: 그 업로드가 바꾼 날짜만 최신 값 위에 반영한다.
      if (!entry.undoneAt) nextRows = upsertByDate(nextRows, entry.after);
      nextEntries.push(entry);
      continue;
    }
    const current = nextEntries[index];
    if (!entry.undoneAt || current.undoneAt) continue;
    // 되돌리기: 그 사이 다른 사람이 같은 날짜를 고쳤으면 자동 복원하지 않는다.
    for (const row of current.after)
      if (
        !sameReportValue(
          nextRows.find((item) => item.date === row.date),
          row,
        )
      )
        throw new ReportShareError(
          `${label} ${row.date} 자료가 이후 수정되어 자동 복원할 수 없습니다.`,
          409,
        );
    const dates = new Set(current.after.map((row) => row.date));
    nextRows = byDate([
      ...nextRows.filter((row) => !dates.has(row.date)),
      ...structuredClone(
        current.before.filter((row): row is Row => row !== null),
      ),
    ]);
    nextEntries[index] = { ...current, undoneAt: entry.undoneAt };
  }
  return { rows: nextRows, entries: nextEntries };
}

export type ReportSaveBases = {
  /** 요청자가 바꾼 보고서마다, 요청자가 마지막으로 본 서버 값(새 보고서는 null) */
  reports?: Record<string, ReportDocument | null>;
  /** 요청자가 마지막으로 본 외부 보관 링크 */
  archiveLinks?: Record<string, string>;
};

/** 저장 요청(incoming)에서 요청자가 실제로 바꾼 것만 서버의 최신 팀 저장소(before)에 반영합니다.
 * bases가 없으면(예전 화면) 서버 값과 다른 보고서를 모두 바꾼 것으로 봅니다. */
export function mergeSharedStore(
  before: ReportStore,
  incoming: ReportStore,
  bases: ReportSaveBases,
  actor: Member,
): ReportStore {
  let store: ReportStore = structuredClone(before);

  const stats = applyImports<Statistic, ReportStore['imports'][number]>(
    '통계',
    store.statistics,
    store.imports,
    incoming.imports ?? [],
  );
  store.statistics = stats.rows;
  store.imports = stats.entries;
  if (incoming.jejuImports?.length || store.jejuImports?.length) {
    const jeju = applyImports<
      JejuArrival,
      NonNullable<ReportStore['jejuImports']>[number]
    >(
      '입도객',
      store.jejuArrivals ?? [],
      store.jejuImports ?? [],
      incoming.jejuImports ?? [],
    );
    store.jejuArrivals = jeju.rows;
    store.jejuImports = jeju.entries;
  }

  for (const [key, value] of Object.entries(incoming.archiveLinks ?? {})) {
    const seen = bases.archiveLinks ? bases.archiveLinks[key] : before.archiveLinks[key];
    if (value !== seen) store.archiveLinks = { ...store.archiveLinks, [key]: value };
  }

  for (const report of incoming.reports ?? []) {
    const current = store.reports.find((item) => item.id === report.id);
    let base: ReportDocument | null;
    if (bases.reports) {
      if (!(report.id in bases.reports)) continue; // 요청자가 바꾸지 않은 보고서
      base = bases.reports[report.id];
    } else base = current ?? null;
    if (current && sameReportValue(report, current)) continue;
    if (current?.status === 'final')
      throw new ReportShareError(
        '이미 확정된 보고서입니다. 서버에서 다시 불러와 수정본을 작성해 주세요.',
        409,
      );
    if (!current && report.ownerId !== actor.id)
      throw new ReportShareError(
        '새 보고서는 본인 이름으로만 만들 수 있습니다.',
        403,
      );
    const owner = current?.ownerId ?? report.ownerId;
    if (report.config.scope === 'mine' && owner !== actor.id)
      throw new ReportShareError(
        '"내 업무" 범위 보고서는 작성자만 수정할 수 있습니다. 함께 쓰려면 팀 범위로 작성해 주세요.',
        403,
      );
    const document =
      current && base && !sameReportValue(current, base)
        ? mergeReportDraft(base, { ...report, ownerId: owner }, current)
        : { ...report, ownerId: owner };
    // 추적(이월) 항목은 요청의 값을 쓰지 않고 병합된 보고서의 행으로 다시 계산한다.
    try {
      store = saveReport(store, document, actor);
    } catch (error) {
      throw new ReportShareError(
        error instanceof Error ? error.message : '보고서를 저장하지 못했습니다.',
        400,
      );
    }
  }
  return store;
}
