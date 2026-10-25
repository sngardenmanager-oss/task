'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ReportRow } from '@/lib/report-types';

type Order = 'newest' | 'oldest';

/** 완료·표출 정리. 보고서에 나가는 행을 완료된 것과 진행 중인 것으로 나눠 날짜순으로 보고,
 * 더 보고할 필요가 없는 행은 아카이브합니다. 아카이브는 보고서 행만 바꾸며 캘린더 업무는 그대로 둡니다. */
export default function ReportTidy({
  rows,
  disabled,
  onArchive,
  onRestore,
}: {
  rows: ReportRow[];
  disabled: boolean;
  onArchive: (ids: string[]) => void;
  onRestore: (ids: string[]) => void;
}) {
  const [order, setOrder] = useState<Order>('newest');
  const [selected, setSelected] = useState<string[]>([]);
  const done = (row: ReportRow) => row.status === '최종 완료';
  const sortKey = (row: ReportRow) =>
    done(row) ? (row.completedAt?.slice(0, 10) ?? row.date) : row.date;
  const sorted = (list: ReportRow[]) =>
    [...list].sort((a, b) => {
      const diff = sortKey(a).localeCompare(sortKey(b)) || a.title.localeCompare(b.title);
      return order === 'newest' ? -diff : diff;
    });
  const completed = sorted(rows.filter((r) => r.visible && done(r)));
  const inProgress = sorted(rows.filter((r) => r.visible && !r.closed && !done(r)));
  const archived = sorted(rows.filter((r) => r.closed && !r.visible));
  const live = new Set([...completed, ...inProgress].map((r) => r.id));
  const picked = selected.filter((id) => live.has(id));
  const toggle = (id: string, on: boolean) =>
    setSelected((current) => (on ? [...current, id] : current.filter((item) => item !== id)));
  const archive = (ids: string[]) => {
    onArchive(ids);
    setSelected((current) => current.filter((id) => !ids.includes(id)));
  };
  const chip = (on: boolean) =>
    'min-h-8 rounded-full border px-3 text-xs font-bold ' +
    (on ? 'border-[#2f6b4f] bg-[#2f6b4f] text-white' : 'border-[#d8ded4] bg-white text-[#43594b]');

  function list(title: string, note: string, items: ReportRow[], dateLabel: string) {
    return (
      <section className="space-y-2 rounded-2xl border border-[#d8ded4] bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-bold">
              {title} · {items.length}건
            </h3>
            <p className="text-sm text-[#64776a]">{note}</p>
          </div>
          {items.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => archive(items.map((r) => r.id))}
            >
              {items.length}건 모두 아카이브
            </Button>
          )}
        </div>
        {!items.length && <p className="text-sm text-[#64776a]">해당하는 항목이 없습니다.</p>}
        <ul className="divide-y">
          {items.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <input
                type="checkbox"
                aria-label={row.title + ' 선택'}
                checked={selected.includes(row.id)}
                disabled={disabled}
                onChange={(e) => toggle(row.id, e.target.checked)}
              />
              <span className="w-24 shrink-0 tabular-nums text-[#64776a]">
                {dateLabel} {sortKey(row).slice(5)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="mr-2 rounded bg-[#e3eee7] px-1.5 text-xs text-[#245b43]">
                  {row.category || '기타'}
                </span>
                <b>{row.title}</b>
                <span className="block text-xs text-[#64776a]">
                  {row.assignee || '담당 미정'} · {row.status}
                  {row.closed ? ' · 이번 회차 완결 표기' : ''}
                  {row.section === 'before' ? ' · 이전 진행' : ' · 이후 진행'}
                </span>
              </span>
              <Button size="sm" variant="outline" disabled={disabled} onClick={() => archive([row.id])}>
                아카이브
              </Button>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#d8ded4] bg-[#f4f6f2] p-3 text-sm">
        <p className="min-w-0 flex-1 text-[#43594b]">
          보고서에 나가는 항목을 날짜순으로 봅니다. <b>아카이브</b>하면 이번 보고서부터 빠지고 완결 아카이브로
          옮겨집니다. 캘린더의 업무와 기록은 그대로 남습니다.
        </p>
        <span className="font-bold text-[#43594b]">정렬</span>
        <button type="button" aria-pressed={order === 'newest'} className={chip(order === 'newest')} onClick={() => setOrder('newest')}>
          최신 순
        </button>
        <button type="button" aria-pressed={order === 'oldest'} className={chip(order === 'oldest')} onClick={() => setOrder('oldest')}>
          오래된 순
        </button>
      </div>
      {disabled && (
        <p className="rounded-lg bg-[#fff6e5] px-3 py-2 text-sm text-[#7a5a12]">
          제출·검토 중이거나 확정된 보고서는 볼 수만 있습니다. 정리하려면 제출을 철회해 주세요.
        </p>
      )}
      {picked.length > 0 && !disabled && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-[#e3eee7] p-3 text-sm">
          {picked.length}건 선택
          <Button size="sm" onClick={() => archive(picked)}>
            선택 항목 아카이브
          </Button>
          <Button size="sm" variant="outline" onClick={() => setSelected([])}>
            선택 해제
          </Button>
        </div>
      )}
      {list(
        '완료된 업무',
        '최종 완료된 항목입니다. 최신 순은 완료일이 가까운 것부터 보여 줍니다.',
        completed,
        '완료',
      )}
      {list(
        '표출 중인 진행 업무',
        '아직 완료되지 않았지만 보고서에 나가는 항목입니다. 일정 날짜 기준으로 정렬합니다.',
        inProgress,
        '일정',
      )}
      {archived.length > 0 && (
        <section className="space-y-2 rounded-2xl border border-dashed border-[#cbd8ce] bg-white p-4">
          <h3 className="font-bold">이번에 아카이브한 항목 · {archived.length}건</h3>
          <p className="text-sm text-[#64776a]">
            초안을 저장하면 다음 회차부터 완결 아카이브(보고서 보관함 탭)에서 확인·재개할 수 있습니다.
          </p>
          <ul className="divide-y">
            {archived.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <b>{row.title}</b>
                  <span className="block text-xs text-[#64776a]">
                    {row.assignee || '담당 미정'} · {row.status}
                  </span>
                </span>
                <Button size="sm" variant="outline" disabled={disabled} onClick={() => onRestore([row.id])}>
                  되돌리기
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
