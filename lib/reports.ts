import type { Member, WorkspaceState } from './types';
import type {
  ReportConfig,
  ReportDocument,
  ReportRow,
  ReportStore,
  Statistic,
  ReportMetric,
  ReportTrack,
} from './report-types';

export const emptyReportStore = (): ReportStore => ({
  reports: [],
  tracks: [],
  statistics: [],
  imports: [],
  archiveLinks: {},
});
export const reportId = () => crypto.randomUUID();
export const todayKst = () =>
  new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
export function shiftDay(day: string, n: number) {
  if (!validDay(day)) return '';
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function validDay(day: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    Number.isFinite(Date.parse(day)) &&
    new Date(day).toISOString().slice(0, 10) === day
  );
}
export function daysBetween(start: string, end: string) {
  if (!validDay(start) || !validDay(end) || start > end) return [];
  const days: string[] = [];
  for (let d = start; d <= end; d = shiftDay(d, 1)) {
    days.push(d);
    if (days.length > 3660)
      throw new Error('집계 기간은 10년 이내로 선택해 주세요.');
  }
  return days;
}
export function previousYear(day: string) {
  const year = Number(day.slice(0, 4)) - 1;
  const candidate = year + day.slice(4);
  return validDay(candidate) ? candidate : year + '-02-28';
}
export function defaultReportConfig(
  actor: Member,
  meetingDate = todayKst(),
): ReportConfig {
  const weekday = new Date(meetingDate + 'T12:00:00Z').getUTCDay();
  const monday = shiftDay(meetingDate, -(weekday === 0 ? 6 : weekday - 1));
  return {
    title: '주간회의 통합보고',
    meetingDate,
    cutoff: monday,
    actualStart: shiftDay(monday, -7),
    actualEnd: shiftDay(monday, -1),
    planStart: monday,
    planEnd: shiftDay(monday, 6),
    statsStart: shiftDay(monday, -7),
    statsEnd: shiftDay(monday, -1),
    scope: 'mine',
    team: actor.team,
    author: actor.name,
    attendees: '',
    metricNote: '',
  };
}
export function scopeKey(config: ReportConfig) {
  return config.scope === 'mine' ? 'mine' : 'team:' + config.team;
}
export function inReportScope(
  task: WorkspaceState['tasks'][number],
  data: WorkspaceState,
  actor: Member,
  config: ReportConfig,
) {
  const ids = [task.assigneeId, ...task.collaborators];
  return config.scope === 'mine'
    ? ids.includes(actor.id)
    : data.members.some((m) => m.team === config.team && ids.includes(m.id));
}
const statusNames = {
  scheduled: '예정',
  in_progress: '진행 중',
  completion_requested: '완료 승인 대기',
  completed: '최종 완료',
};
function isRoutineTask(task?: WorkspaceState['tasks'][number]) {
  return !!task && (task.type === 'routine' || !!task.sourceRoutineId);
}
function taskRow(
  task: WorkspaceState['tasks'][number],
  data: WorkspaceState,
  config: ReportConfig,
): ReportRow {
  return {
    id: 'task:' + task.id,
    taskId: task.id,
    noteId: task.sourceNoteId,
    sourceRoutineId: task.sourceRoutineId,
    section: task.date < config.cutoff ? 'before' : 'after',
    category:
      data.categories.find((c) => c.id === task.categoryId)?.name ?? '기타',
    title: task.title,
    summary: task.description,
    nextAction: '',
    assignee: [task.assigneeId, ...task.collaborators]
      .map((id) => data.members.find((m) => m.id === id)?.name ?? '담당자 확인')
      .join(', '),
    date: task.date,
    status: statusNames[task.status],
    completedAt: task.completedAt,
    sourceFingerprint: JSON.stringify([
      task.title,
      task.description,
      task.assigneeId,
      task.collaborators,
      task.date,
    ]),
    visible: true,
    closed: false,
    closeNote: '',
    followup: '',
    delayReason: '',
    checklist: structuredClone(task.checklist),
  };
}
export function collectReportRows(
  data: WorkspaceState,
  actor: Member,
  config: ReportConfig,
  tracks: ReportTrack[],
  existing: ReportRow[] = [],
  previous?: ReportDocument,
): ReportRow[] {
  const key = scopeKey(config);
  const savedTracks = tracks.filter((t) => t.scopeKey === key);
  const result = new Map<string, ReportRow>(
    existing.map((row) => [row.id, structuredClone(row)]),
  );
  for (const track of savedTracks)
    if (!track.closed && !result.has(track.id))
      result.set(track.id, {
        ...structuredClone(track.row),
        visible: true,
        closed: false,
      });
  const candidateRows = data.tasks
    .filter((t) => inReportScope(t, data, actor, config) && !isRoutineTask(t))
    .map((t) => taskRow(t, data, config));
  for (const source of candidateRows) {
    const track = savedTracks.find(
      (t) =>
        t.id === source.id ||
        t.row.taskId === source.taskId ||
        (source.noteId && t.row.noteId === source.noteId),
    );
    const current = existing.find(
      (r) =>
        r.id === source.id ||
        r.taskId === source.taskId ||
        (source.noteId && r.noteId === source.noteId),
    );
    const old =
      current ?? (track ? { ...track.row, visible: true } : undefined);
    if (track?.closed && !existing.some((r) => r.id === track.id)) continue;
    const id = old?.id ?? source.id;
    result.set(
      id,
      old
        ? {
            ...structuredClone(old),
            taskId: source.taskId,
            noteId: source.noteId,
            section: source.section,
            status: source.status,
            completedAt: source.completedAt,
            checklist: source.checklist,
            sourceChanged:
              old.sourceFingerprint &&
              old.sourceFingerprint !== source.sourceFingerprint
                ? '원본 문구·일정·담당자 변경 확인'
                : undefined,
            sourceFingerprint: source.sourceFingerprint,
          }
        : source,
    );
  }
  // Already tracked and manually added rows survive source deletion and scope changes.
  for (const row of existing)
    if (!result.has(row.id)) result.set(row.id, structuredClone(row));
  for (const row of result.values()) {
    if (row.taskId) {
      const source = data.tasks.find((t) => t.id === row.taskId);
      if (!source) row.sourceChanged = '원본 업무 삭제됨 · 보고 내용 보존';
      else if (!inReportScope(source, data, actor, config))
        row.sourceChanged = '담당자·보고 범위 변경 확인';
      else {
        row.status = statusNames[source.status];
        row.completedAt = source.completedAt;
      }
    }
    const last = previous?.rows.find(
      (r) => r.id === row.id || (!!r.taskId && r.taskId === row.taskId),
    );
    if (last)
      row.previousPromise =
        last.nextAction ||
        (last.section === 'after' ? last.title : last.previousPromise);
  }
  // Routine work is managed on its own and never enters the weekly report,
  // including rows an earlier draft or saved track already picked up.
  return [...result.values()].filter(
    (row) =>
      !row.sourceRoutineId &&
      !(
        row.taskId && isRoutineTask(data.tasks.find((t) => t.id === row.taskId))
      ),
  );
}
export function newReport(
  data: WorkspaceState,
  actor: Member,
  config: ReportConfig,
  store: ReportStore,
): ReportDocument {
  const previous = store.reports
    .filter(
      (r) =>
        r.status === 'final' &&
        scopeKey(r.config) === scopeKey(config) &&
        r.config.meetingDate < config.meetingDate,
    )
    .sort(
      (a, b) =>
        b.config.meetingDate.localeCompare(a.config.meetingDate) ||
        b.revision - a.revision,
    )[0];
  const now = new Date().toISOString();
  return {
    id: reportId(),
    ownerId: actor.id,
    config,
    rows: collectReportRows(data, actor, config, store.tracks, [], previous),
    agendas:
      previous?.agendas
        .filter((a) => a.kind === '지시 후속' && !a.decision)
        .map((a) => ({ ...a, visible: true })) ?? [],
    news: [],
    status: 'draft',
    revision: 1,
    previousId: previous?.id,
    createdAt: now,
    updatedAt: now,
    metrics: [],
    statistics: [],
    comparisonStart: previousYear(config.statsStart),
    comparisonEnd: previousYear(config.statsEnd),
    templateVersion: 1,
  };
}
export function manualRow(section: 'before' | 'after'): ReportRow {
  return {
    id: reportId(),
    section,
    category: '운영',
    title: '',
    summary: '',
    nextAction: '',
    assignee: '',
    date: '',
    status: '수동 보고',
    visible: true,
    closed: false,
    closeNote: '',
    followup: '',
    delayReason: '',
    checklist: [],
  };
}
export function reportValidation(report: ReportDocument): string | null {
  if (!report.config.title.trim()) return '보고서 제목을 입력해 주세요.';
  if (!report.config.author.trim()) return '작성자를 입력해 주세요.';
  for (const key of [
    'meetingDate',
    'cutoff',
    'actualStart',
    'actualEnd',
    'planStart',
    'planEnd',
    'statsStart',
    'statsEnd',
  ] as const)
    if (!validDay(report.config[key]))
      return '회의일과 모든 기간을 올바르게 입력해 주세요.';
  for (const [start, end] of [
    [report.config.actualStart, report.config.actualEnd],
    [report.config.planStart, report.config.planEnd],
    [report.config.statsStart, report.config.statsEnd],
  ])
    if (start > end) return '기간 종료일은 시작일 이후여야 합니다.';
  if (report.config.scope === 'team' && !report.config.team.trim())
    return '보고할 팀을 선택해 주세요.';
  if (report.rows.some((r) => !r.title.trim()))
    return '모든 보고 행에 제목을 입력해 주세요.';
  if (report.rows.some((r) => r.date && !validDay(r.date)))
    return '보고 행의 예정일을 확인해 주세요.';
  if (new Set(report.rows.map((r) => r.id)).size !== report.rows.length)
    return '보고 항목 번호가 중복되었습니다.';
  const linked = report.rows.filter((r) => r.taskId).map((r) => r.taskId);
  if (new Set(linked).size !== linked.length)
    return '같은 업무가 여러 행에 연결되어 있습니다.';
  if (report.agendas.some((a) => !a.title.trim()))
    return '대표님 안건의 제목을 입력해 주세요.';
  return null;
}
export function saveReport(
  store: ReportStore,
  report: ReportDocument,
  actor: Member,
): ReportStore {
  const error = reportValidation(report);
  if (error) throw new Error(error);
  const previous = store.reports.find((r) => r.id === report.id);
  if (previous?.status === 'final')
    throw new Error('확정본은 수정본을 만들어 변경해 주세요.');
  const now = new Date().toISOString();
  const key = scopeKey(report.config);
  const tracks = [...store.tracks];
  for (const row of report.rows) {
    const index = tracks.findIndex(
      (t) => t.id === row.id && t.scopeKey === key,
    );
    const old = tracks[index];
    const history = old?.history ?? [];
    const changed = old ? old.closed !== row.closed : row.closed;
    const next = {
      id: row.id,
      scopeKey: key,
      row: structuredClone(row),
      closed: row.closed,
      history: changed
        ? [
            ...history,
            {
              at: now,
              actor: actor.name,
              closed: row.closed,
              note: row.closeNote,
            },
          ]
        : history,
    };
    if (index < 0) tracks.push(next);
    else tracks[index] = next;
  }
  return {
    ...store,
    tracks,
    reports: [
      ...store.reports.filter((r) => r.id !== report.id),
      { ...structuredClone(report), updatedAt: now },
    ],
  };
}
export function finalizeReport(
  report: ReportDocument,
  statistics: Statistic[],
): ReportDocument {
  const config = report.config;
  const metrics = calculateMetrics(
    statistics,
    config.statsStart,
    config.statsEnd,
  );
  const ps = previousYear(config.statsStart),
    pe = previousYear(config.statsEnd);
  return {
    ...structuredClone(report),
    status: 'final',
    finalizedAt: new Date().toISOString(),
    metrics,
    comparisonStart: ps,
    comparisonEnd: pe,
    statistics: structuredClone(
      statistics.filter(
        (s) =>
          (s.date >= config.statsStart && s.date <= config.statsEnd) ||
          (s.date >= ps && s.date <= pe),
      ),
    ),
  };
}
export const statisticColumns = {
  날짜: 'date',
  매출액: 'revenue',
  전체입장객: 'visitors',
  단체입장객: 'groups',
  외국인전체: 'foreigners',
  외국인단체: 'foreignGroups',
  단체일반: 'groupGeneral',
  단체도민: 'groupLocal',
  단체경로복지: 'groupWelfare',
  비고: 'memo',
} as const;
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  let ended = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else if (quoted) {
        quoted = false;
        ended = true;
      } else if (!value && !ended) {
        quoted = true;
      } else throw new Error('CSV 큰따옴표 형식이 올바르지 않습니다.');
    } else if (!quoted && (c === ',' || c === '\n' || c === '\r')) {
      row.push(value);
      value = '';
      ended = false;
      if (c !== ',') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        if (row.some((v) => v.trim())) rows.push(row);
        row = [];
      }
    } else {
      if (ended && c.trim())
        throw new Error('닫는 큰따옴표 뒤에 구분자가 필요합니다.');
      if (!ended) value += c;
    }
  }
  if (quoted) throw new Error('CSV 큰따옴표가 닫히지 않았습니다.');
  row.push(value);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}
