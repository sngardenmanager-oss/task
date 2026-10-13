import { getSupabaseAdmin } from '@/lib/supabase-server';
import { sameReportValue, validateStatistic } from '@/lib/reports';
import { validateJejuArrival } from '@/lib/jeju-arrivals';
import type { JejuArrival, ReportStore, Statistic } from '@/lib/report-types';

/**
 * 경영플래너와 실적을 함께 쓰기 위한 연결.
 * 같은 Supabase의 planner_daily 테이블(경영플래너 0001 마이그레이션)이 실적의 공용 원천입니다.
 * - 보고서 탭에서 CSV를 올리면 바뀐 날짜를 planner_daily에도 씁니다.
 * - 보고서를 불러올 때 planner_daily 값(구글시트 자동 수집 포함)으로 실적을 맞춥니다.
 * planner_daily가 아직 없으면(마이그레이션 전) 아무것도 하지 않고 지금처럼 동작합니다.
 * 회사 실적은 한 벌이므로 PLANNER_TEAM_ID(기본 park = 파크사업팀) 팀 저장소만 연결합니다.
 */

export const plannerTeamId = () => process.env.PLANNER_TEAM_ID ?? 'park';

/** 경영플래너 주소. 환경변수가 없으면 배포 주소를 씁니다. */
export const PLANNER_URL = process.env.NEXT_PUBLIC_PLANNER_URL || 'https://snoopy-planner.vercel.app';

type DailyRow = { dataset: 'metrics' | 'arrivals'; date: string; payload: Record<string, unknown>; updated_at?: string };

function missingTable(error: { code?: string; message?: string } | null) {
  return Boolean(error && (error.code === '42P01' || error.code === 'PGRST205' || /planner_daily/.test(error.message ?? '')));
}

const statPayload = ({ date: _date, ...rest }: Statistic) => rest;
const jejuPayload = ({ date: _date, status: _status, ...rest }: JejuArrival) => rest;

function diff<T extends { date: string }>(before: T[], after: T[]) {
  const old = new Map(before.map((row) => [row.date, row]));
  const next = new Map(after.map((row) => [row.date, row]));
  const upserts = after.filter((row) => !sameReportValue(old.get(row.date), row));
  const removed = before.filter((row) => !next.has(row.date)).map((row) => row.date);
  return { upserts, removed };
}

/** 보고서 저장 뒤 호출. 이번 저장으로 바뀐 실적만 공용 테이블에 반영합니다. 실패해도 보고서 저장은 막지 않습니다. */
export async function mirrorToPlanner(before: ReportStore, after: ReportStore) {
  try {
    const db = getSupabaseAdmin();
    const now = new Date().toISOString();
    const stats = diff(before.statistics, after.statistics);
    const jeju = diff(before.jejuArrivals ?? [], after.jejuArrivals ?? []);
    const rows = [
      ...stats.upserts.map((row) => ({ dataset: 'metrics', date: row.date, payload: statPayload(row), updated_at: now })),
      ...jeju.upserts.map((row) => ({ dataset: 'arrivals', date: row.date, payload: jejuPayload(row), updated_at: now })),
    ];
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from('planner_daily').upsert(rows.slice(i, i + 500), { onConflict: 'dataset,date' });
      if (missingTable(error)) return;
      if (error) throw new Error(error.message);
    }
    for (const [dataset, dates] of [
      ['metrics', stats.removed],
      ['arrivals', jeju.removed],
    ] as const) {
      if (!dates.length) continue;
      const { error } = await db.from('planner_daily').delete().eq('dataset', dataset).in('date', dates);
      if (error && !missingTable(error)) throw new Error(error.message);
    }
  } catch (error) {
    console.warn('경영플래너 공용 실적 반영 실패', error);
  }
}

async function readPlannerDaily(): Promise<DailyRow[] | null> {
  const db = getSupabaseAdmin();
  const out: DailyRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('planner_daily')
      .select('dataset,date,payload,updated_at')
      .in('dataset', ['metrics', 'arrivals'])
      .order('date')
      .range(from, from + 999);
    if (missingTable(error)) return null;
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as DailyRow[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** 보고서를 불러올 때 공용 실적 값으로 맞춥니다(공용 테이블이 원천). 저장하지는 않습니다. */
export async function mergeFromPlanner(store: ReportStore): Promise<ReportStore> {
  try {
    const rows = await readPlannerDaily();
    if (!rows?.length) return store;
    const stats = new Map(store.statistics.map((row) => [row.date, row]));
    const jeju = new Map((store.jejuArrivals ?? []).map((row) => [row.date, row]));
    const statKeys = ['revenue', 'visitors', 'groups', 'foreigners', 'foreignGroups', 'groupGeneral', 'groupLocal', 'groupWelfare'] as const;
    const jejuKeys = ['total', 'domestic', 'foreign'] as const;
    const validDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
    for (const { dataset, date, payload: p, updated_at } of rows) {
      if (dataset === 'metrics') {
        const current = stats.get(date);
        // 숫자가 같으면 보고서의 원래 행을 그대로 둡니다.
        if (current && statKeys.every((k) => (current[k] ?? null) === num(p[k]))) continue;
        const next: Statistic = {
          date,
          revenue: num(p.revenue),
          visitors: num(p.visitors),
          groups: num(p.groups),
          foreigners: num(p.foreigners),
          foreignGroups: num(p.foreignGroups),
          groupGeneral: num(p.groupGeneral),
          groupLocal: num(p.groupLocal),
          groupWelfare: num(p.groupWelfare),
          memo: typeof p.memo === 'string' ? p.memo : (current?.memo ?? ''),
        };
        if (!validateStatistic(next).length) stats.set(date, next);
      } else {
        const current = jeju.get(date);
        if (current && jejuKeys.every((k) => (current[k] ?? null) === num(p[k]))) continue;
        // 보고서는 출처·자료 기준일·상태가 반드시 있어야 하므로 비어 있으면 원래 값이나 저장 시각으로 채웁니다.
        const asOf = validDay(p.asOf) ? p.asOf : validDay(current?.asOf) ? current!.asOf : (updated_at ?? new Date().toISOString()).slice(0, 10);
        const source = typeof p.source === 'string' && p.source.trim() ? p.source : current?.source?.trim() ? current.source : '경영플래너';
        const next: JejuArrival = {
          date,
          total: num(p.total),
          domestic: num(p.domestic),
          foreign: num(p.foreign),
          source,
          asOf,
          status: current?.status ?? 'final',
        };
        if (!validateJejuArrival(next).length) jeju.set(date, next);
      }
    }
    const byDate = <T extends { date: string }>(list: Iterable<T>) => [...list].sort((a, b) => a.date.localeCompare(b.date));
    return { ...store, statistics: byDate(stats.values()), jejuArrivals: byDate(jeju.values()) };
  } catch (error) {
    console.warn('경영플래너 공용 실적 읽기 실패', error);
    return store;
  }
}

/** 경영플래너가 계산해 둔 '목표 대비 현황' 요약 (없으면 null) */
export async function readPlannerSummary(): Promise<unknown | null> {
  const { data, error } = await getSupabaseAdmin().from('planner_summary').select('payload').eq('id', 'current').maybeSingle();
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205' || /planner_summary/.test(error.message)) return null;
    throw new Error(error.message);
  }
  return data?.payload ?? null;
}
