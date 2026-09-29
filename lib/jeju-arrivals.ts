import type {
  JejuArrival,
  ReportDocument,
  ReportStore,
  Statistic,
} from './report-types';
import {
  daysBetween,
  parseCsv,
  previousYear,
  reportId,
  sameReportValue,
  validDay,
} from './reports';

export const jejuHeaders = [
  '날짜',
  '총입도객',
  '내국인입도객',
  '외국인입도객',
  '출처',
  '자료기준일',
  '자료상태',
];
export const jejuTitle = '제주도 입도객 현황 및 스누피가든 입장객 비중';
export const jejuNote =
  '비중 = 같은 국적의 스누피가든 입장객 ÷ 제주 입도객 × 100. 내국인 입장객은 전체 − 외국인입니다. 도민·재방문 및 입도일·관람일 차이가 포함될 수 있는 기간 비교 지표';
const keys = ['total', 'domestic', 'foreign'] as const;
type Category = (typeof keys)[number];
const count = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

export function validateJejuArrival(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return ['입도객 행 형식 오류'];
  const r = value as JejuArrival;
  const errors: string[] = [];
  if (typeof r.date !== 'string' || !validDay(r.date))
    errors.push('날짜 형식 오류');
  for (const k of keys)
    if (r[k] !== null && !count(r[k]))
      errors.push('입도객은 0 이상 정수여야 합니다');
  if (keys.every((k) => r[k] === null))
    errors.push('입도객 수를 하나 이상 입력해 주세요');
  if (
    count(r.domestic) &&
    count(r.foreign) &&
    r.total !== r.domestic + r.foreign
  )
    errors.push('총 입도객과 내국인 + 외국인 합계가 다릅니다');
  if (
    count(r.total) &&
    [r.domestic, r.foreign].some((v) => count(v) && v > r.total!)
  )
    errors.push('국적별 입도객이 총 입도객보다 큽니다');
  if (typeof r.source !== 'string' || !r.source.trim() || r.source.length > 500)
    errors.push('출처를 500자 이내로 입력해 주세요');
  if (typeof r.asOf !== 'string' || !validDay(r.asOf))
    errors.push('자료 기준일을 확인해 주세요');
  if (!['provisional', 'final'].includes(r.status))
    errors.push('자료 상태 오류');
  return errors;
}

function validRows(rows: unknown): rows is JejuArrival[] {
  return (
    Array.isArray(rows) &&
    rows.every((r) => !validateJejuArrival(r).length) &&
    new Set(rows.map((r) => r.date)).size === rows.length
  );
}
// Validate both the live data and the history used by undo; legacy stores may omit them.
export function validateJejuStore(store: ReportStore): string | null {
  if (store.jejuArrivals !== undefined && !validRows(store.jejuArrivals))
    return '입도객 날짜 또는 값을 확인해 주세요.';
  if (store.jejuImports !== undefined) {
    if (!Array.isArray(store.jejuImports))
      return '입도객 업로드 이력 형식 오류';
    const ids = new Set<string>();
    for (const entry of store.jejuImports) {
      if (
        !entry ||
        typeof entry.id !== 'string' ||
        !entry.id ||
        ids.has(entry.id) ||
        typeof entry.filename !== 'string' ||
        typeof entry.actor !== 'string' ||
        typeof entry.at !== 'string' ||
        !Number.isFinite(Date.parse(entry.at)) ||
        (entry.undoneAt !== undefined &&
          (typeof entry.undoneAt !== 'string' ||
            !Number.isFinite(Date.parse(entry.undoneAt)))) ||
        !validRows(entry.after) ||
        !Array.isArray(entry.before) ||
        entry.before.length !== entry.after.length ||
        entry.before.some(
          (r, i) =>
            r !== null &&
            (validateJejuArrival(r).length || r.date !== entry.after[i].date),
        )
      )
        return '입도객 업로드 이력 형식 오류';
      ids.add(entry.id);
    }
  }
  for (const r of store.reports) {
    if (r.jejuArrivals === undefined && r.jejuCalculationVersion === undefined)
      continue;
    if (r.jejuCalculationVersion !== 1 || !validRows(r.jejuArrivals))
      return '보고서 입도객 보관 자료 형식 오류';
  }
  return null;
}

