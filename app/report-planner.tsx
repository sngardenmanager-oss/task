'use client';

import { PLANNER_URL } from '@/lib/planner-link';

/** 경영플래너가 계산한 요약 (경영플래너 lib/engine/index.ts PlannerSummary와 같은 모양) */
export type PlannerSummary = {
  updatedAt: string;
  fy: number;
  asOf: string | null;
  planLabel: string | null;
  planTotal: number | null;
  ytd: { actual: number; target: number; rate: number | null; yoy: number | null } | null;
  month: { key: string; actual: number; target: number; fullTarget: number; rate: number | null; paceLanding: number } | null;
  landing: { value: number; vsPlan: number; method: string } | null;
  status: { ytd: Status; landing: Status } | null;
  signals: { label: string; verdict: string }[];
  next: { fy: number; base: number; low: number; high: number; tiers: { plan: number; challenge: number; stretch: number } };
};
type Status = 'good' | 'warn' | 'bad' | 'none';

const n = (v: number | null | undefined) => (v === null || v === undefined ? '—' : Math.round(v).toLocaleString('ko-KR'));
const p = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`);
const man = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${(v / 10000).toFixed(1)}만`);
const tone: Record<Status, string> = { good: 'text-[#2e7d4f]', warn: 'text-[#b7791f]', bad: 'text-[#c0392b]', none: 'text-[#657269]' };
const word: Record<Status, string> = { good: '양호', warn: '주의', bad: '위험', none: '' };

/** 주간보고 '경영지표' 아래 '목표 대비 현황' 블록, 마스터 관제 카드에 함께 씁니다. */
/** 요약은 /api/reports·/api/overview 응답에 함께 옵니다(파크사업팀·마스터만). 없으면 아무것도 그리지 않습니다. */
export function PlannerStatus({ summary, compact = false }: { summary: PlannerSummary | null | undefined; compact?: boolean }) {
  const s = summary;
  if (!s) return null;
  const link = PLANNER_URL;
  return (
    <section className="rounded-3xl border border-[#d8ded4] bg-white p-5">
      <div className="mb-3 flex flex-wrap items-baseline gap-2">
        <h3 className="text-base font-black">목표 대비 현황 (경영플래너)</h3>
        <span className="text-xs text-[#657269]">
          FY{s.fy} · {s.planLabel ?? '확정 계획 없음'}
          {s.asOf ? ` · 실적 기준일 ${s.asOf}` : ''}
        </span>
        {link && (
          <a href={link} target="_blank" rel="noreferrer" className="ml-auto text-sm font-bold text-[#2f6b4f] underline">
            경영플래너 열기
          </a>
        )}
      </div>
      {s.ytd && s.asOf ? (
        <div className={`grid gap-3 ${compact ? 'grid-cols-2' : 'sm:grid-cols-3'}`}>
          <div className="rounded-2xl bg-[#f7f6f0] p-3">
            <div className="text-xs text-[#657269]">누적 달성률</div>
            <div className={`text-xl font-black ${tone[s.status?.ytd ?? 'none']}`}>
              {p(s.ytd.rate)} <span className="text-xs">{word[s.status?.ytd ?? 'none']}</span>
            </div>
            <div className="text-xs text-[#657269]">
              실적 {n(s.ytd.actual)} / 목표 {n(s.ytd.target)}명 · 전년비 {s.ytd.yoy === null ? '—' : `${s.ytd.yoy >= 0 ? '+' : ''}${(s.ytd.yoy * 100).toFixed(1)}%`}
            </div>
          </div>
          {s.month && (
            <div className="rounded-2xl bg-[#f7f6f0] p-3">
              <div className="text-xs text-[#657269]">이번 달 ({s.month.key.replace('-', '.')})</div>
              <div className="text-xl font-black">{p(s.month.rate)}</div>
              <div className="text-xs text-[#657269]">지금 페이스면 월말 {n(s.month.paceLanding)}명 / 월 목표 {n(s.month.fullTarget)}명</div>
            </div>
          )}
          {s.landing && (
            <div className="rounded-2xl bg-[#f7f6f0] p-3">
              <div className="text-xs text-[#657269]">연간 착지 전망</div>
              <div className={`text-xl font-black ${tone[s.status?.landing ?? 'none']}`}>{man(s.landing.value)}명</div>
              <div className="text-xs text-[#657269]">계획 {man(s.planTotal)} 대비 {p(s.landing.vsPlan)}</div>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-[#657269]">이번 회계연도 실적 또는 확정 계획이 아직 없습니다.</p>
      )}
      {!compact && s.signals.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {s.signals.map((x) => (
            <li key={x.label} className="flex justify-between gap-2 border-t border-[#eeece4] pt-1">
              <span>{x.label}</span>
              <b className={x.verdict === '하방 신호' ? 'text-[#c0392b]' : x.verdict === '상방 신호' ? 'text-[#2e7d4f]' : 'text-[#657269]'}>{x.verdict}</b>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-[#8a948d]">
        다음 회계연도 FY{s.next.fy} 기준 전망 {man(s.next.base)}명 (하방 {man(s.next.low)} ~ 상방 {man(s.next.high)}) · 계획 {man(s.next.tiers.plan)} / 도전 {man(s.next.tiers.challenge)} / 상방 {man(s.next.tiers.stretch)}
      </p>
    </section>
  );
}