export function validateStatistic(row: Statistic): string[] {
  const errors: string[] = [];
  if (!validDay(row.date)) errors.push('잘못된 날짜');
  for (const [key, value] of Object.entries(row))
    if (key !== 'date' && key !== 'memo' && value !== null) {
      if (typeof value !== 'number' || !Number.isFinite(value))
        errors.push('잘못된 숫자');
      else if (key !== 'revenue' && (value < 0 || !Number.isInteger(value)))
        errors.push('인원은 0 이상의 정수');
    }
  const larger = (part: number | null, total: number | null, label: string) => {
    if (part !== null && total !== null && part > total) errors.push(label);
  };
  larger(row.groups, row.visitors, '단체가 전체보다 큼');
  larger(row.foreigners, row.visitors, '외국인이 전체보다 큼');
  larger(row.foreignGroups, row.groups, '외국인 단체가 단체보다 큼');
  larger(row.foreignGroups, row.foreigners, '외국인 단체가 외국인 전체보다 큼');
  if (
    [
      row.groupGeneral,
      row.groupLocal,
      row.groupWelfare,
      row.foreignGroups,
      row.groups,
    ].every((v) => v !== null) &&
    row.groupGeneral! +
      row.groupLocal! +
      row.groupWelfare! +
      row.foreignGroups! !==
      row.groups
  )
    errors.push('단체 세부합과 총계 불일치');
  return [...new Set(errors)];
}
export type CsvPreview = {
  rows: Statistic[];
  errors: string[];
  added: number;
  changed: number;
  same: number;
};
export function previewStatistics(
  text: string,
  existing: Statistic[],
  clearBlanks = false,
): CsvPreview {
  const parsed = parseCsv(text);
  if (parsed.length < 2)
    throw new Error('머리글과 날짜별 데이터가 필요합니다.');
  const headers = parsed[0].map((h) => h.trim());
  if (!headers.includes('날짜') || !headers.includes('전체입장객'))
    throw new Error(
      '날짜, 전체입장객 열이 필요합니다. 날짜별 CSV 양식을 사용해 주세요.',
    );
  if (new Set(headers).size !== headers.length)
    throw new Error('머리글이 중복되었습니다.');
  if (headers.some((h) => !(h in statisticColumns)))
    throw new Error(
      '알 수 없는 열: ' +
        headers.filter((h) => !(h in statisticColumns)).join(', '),
    );
  const result: CsvPreview = {
    rows: [],
    errors: [],
    added: 0,
    changed: 0,
    same: 0,
  };
  const dates = new Set<string>();
  parsed.slice(1).forEach((cells, i) => {
    const date = cells[headers.indexOf('날짜')]?.trim() ?? '';
    const old = existing.find((r) => r.date === date);
    const next: Statistic = {
      date,
      revenue: null,
      visitors: null,
      groups: null,
      foreigners: null,
      foreignGroups: null,
      groupGeneral: null,
      groupLocal: null,
      groupWelfare: null,
      memo: '',
      ...old,
    };
    if (cells.length !== headers.length)
      result.errors.push(i + 2 + '행: 열 개수 불일치');
    if (dates.has(date))
      result.errors.push(i + 2 + '행: 파일 내 날짜 중복 ' + date);
    dates.add(date);
    headers.forEach((h, j) => {
      const key = statisticColumns[h as keyof typeof statisticColumns];
      const value = cells[j]?.trim() ?? '';
      if (key === 'date') {
        next.date = value;
        return;
      }
      if (!value && !clearBlanks) return;
      if (key === 'memo') {
        next.memo = value;
        return;
      }
      next[key] =
        value === ''
          ? null
          : /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value)
            ? Number(value.replaceAll(',', ''))
            : NaN;
    });
    for (const error of validateStatistic(next))
      result.errors.push(i + 2 + '행 (' + date + '): ' + error);
    if (!old) result.added++;
    else if (sameReportValue(old, next)) result.same++;
    else result.changed++;
    result.rows.push(next);
  });
  return result;
}
function periodTotal(
  rows: Statistic[],
  start: string,
  end: string,
  key: keyof Omit<Statistic, 'date' | 'memo'>,
) {
  const dates = daysBetween(start, end);
  const map = new Map(rows.map((r) => [r.date, r]));
  let total = 0,
    missing = 0;
  for (const date of dates) {
    const v = map.get(date)?.[key];
    if (v === null || v === undefined) missing++;
    else total += v;
  }
  return { value: missing || !dates.length ? null : total, missing };
}
export function calculateMetrics(
  rows: Statistic[],
  start: string,
  end: string,
): ReportMetric[] {
  const ps = previousYear(start),
    pe = previousYear(end);
  return (
    [
      ['매출', 'revenue', '원'],
      ['입장객', 'visitors', '명'],
      ['단체 구성비', 'groups', '%'],
      ['외국인 구성비', 'foreigners', '%'],
    ] as const
  ).map(([label, key, unit]) => {
    const a = periodTotal(rows, start, end, key),
      b = periodTotal(rows, ps, pe, key);
    const av = periodTotal(rows, start, end, 'visitors'),
      bv = periodTotal(rows, ps, pe, 'visitors');
    const ratio = unit === '%';
    const current = ratio
      ? a.value !== null && av.value !== null && av.value !== 0
        ? (a.value / av.value) * 100
        : null
      : a.value;
    const previous = ratio
      ? b.value !== null && bv.value !== null && bv.value !== 0
        ? (b.value / bv.value) * 100
        : null
      : b.value;
    const change =
      current === null || previous === null || (!ratio && previous === 0)
        ? null
        : ratio
          ? current - previous
          : ((current - previous) / previous) * 100;
    return {
      label,
      current,
      previous,
      change,
      unit,
      comparison:
        previous === 0 && !ratio
          ? '비교 불가(전년 0)'
          : current === null || previous === null
            ? '자료 없음 또는 분모 0'
            : ratio
              ? '%p'
              : '%',
      missing: ratio ? Math.max(a.missing, av.missing) : a.missing,
      previousMissing: ratio ? Math.max(b.missing, bv.missing) : b.missing,
    };
  });
}
export type CompositionPart = {
  label: string;
  // 이 구분이 합산되는 상단 지표. 외국인 단체는 두 지표에 모두 들어간다.
  belongsTo: string;
  current: number | null;
  previous: number | null;
  currentShare: number | null;
  previousShare: number | null;
  shareChange: number | null;
  // 전체·단체·외국인·외국인 단체 중 빈칸이 있거나 서로 맞지 않아 집계에서 뺀 날 수.
  missing: number;
  previousMissing: number;
};
export type DailyComposition = {
  date: string;
  visitors: number;
  // 내국인 개인, 내국인 단체, 외국인 개인, 외국인 단체 (겹치지 않음)
  parts: [number, number, number, number];
};
// 하루 자료를 겹치지 않는 네 구분으로 나눈다. 빈칸이 있거나 부분집합이 전체보다 크면 null.
function dayParts(s?: Statistic): DailyComposition | null {
  if (
    !s ||
    s.visitors === null ||
    s.groups === null ||
    s.foreigners === null ||
    s.foreignGroups === null
  )
    return null;
  const parts: DailyComposition['parts'] = [
    s.visitors - s.groups - (s.foreigners - s.foreignGroups),
    s.groups - s.foreignGroups,
    s.foreigners - s.foreignGroups,
    s.foreignGroups,
  ];
  return parts.some((v) => v < 0)
    ? null
    : { date: s.date, visitors: s.visitors, parts };
}
export function dailyComposition(
  rows: Statistic[],
  start: string,
  end: string,
): { date: string; value: DailyComposition | null }[] {
  const map = new Map(rows.map((r) => [r.date, r]));
  return daysBetween(start, end).map((date) => ({
    date,
    value: dayParts(map.get(date)),
  }));
}
// 단체 구성비와 외국인 구성비는 외국인 단체를 공통으로 포함한다.
// 전체 입장객을 겹치지 않는 네 구분으로 나눠 두 비율의 관계를 보여준다.
// 하루라도 빈칸이 있으면 전체가 사라지지 않도록, 네 값이 모두 있는 날만 합산하고
// 제외한 날 수를 함께 돌려준다.
export function calculateComposition(
  rows: Statistic[],
  start: string,
  end: string,
): CompositionPart[] {
  const ps = previousYear(start),
    pe = previousYear(end);
  const counts = (from: string, to: string) => {
    const days = dailyComposition(rows, from, to);
    const valid = days.flatMap((d) => (d.value ? [d.value] : []));
    const missing = days.length - valid.length;
    if (!valid.length) return { total: null, missing };
    const parts = [0, 1, 2, 3].map((i) =>
      valid.reduce((n, d) => n + d.parts[i], 0),
    );
    const visitors = valid.reduce((n, d) => n + d.visitors, 0);
    return { total: { visitors, parts }, missing };
  };
  const a = counts(start, end),
    b = counts(ps, pe);
  const share = (c: typeof a, i: number) =>
    c.total && c.total.visitors > 0
      ? (c.total.parts[i] / c.total.visitors) * 100
      : null;
  return [
    ['내국인 개인', '어느 지표에도 포함 안 됨'],
    ['내국인 단체', '단체 구성비'],
    ['외국인 개인', '외국인 구성비'],
    ['외국인 단체', '단체 구성비 + 외국인 구성비'],
  ].map(([label, belongsTo], i) => {
    const currentShare = share(a, i),
      previousShare = share(b, i);
    return {
      label,
      belongsTo,
      current: a.total ? a.total.parts[i] : null,
      previous: b.total ? b.total.parts[i] : null,
      currentShare,
      previousShare,
      shareChange:
        currentShare === null || previousShare === null
          ? null
          : currentShare - previousShare,
      missing: a.missing,
      previousMissing: b.missing,
    };
  });
}
// 관광 동향은 긍정 → 부정 → 미분류 순으로, 각 묶음 안에서는 빠른 일자순으로 둔다.
export function sortNews<T extends { tone?: string; collectedAt: string }>(
  news: T[],
): T[] {
  const rank = (tone?: string) =>
    tone === 'positive' ? 0 : tone === 'negative' ? 1 : 2;
  return news
    .map((n, i) => ({ n, i }))
    .sort(
      (a, b) =>
        rank(a.n.tone) - rank(b.n.tone) ||
        a.n.collectedAt.localeCompare(b.n.collectedAt) ||
        a.i - b.i,
    )
    .map(({ n }) => n);
}
// 보고 분류별 건수. 많은 순으로, 같으면 먼저 나온 분류 순.
export function categoryCounts(rows: { category: string }[]) {
  const counts = new Map<string, number>();
  for (const r of rows)
    counts.set(
      r.category || '기타',
      (counts.get(r.category || '기타') ?? 0) + 1,
    );
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}
export function undoStatisticImport(
  store: ReportStore,
  id: string,
): ReportStore {
  const entry = store.imports.find((i) => i.id === id);
  if (!entry || entry.undoneAt) throw new Error('되돌릴 업로드가 없습니다.');
  for (const row of entry.after)
    if (
      !sameReportValue(
        store.statistics.find((s) => s.date === row.date),
        row,
      )
    )
      throw new Error(
        row.date + ' 자료가 이후 수정되어 자동 복원할 수 없습니다.',
      );
  return {
    ...store,
    statistics: [
      ...store.statistics.filter(
        (s) => !entry.after.some((a) => a.date === s.date),
      ),
      ...entry.before.filter((s): s is Statistic => s !== null),
    ],
    imports: store.imports.map((i) =>
      i.id === id ? { ...i, undoneAt: new Date().toISOString() } : i,
    ),
  };
}

/** JSONB may reorder object keys. Compare values while retaining array order. */
export function sameReportValue(a: unknown, b: unknown) {
  const canonical = (input: unknown) =>
    JSON.stringify(input, (_key: string, value: unknown) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
          )
        : value,
    );
  return canonical(a) === canonical(b);
}
export function completedDay(value?: string) {
  if (!value) return '';
  if (validDay(value)) return value;
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
    : '';
}