export type JejuCsvPreview = { rows: JejuArrival[]; errors: string[] };
export function previewJejuCsv(
  text: string,
  defaults: Pick<JejuArrival, 'source' | 'asOf' | 'status'>,
): JejuCsvPreview {
  const result: JejuCsvPreview = { rows: [], errors: [] };
  let csv: string[][];
  try {
    csv = parseCsv(text);
  } catch (e) {
    return {
      rows: [],
      errors: [e instanceof Error ? e.message : 'CSV 형식 오류'],
    };
  }
  const headers = csv.shift()?.map((s) => s.trim()) ?? [];
  if (
    new Set(headers).size !== headers.length ||
    jejuHeaders.slice(0, 4).some((h) => !headers.includes(h)) ||
    headers.some((h) => !jejuHeaders.includes(h))
  )
    return {
      rows: [],
      errors: [
        '입도객 CSV 양식의 열 이름을 사용해 주세요. 날짜·총입도객·내국인입도객·외국인입도객 열이 필요합니다.',
      ],
    };
  const seen = new Set<string>();
  csv.forEach((cells, i) => {
    const errors: string[] = [];
    if (cells.length !== headers.length)
      errors.push('열 개수가 양식과 다릅니다');
    const get = (name: string) => (cells[headers.indexOf(name)] ?? '').trim();
    const number = (name: string) => {
      const v = get(name);
      if (!v) return null;
      if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(v)) {
        errors.push(name + ': 0 이상 정수를 입력해 주세요');
        return null;
      }
      return Number(v.replaceAll(',', ''));
    };
    const domestic = number('내국인입도객'),
      foreign = number('외국인입도객');
    const total = number('총입도객');
    const status = get('자료상태');
    if (status && !['잠정', '확정'].includes(status))
      errors.push('자료상태는 잠정 또는 확정이어야 합니다');
    const row: JejuArrival = {
      date: get('날짜'),
      total:
        total ??
        (domestic !== null && foreign !== null ? domestic + foreign : null),
      domestic,
      foreign,
      source: get('출처') || defaults.source.trim(),
      asOf: get('자료기준일') || defaults.asOf,
      status: status
        ? status === '확정'
          ? 'final'
          : 'provisional'
        : defaults.status,
    };
    errors.push(...validateJejuArrival(row));
    if (seen.has(row.date)) errors.push('파일 안에 같은 날짜가 중복되었습니다');
    seen.add(row.date);
    result.errors.push(...errors.map((e) => `${i + 2}행: ${e}`));
    if (!errors.length) result.rows.push(row);
  });
  if (!csv.length) result.errors.push('입력된 날짜별 자료가 없습니다.');
  result.rows.sort((a, b) => a.date.localeCompare(b.date));
  return result;
}

