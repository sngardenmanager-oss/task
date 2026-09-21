'use client';

import { calculateComposition } from '@/lib/reports';
import type { Statistic } from '@/lib/report-types';

const colors = ['#8a968e', '#2f6b4f', '#1b5e9e', '#d9822b'];
const fmt = (n: number, digits = 1) =>
  n.toLocaleString('ko-KR', { maximumFractionDigits: digits });
const pct = (n: number | null) => (n === null ? '자료 없음' : fmt(n) + '%');
const gap = (n: number | null) =>
  n === null ? '—' : (n > 0 ? '+' : '') + n.toFixed(1) + '%p';

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
  const parts = calculateComposition(rows, start, end);
  const ready = parts.every((p) => p.currentShare !== null);
  // 외국인 단체를 가운데 두어 두 구성비가 서로 이어진 구간으로 보이게 한다.
  const order = [0, 1, 3, 2];
  const share = (i: number) => parts[i].currentShare ?? 0;
  const group = share(1) + share(3);
  const foreign = share(2) + share(3);
  return (
    <section className="rounded-2xl border border-[#d8ded4] bg-white p-4 md:p-5">
      <h3 className="font-bold">단체·외국인 구성비 한눈에 보기</h3>
      <p className="mt-1 text-sm text-[#64776a]">
        외국인 단체는 <b>단체 구성비</b>와 <b>외국인 구성비</b>에 모두 들어
        있어서 두 비율을 더하면 안 됩니다. 아래는 전체 입장객을 겹치지 않게 나눈
        값입니다.
      </p>
      {ready ? (
        <div className="mt-3 text-xs font-bold">
          <div className="flex h-7 overflow-hidden rounded border border-[#d8ded4] text-white">
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
          선택 기간에 비어 있거나 서로 맞지 않는 통계가 있어 구성을 계산하지
          못했습니다. 전체·단체·외국인·외국인 단체 입력값을 확인해 주세요.
        </p>
      )}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="bg-[#e3eee7] text-left">
              <th className="border border-[#d8ded4] p-2">구분(중복 없음)</th>
              <th className="border border-[#d8ded4] p-2">합산되는 지표</th>
              <th className="border border-[#d8ded4] p-2 text-right">당년</th>
              <th className="border border-[#d8ded4] p-2 text-right">전년</th>
              <th className="border border-[#d8ded4] p-2 text-right">
                비중 차이
              </th>
            </tr>
          </thead>
          <tbody>
            {parts.map((p, i) => (
              <tr key={p.label}>
                <td className="border border-[#d8ded4] p-2 font-bold">
                  <span
                    className="mr-2 inline-block size-3 rounded-sm align-middle"
                    style={{ background: colors[i] }}
                  />
                  {p.label}
                </td>
                <td className="border border-[#d8ded4] p-2">{p.belongsTo}</td>
                <td className="border border-[#d8ded4] p-2 text-right">
                  {p.current === null ? '자료 없음' : fmt(p.current, 0) + '명'}{' '}
                  · {pct(p.currentShare)}
                </td>
                <td className="border border-[#d8ded4] p-2 text-right">
                  {p.previous === null
                    ? '자료 없음'
                    : fmt(p.previous, 0) + '명'}{' '}
                  · {pct(p.previousShare)}
                </td>
                <td
                  className={
                    'border border-[#d8ded4] p-2 text-right font-bold ' +
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
