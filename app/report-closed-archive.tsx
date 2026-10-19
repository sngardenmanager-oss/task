'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ReportTrack } from '@/lib/report-types';

const PAGE = 30;

/** 완결 항목 아카이브. 보고 완결한 항목은 다음 회차부터 빠지지만 이 목록에 계속 남고(삭제하지 않음), 언제든 재개할 수 있습니다. */
export default function ClosedArchive({
  tracks,
  disabled,
  onReopen,
}: {
  tracks: ReportTrack[];
  disabled: boolean;
  onReopen: (track: ReportTrack) => void;
}) {
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const closedAt = (track: ReportTrack) =>
    track.history.findLast((h) => h.closed)?.at ?? '';
  const words = query.trim().toLowerCase();
  const list = tracks
    .filter(
      (track) =>
        !words ||
        [track.row.title, track.row.category, track.row.assignee, track.row.closeNote]
          .join(' ')
          .toLowerCase()
          .includes(words),
    )
    .sort((a, b) => closedAt(b).localeCompare(closedAt(a)));
  return (
    <section id="report-closed-archive" className="scroll-mt-44 space-y-3 rounded-2xl border border-[#d8ded4] bg-white p-4 md:p-5">
      <div>
        <h3 className="font-bold">완결 항목 아카이브 · {tracks.length}건</h3>
        <p className="mt-1 text-sm text-[#64776a]">
          보고 완결한 진행 내용입니다. 보고서에서는 빠지지만 이 목록은 삭제되지 않습니다. 재개하면 현재 보고서에
          다시 포함되고, 초안을 저장하면 다음 회차에도 이어집니다.
        </p>
      </div>
      <input
        className="w-full rounded-lg border border-[#d8ded4] p-2 text-sm"
        aria-label="완결 항목 검색"
        placeholder="제목·분류·담당자·완결 사유 검색"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setLimit(PAGE);
        }}
      />
      {!list.length && (
        <p className="text-sm text-[#64776a]">
          {tracks.length ? '검색 결과가 없습니다.' : '아직 완결한 항목이 없습니다.'}
        </p>
      )}
      <ul className="max-h-[32rem] divide-y overflow-y-auto">
        {list.slice(0, limit).map((track) => {
          const last = track.history.findLast((h) => h.closed);
          return (
            <li key={track.id + track.scopeKey} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div className="min-w-0">
                <p className="font-medium">
                  <span className="mr-2 rounded bg-[#e3eee7] px-1.5 text-xs text-[#245b43]">
                    {track.row.category || '기타'}
                  </span>
                  {track.row.title}
                </p>
                <p className="text-xs text-[#64776a]">
                  {track.row.assignee || '담당 미정'} · 완결 {last?.at.slice(0, 10) ?? '기록 없음'}
                  {last?.actor ? ' · ' + last.actor : ''}
                  {last?.note || track.row.closeNote ? ' · ' + (last?.note || track.row.closeNote) : ''}
                </p>
              </div>
              <Button size="sm" variant="outline" disabled={disabled} onClick={() => onReopen(track)}>
                보고 재개
              </Button>
            </li>
          );
        })}
      </ul>
      {list.length > limit && (
        <Button variant="outline" className="w-full" onClick={() => setLimit(limit + PAGE)}>
          더 보기 ({list.length - limit}건 남음)
        </Button>
      )}
    </section>
  );
}