export function applyJejuImport(
  store: ReportStore,
  rows: JejuArrival[],
  filename: string,
  actor: string,
): ReportStore {
  if (!rows.length || !validRows(rows))
    throw new Error('입도객 자료를 확인해 주세요.');
  const existing = store.jejuArrivals ?? [];
  const dates = new Set(rows.map((r) => r.date));
  return {
    ...store,
    jejuArrivals: [
      ...existing.filter((r) => !dates.has(r.date)),
      ...structuredClone(rows),
    ].sort((a, b) => a.date.localeCompare(b.date)),
    jejuImports: [
      ...(store.jejuImports ?? []),
      {
        id: reportId(),
        filename,
        actor,
        at: new Date().toISOString(),
        before: structuredClone(
          rows.map((r) => existing.find((s) => s.date === r.date) ?? null),
        ),
        after: structuredClone(rows),
      },
    ],
  };
}
export function undoJejuImport(store: ReportStore, id: string): ReportStore {
  const entry = store.jejuImports?.find((i) => i.id === id);
  if (!entry || entry.undoneAt)
    throw new Error('되돌릴 입도객 업로드가 없습니다.');
  if (entry.pruned)
    throw new Error('새 업로드가 있어 이전 업로드는 되돌릴 수 없습니다.');
  if (!validRows(entry.after) || entry.before.length !== entry.after.length)
    throw new Error('입도객 이력 형식 오류');
  for (const row of entry.after)
    if (
      !sameReportValue(
        store.jejuArrivals?.find((r) => r.date === row.date),
        row,
      )
    )
      throw new Error(
        row.date + ' 자료가 이후 수정되어 자동 복원할 수 없습니다.',
      );
  return {
    ...store,
    jejuArrivals: [
      ...(store.jejuArrivals ?? []).filter(
        (r) => !entry.after.some((a) => a.date === r.date),
      ),
      ...structuredClone(
        entry.before.filter((r): r is JejuArrival => r !== null),
      ),
    ].sort((a, b) => a.date.localeCompare(b.date)),
    jejuImports: store.jejuImports!.map((i) =>
      i.id === id ? { ...i, undoneAt: new Date().toISOString() } : i,
    ),
  };
}
export function jejuRawRows(rows: JejuArrival[]) {
  return rows.map((r) => [
    r.date,
    r.total,
    r.domestic,
    r.foreign,
    r.source,
    r.asOf,
    r.status === 'final' ? '확정' : '잠정',
  ]);
}
export function jejuCsv(rows: JejuArrival[]) {
  const escape = (v: string | number | null) =>
    '"' + String(v ?? '').replaceAll('"', '""') + '"';
  return (
    '\ufeff' +
    [jejuHeaders, ...jejuRawRows(rows)]
      .map((r) => r.map(escape).join(','))
      .join('\r\n') +
    '\r\n'
  );
}

type Total = {
  value: number | null;
  entered: number;
  days: number;
  complete: boolean;
};
type Period = {
  arrivals: Total;
  visitors: Total;
  share: number | null;
  shareReason: string;
};
function aggregate(
  days: string[],
  get: (day: string) => number | null | undefined,
): Total {
  let sum = 0,
    entered = 0;
  for (const day of days) {
    const v = get(day);
    if (count(v)) {
      sum += v;
      entered++;
    }
  }
  return {
    value: entered ? sum : null,
    entered,
    days: days.length,
    complete: days.length > 0 && entered === days.length,
  };
}
export function calculateJeju(
  arrivals: JejuArrival[],
  statistics: Statistic[],
  start: string,
  end: string,
) {
  const currentDays = daysBetween(start, end);
  const comparisonStart = currentDays.length ? previousYear(start) : '';
  const comparisonEnd = currentDays.length ? previousYear(end) : '';
  const previousDays = daysBetween(comparisonStart, comparisonEnd);
  const arrivalMap = new Map(
    arrivals
      .filter((r) => !validateJejuArrival(r).length)
      .map((r) => [r.date, r]),
  );
  const visitorMap = new Map(statistics.map((r) => [r.date, r]));
  const period = (days: string[], key: Category): Period => {
    const a = aggregate(days, (day) => arrivalMap.get(day)?.[key]);
    const v = aggregate(days, (day) => {
      const s = visitorMap.get(day);
      if (
        !s ||
        !count(s.visitors) ||
        (s.foreigners !== null &&
          (!count(s.foreigners) || s.foreigners > s.visitors))
      )
        return null;
      if (key === 'total') return s.visitors;
      if (!count(s.foreigners)) return null;
      return key === 'domestic' ? s.visitors - s.foreigners : s.foreigners;
    });
    const ready = a.complete && v.complete;
    return {
      arrivals: a,
      visitors: v,
      share: ready && a.value! > 0 ? (v.value! / a.value!) * 100 : null,
      shareReason: !ready ? '자료 부족' : '계산 불가(입도객 0)',
    };
  };
  return {
    start,
    end,
    comparisonStart,
    comparisonEnd,
    currentDays: currentDays.length,
    previousDays: previousDays.length,
    columns: keys.map((key) => {
      const current = period(currentDays, key),
        previous = period(previousDays, key);
      const ready = current.arrivals.complete && previous.arrivals.complete;
      const difference = ready
        ? current.arrivals.value! - previous.arrivals.value!
        : null;
      return {
        key,
        current,
        previous,
        difference,
        growth:
          ready && previous.arrivals.value! > 0
            ? (difference! / previous.arrivals.value!) * 100
            : null,
        growthReason: ready ? '비교 불가(전년 0)' : '자료 부족',
        shareChange:
          current.share !== null && previous.share !== null
            ? current.share - previous.share
            : null,
      };
    }),
    sources: [
      ...new Set(
        arrivals
          .filter(
            (r) =>
              (r.date >= start && r.date <= end) ||
              (r.date >= comparisonStart && r.date <= comparisonEnd),
          )
          .map(
            (r) =>
              `${r.source} · 기준일 ${r.asOf} · ${r.status === 'final' ? '확정' : '잠정'}`,
          ),
      ),
    ],
  };
}
export type JejuSummary = ReturnType<typeof calculateJeju>;
const amount = (t: Total) =>
  t.value === null
    ? '자료 없음'
    : t.value.toLocaleString('ko-KR') +
      '명' +
      (t.complete ? '' : ' (부분 집계)');
