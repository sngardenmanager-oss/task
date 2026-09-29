import type { ReportStore } from './report-types';

/** 저장 한 번에 주고받을 수 있는 양(Vercel 요청 한도 4.5MB)보다 조금 낮춘 안전선입니다. */
export const REQUEST_LIMIT_BYTES = 4_000_000;
/** 요청 한도 4.5MB의 80% — 이 크기를 넘으면 마스터에게 경고합니다. */
export const WARNING_BYTES = 3_600_000;
export const HARD_LIMIT_BYTES = 4_500_000;

export function byteLength(value: unknown) {
  return new TextEncoder().encode(
    typeof value === 'string' ? value : JSON.stringify(value),
  ).length;
}

/** CSV·입도객 업로드는 가장 최근 1건만 되돌리기용 복사본을 남기고, 그 전 기록은 이름표만 남깁니다.
 * 기록을 통째로 지우면 오래 열어 둔 화면이 그 기록을 "새 업로드"로 착각해 예전 값으로 덮을 수 있어서입니다.
 * 실제 숫자(statistics, jejuArrivals)는 건드리지 않습니다. */
export function pruneImportHistory(store: ReportStore): ReportStore {
  const trim = <T extends { at: string; before: unknown[]; after: unknown[]; pruned?: boolean }>(
    entries: T[],
  ): T[] => {
    const latest = [...entries].sort((a, b) => b.at.localeCompare(a.at))[0];
    return entries.map((entry) =>
      entry === latest || entry.pruned
        ? entry
        : { ...entry, before: [], after: [], pruned: true },
    );
  };
  return {
    ...store,
    imports: trim(store.imports),
    ...(store.jejuImports ? { jejuImports: trim(store.jejuImports) } : {}),
  };
}

/** 한국 시간 기준 날짜(YYYY-MM-DD). */
export function kstDay(date: Date) {
  return date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

/** 확정일로부터 1개월(같은 날짜의 전달)이 지난 시점 = 이 날짜 이전에 확정된 보고서가 정리 대상입니다. */
export function retentionCutoff(now: Date) {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 1);
  return cutoff.toISOString();
}

/** 정리 대상 확정 보고서: ① 확정한 지 1개월이 지났고 ② 이번 백업에 포함된(백업 시작 전에 확정된) 것.
 * 초안은 대상이 아닙니다. 백업을 하지 않으면 이 함수가 불리지 않으므로 아무것도 지워지지 않습니다. */
export function prunableReportIds(
  store: ReportStore,
  now: Date,
  backupStartedAt: string,
) {
  const cutoff = retentionCutoff(now);
  return store.reports
    .filter((report) => {
      if (report.status !== 'final') return false;
      const finalizedAt = report.finalizedAt ?? report.updatedAt;
      return finalizedAt < cutoff && finalizedAt <= backupStartedAt;
    })
    .map((report) => report.id);
}

export function removeReports(store: ReportStore, ids: string[]): ReportStore {
  if (!ids.length) return store;
  const removed = new Set(ids);
  return {
    ...store,
    reports: store.reports.filter((report) => !removed.has(report.id)),
    deletedReportIds: [...new Set([...(store.deletedReportIds ?? []), ...ids])],
  };
}

/** 매월 백업 알림: 한국 시간 1~3일 동안, 이번 달 1일 이후 백업한 기록이 없으면 알립니다. */
export function isBackupDue(now: Date, lastBackupAt?: string | null) {
  const today = kstDay(now);
  const day = Number(today.slice(8));
  if (day > 3) return false;
  const monthStart = `${today.slice(0, 7)}-01`;
  return !lastBackupAt || kstDay(new Date(lastBackupAt)) < monthStart;
}
