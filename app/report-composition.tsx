'use client';

import { useState } from 'react';
import { calculateComposition, dailyComposition } from '@/lib/reports';
import { dailyColors, dailyLabels, dailyStack } from '@/lib/report-export';
import type { Statistic } from '@/lib/report-types';

const colors = dailyColors.parts;
const fmt = (n: number, digits = 1) =>
  n.toLocaleString('ko-KR', { maximumFractionDigits: digits });
const people = (n: number | null) =>
  n === null ? '자료 없음' : fmt(n, 0) + '명';
const pct = (n: number | null) => (n === null ? '자료 없음' : fmt(n) + '%');
const gap = (n: number | null) =>
  n === null ? '—' : (n > 0 ? '+' : '') + n.toFixed(1) + '%p';
const cell = 'border border-[#d8ded4] p-2';

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#43594b]">
      {items.map(([label, color]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block size-2.5 rounded-sm"
            style={{ background: color }}
          />
          {label}
        </span>
      ))}
    </div>
  );
}

// 네 카드 아래 일자별 입장객 분포. 막대 하나가 그날 전체 입장객(100%)이다.
// 윗줄: 내국인·외국인 구성비. 아랫줄: 같은 막대를 개인·단체로 나눠, 단체(내국인+외국인)가
// 가운데 이어지게 쌓는다. 그래서 외국인 단체가 두 구성비에 함께 들어가는 부분이 보인다.
export function DailyVisitorChart({
  rows,
  start,
  end,
}: {
  rows: Statistic[];
  start: string;
  end: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  let days: ReturnType<typeof dailyComposition> = [];
  try {
    days = dailyComposition(rows, start, end);
  } catch {
    days = [];
  }
  if (!days.length) return null;
  const any = days.some((d) => d.value);
  const active = days.find((d) => d.date === hover)?.value;
  const share = (n: number, total: number) =>
    total > 0 ? (n / total) * 100 : 0;
  const segments = (visitors: number, list: [number, string, string][]) =>
    list.map(([n, color, label]) => (
      <div
        key={label}
        className="min-h-0 rounded-[2px]"
        style={{ height: share(n, visitors) + '%', background: color }}
      />
    ));
  const row = (top: boolean) =>
    days.map((d) => {
      const v = d.value;
      return (
        <button
          key={d.date}
          type="button"
          onMouseEnter={() => setHover(d.date)}
          onFocus={() => setHover(d.date)}
          onMouseLeave={() => setHover(null)}
          onBlur={() => setHover(null)}
          aria-label={
            d.date +
            (v
              ? ' 전체 ' +
                fmt(v.visitors, 0) +
                '명 · 외국인 ' +
                fmt(share(v.parts[2] + v.parts[3], v.visitors)) +
                '%'
              : ' 미입력')
          }
          className={
            'flex h-20 min-w-0 flex-1 flex-col-reverse gap-[2px] overflow-hidden rounded-[3px] p-0 ' +
            (v ? '' : 'border border-dashed border-[#bccbc0] ') +
            (hover === d.date
              ? 'outline outline-2 outline-offset-1 outline-[#183b2b]'
              : '')
          }
        >
          {v &&
            (top
              ? segments(v.visitors, [
                  [v.parts[0] + v.parts[1], dailyColors.domestic, '내국인'],
                  [v.parts[2] + v.parts[3], dailyColors.foreign, '외국인'],
                ])
              : segments(
                  v.visitors,
                  dailyStack.map(
                    (i) =>
                      [v.parts[i], colors[i], dailyLabels.parts[i]] as [
                        number,
                        string,
                        string,
                      ],
                  ),
                ))}
        </button>
      );
    });
  const label = 'w-16 shrink-0 text-xs font-bold text-[#43594b]';
  return (
    <section className="rounded-2xl border border-[#d8ded4] bg-white p-4 md:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-bold">일자별 입장객 분포</h3>
        <p className="text-xs text-[#64776a]">
          막대 하나 = 그날 전체 입장객 100% · 점선은 미입력(또는 값이 맞지 않는
          날)
        </p>
      </div>
      {!any ? (
        <p className="mt-3 text-sm text-amber-700">
          통계 기간에 전체·단체·외국인·외국인 단체가 모두 입력된 날이 없습니다.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <div className="min-w-[560px] space-y-1.5">
            <div className="flex gap-[3px] text-[10px] text-[#64776a]">
              <span className="w-16 shrink-0" />
              {days.map((d) => (
                <span
                  key={d.date}
                  className="min-w-0 flex-1 truncate text-center"
                >
                  {d.value ? fmt(d.value.visitors, 0) : '—'}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-[3px]">
              <span className={label}>내국인·외국인</span>
              {row(true)}
            </div>
            <div className="pl-16">
              <Legend
                items={[
                  ['내국인', dailyColors.domestic],
                  ['외국인', dailyColors.foreign],
                ]}
              />
            </div>
            <div className="flex items-center gap-[3px] pt-1">
              <span className={label}>개인·단체</span>
              {row(false)}
            </div>
            <div className="flex gap-[3px] text-[10px] text-[#64776a]">
              <span className="w-16 shrink-0" />
              {days.map((d) => (
                <span
                  key={d.date}
                  className="min-w-0 flex-1 truncate text-center"
                >
                  {d.date.slice(5)}
                </span>
              ))}
            </div>
            <div className="pl-16">
              <Legend
                items={dailyStack.map((i) => [dailyLabels.parts[i], colors[i]])}
              />
            </div>
          </div>
        </div>
      )}
      <p className="mt-2 min-h-5 text-sm text-[#183b2b]" aria-live="polite">
        {hover &&
          (active
            ? hover +
              ' · 전체 ' +
              fmt(active.visitors, 0) +
              '명 — ' +
              dailyStack
                .map(
                  (i) =>
                    dailyLabels.parts[i] +
                    ' ' +
                    fmt(active.parts[i], 0) +
                    '명(' +
                    fmt(share(active.parts[i], active.visitors)) +
                    '%)',
                )
                .join(' · ')
            : hover + ' · 미입력 또는 값 불일치')}
      </p>
    </section>
  );
}

// 단체 구성비와 외국인 구성비는 외국인 단체를 함께 포함한다. 전체 입장객을
// 겹치지 않는 네 구분으로 나눠서 두 비율이 어디서 겹치는지 보여준다.
export default function RatioComposition({
  rows,
  start,
  end,
}: {
  rows: Statistic[];
  start: string;
  end: string;
}) {
  let parts: ReturnType<typeof calculateComposition> = [];
  try {
    parts = calculateComposition(rows, start, end);
  } catch {
    return null;
  }
  const ready = parts.every((p) => p.currentShare !== null);
  // 외국인 단체를 가운데 두어 두 구성비가 서로 이어진 구간으로 보이게 한다.
  const order = dailyStack;
  const share = (i: number) => parts[i].currentShare ?? 0;
  const group = share(1) + share(3);
  const foreign = share(2) + share(3);
  const { missing, previousMissing } = parts[0];
  return (
    <section className="rounded-2xl border border-[#d8ded4] bg-white p-4 md:p-5">
      <h3 className="font-bold">단체·외국인 구성비 한눈에 보기</h3>
      <p className="mt-1 text-sm text-[#64776a]">
        외국인 단체는 <b>단체 구성비</b>와 <b>외국인 구성비</b>에 모두 들어
        있어서 두 비율을 더하면 안 됩니다. 아래는 전체 입장객을 겹치지 않게 나눈
        값입니다.
      </p>
      {(missing > 0 || previousMissing > 0) && (
        <p className="mt-1 text-xs text-amber-700">
          전체·단체·외국인·외국인 단체 중 빈칸이 있는 날은 빼고 집계했습니다 ·
          당년 {missing}일 · 전년 {previousMissing}일 제외
        </p>
      )}
      {ready ? (
        <div className="mt-3 text-xs font-bold">
          <div className="flex h-7 gap-[2px] overflow-hidden rounded border border-[#d8ded4] text-white">
            {order.map((i) => (
              <div
                key={parts[i].label}
                style={{ width: share(i) + '%', background: colors[i] }}
                className="overflow-hidden text-center leading-7 whitespace-nowrap"
                title={parts[i].label + ' ' + fmt(share(i)) + '%'}
              >
                {share(i) >= 6 && parts[i].label + ' ' + fmt(share(i)) + '%'}
              </div>
            ))}
          </div>
          <div className="flex">
            <div style={{ width: share(0) + '%' }} />
            <div
              style={{ width: group + '%' }}
              className="overflow-hidden border-t-[3px] border-[#2f6b4f] pt-0.5 text-center whitespace-nowrap text-[#2f6b4f]"
            >
              단체 구성비 {fmt(group)}%
            </div>
          </div>
          <div className="flex">
            <div style={{ width: share(0) + share(1) + '%' }} />
            <div
              style={{ width: foreign + '%' }}
              className="overflow-hidden border-t-[3px] border-[#1b5e9e] pt-0.5 text-center whitespace-nowrap text-[#1b5e9e]"
            >
              외국인 구성비 {fmt(foreign)}%
            </div>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-amber-700">
          선택 기간에 전체·단체·외국인·외국인 단체가 모두 입력된 날이 없어
          구성을 계산하지 못했습니다.
        </p>
      )}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="bg-[#e3eee7] text-left">
              <th className={cell}>구분(중복 없음)</th>
              <th className={cell}>합산되는 지표</th>
              <th className={cell + ' text-right'}>당년 인원</th>
              <th className={cell + ' text-right'}>당년 비중</th>
              <th className={cell + ' text-right'}>전년 인원</th>
              <th className={cell + ' text-right'}>전년 비중</th>
              <th className={cell + ' text-right'}>비중 차이</th>
            </tr>
          </thead>
          <tbody>
            {parts.map((p, i) => (
              <tr key={p.label}>
                <td className={cell + ' font-bold'}>
                  <span
                    className="mr-2 inline-block size-3 rounded-sm align-middle"
                    style={{ background: colors[i] }}
                  />
                  {p.label}
                </td>
                <td className={cell}>{p.belongsTo}</td>
                <td className={cell + ' text-right'}>{people(p.current)}</td>
                <td className={cell + ' text-right'}>{pct(p.currentShare)}</td>
                <td className={cell + ' text-right'}>{people(p.previous)}</td>
                <td className={cell + ' text-right'}>{pct(p.previousShare)}</td>
                <td
                  className={
                    cell +
                    ' text-right font-bold ' +
                    (p.shareChange !== null && p.shareChange < 0
                      ? 'text-[#c0392b]'
                      : 'text-[#1f7a4a]')
                  }
                >
                  {gap(p.shareChange)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