const ratio = (v: number | null, reason: string) =>
  v === null ? reason : v.toFixed(2) + '%';
const delta = (v: number | null, unit: string, reason = '자료 부족') => {
  if (v === null) return reason;
  const rounded = Number(v.toFixed(unit === '명' ? 0 : 2));
  return (
    (rounded > 0 ? '+' : '') +
    (unit === '명' ? rounded.toLocaleString('ko-KR') : rounded.toFixed(2)) +
    unit +
    (rounded > 0 ? ' 증가' : rounded < 0 ? ' 감소' : ' 변동 없음')
  );
};
export function jejuSummaryRows(summary: JejuSummary): string[][] {
  const c = summary.columns;
  return [
    ['당년 제주 입도객', ...c.map((s) => amount(s.current.arrivals))],
    ['전년 동기간 제주 입도객', ...c.map((s) => amount(s.previous.arrivals))],
    ['입도객 증감 인원', ...c.map((s) => delta(s.difference, '명'))],
    ['입도객 증감률', ...c.map((s) => delta(s.growth, '%', s.growthReason))],
    ['당년 스누피가든 입장객', ...c.map((s) => amount(s.current.visitors))],
    ['전년 스누피가든 입장객', ...c.map((s) => amount(s.previous.visitors))],
    [
      '당년 입도객 대비 입장객 비중',
      ...c.map((s) => ratio(s.current.share, s.current.shareReason)),
    ],
    [
      '전년 입도객 대비 입장객 비중',
      ...c.map((s) => ratio(s.previous.share, s.previous.shareReason)),
    ],
    [
      '비중 변화',
      ...c.map((s) =>
        delta(
          s.shareChange,
          '%p',
          s.current.share === null
            ? s.current.shareReason
            : s.previous.shareReason,
        ),
      ),
    ],
    ...(['current', 'previous'] as const).map((key) => [
      key === 'current' ? '당년 입력 일수' : '전년 입력 일수',
      ...c.map(
        (s) =>
          `입도 ${s[key].arrivals.entered}/${s[key].arrivals.days}일 · 입장 ${s[key].visitors.entered}/${s[key].visitors.days}일`,
      ),
    ]),
  ];
}
export function jejuPeriodNote(s: JejuSummary) {
  return (
    `당년 ${s.start} ~ ${s.end} (${s.currentDays}일) · 전년 ${s.comparisonStart} ~ ${s.comparisonEnd} (${s.previousDays}일) · 전년 같은 날짜 비교` +
    (s.currentDays !== s.previousDays
      ? ' · 윤일 보정으로 비교 일수가 다릅니다.'
      : '')
  );
}
export function jejuForReport(report: ReportDocument) {
  return calculateJeju(
    report.jejuArrivals ?? [],
    report.statistics,
    report.config.statsStart,
    report.config.statsEnd,
  );
}
