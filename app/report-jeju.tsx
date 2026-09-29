'use client';

import { useMemo, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type {
  JejuArrival,
  ReportDocument,
  ReportStore,
} from '@/lib/report-types';
import { todayKst } from '@/lib/reports';
import { downloadReportBlob } from '@/lib/report-export';
import {
  applyJejuImport,
  calculateJeju,
  jejuCsv,
  jejuHeaders,
  jejuNote,
  jejuPeriodNote,
  jejuSummaryRows,
  jejuTitle,
  previewJejuCsv,
  undoJejuImport,
} from '@/lib/jeju-arrivals';

const panel = 'min-w-0 rounded-2xl border border-[#d8ded4] bg-white p-4 md:p-5';
const input =
  'min-h-10 w-full rounded-lg border border-[#d8ded4] bg-white px-3 py-2 text-sm';
const cell = 'border-b border-[#e3eee7] px-3 py-2.5';

export function JejuReport({
  report,
  store,
}: {
  report: ReportDocument;
  store: ReportStore;
}) {
  const final = report.status === 'final';
  const summary = calculateJeju(
    final ? (report.jejuArrivals ?? []) : (store.jejuArrivals ?? []),
    final ? report.statistics : store.statistics,
    report.config.statsStart,
    report.config.statsEnd,
  );
  return (
    <section className={panel} aria-label={jejuTitle}>
      <h3 className="font-bold text-[#245b43]">{jejuTitle}</h3>
      {final && report.jejuArrivals === undefined ? (
        <p className="mt-2 text-sm text-[#64776a]">
          입도객 자료 미포함 · 기존 확정본입니다.
        </p>
      ) : (
        <>
          <p className="my-2 text-xs text-[#64776a]">
            {jejuPeriodNote(summary)}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-right text-sm tabular-nums">
              <thead>
                <tr className="bg-[#e3eee7] text-[#245b43]">
                  {['항목', '총 입도객', '내국인 입도객', '외국인 입도객'].map(
                    (h, i) => (
                      <th
                        key={h}
                        scope="col"
                        className={cell + (i === 0 ? ' text-left' : '')}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {jejuSummaryRows(summary).map(([label, ...values]) => (
                  <tr
                    key={label}
                    className={
                      label.includes('비중') ? 'bg-[#f3f8f4] font-semibold' : ''
                    }
                  >
                    <th scope="row" className={cell + ' text-left font-medium'}>
                      {label}
                    </th>
                    {values.map((v, i) => (
                      <td
                        key={i}
                        className={
                          cell +
                          (v.includes('증가')
                            ? ' bg-[#fdecec] font-bold text-[#d32f2f]'
                            : v.includes('감소')
                              ? ' bg-[#e6effb] font-bold text-[#1565c0]'
                              : '')
                        }
                      >
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-[#64776a]">
            {jejuNote}. 비중 변화는 %p이며, 기간 자료가 부족하면 비중·증감은
            계산하지 않습니다.
          </p>
          <p className="mt-2 text-xs text-[#64776a]">
            {summary.sources.length
              ? '자료 출처: ' + summary.sources.join(' / ')
              : '자료 없음 · 경영지표 탭에서 당년·전년 입도객 CSV를 업로드해 주세요.'}
          </p>
        </>
      )}
    </section>
  );
}

export function JejuImportPanel({
  report,
  store,
  busy,
  actorName,
  onPersist,
}: {
  report: ReportDocument;
  store: ReportStore;
  busy: boolean;
  actorName: string;
  onPersist: (next: ReportStore) => Promise<ReportStore>;
}) {
  const [file, setFile] = useState<{ text: string; name: string } | null>(null);
  const [source, setSource] = useState('');
  const [asOf, setAsOf] = useState(todayKst);
  const [status, setStatus] = useState<JejuArrival['status']>('provisional');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const final = report.status === 'final';
  const disabled = final || busy || working;
  const preview = useMemo(
    () => (file ? previewJejuCsv(file.text, { source, asOf, status }) : null),
    [file, source, asOf, status],
  );
  const rows = (final ? report.jejuArrivals : store.jejuArrivals) ?? [];
  const oldByDate = new Map((store.jejuArrivals ?? []).map((r) => [r.date, r]));
  async function run(action: () => Promise<void>) {
    if (disabled) return;
    setError('');
    setMessage('');
    setWorking(true);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : '입도객 자료 처리 실패');
    } finally {
      setWorking(false);
    }
  }
  function download(text: string, filename: string) {
    downloadReportBlob(
      new Blob([text], { type: 'text/csv;charset=utf-8' }),
      filename,
    );
  }
  const number = (v: number | null | undefined) =>
    v == null ? '미입력' : v.toLocaleString('ko-KR');
  return (
    <section className={panel} aria-label="제주 입도객 자료 관리">
      <h3 className="font-bold">제주 입도객 자료 관리</h3>
      <p className="my-2 text-sm text-[#64776a]">
        날짜별 입도객 CSV를 별도로 올립니다. 전년 동기간 자료도 함께 입력해
        주세요. 총계가 비어 있으면 내국인 + 외국인으로 계산합니다.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => download(jejuCsv([]), '제주입도객_입력양식.csv')}
        >
          <Download />
          입도객 CSV 양식
        </Button>
        <Button
          variant="outline"
          onClick={() => download(jejuCsv(rows), '제주입도객_통계.csv')}
        >
          <Download />
          입도객 CSV 내려받기
        </Button>
      </div>
      <fieldset
        disabled={disabled}
        className="mt-4 space-y-3 disabled:opacity-60"
      >
        <legend className="sr-only">입도객 업로드</legend>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-sm">
            자료 출처
            <input
              className={input}
              value={source}
              maxLength={500}
              placeholder="원자료의 기관명 또는 문서명"
              onChange={(e) => setSource(e.target.value)}
            />
          </label>
          <label className="text-sm">
            자료 기준일
            <input
              type="date"
              className={input}
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
            />
          </label>
          <label className="text-sm">
            자료 상태
            <select
              className={input}
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as JejuArrival['status'])
              }
            >
              <option value="provisional">잠정</option>
              <option value="final">확정</option>
            </select>
          </label>
        </div>
        <p className="text-xs text-[#64776a]">
          CSV에 출처·자료기준일·자료상태가 있으면 파일 값을 우선 사용합니다.
          같은 날짜는 행 전체를 교체하며, 빈칸은 미입력으로 저장합니다.
        </p>
        <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-4 text-sm">
          <Upload className="size-4" />
          입도객 CSV 업로드
          <input
            className="sr-only"
            aria-label="입도객 CSV 파일"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const selected = e.target.files?.[0];
              e.target.value = '';
              if (selected)
                void run(async () => {
                  setFile(null);
                  if (selected.size > 3_000_000)
                    throw new Error('CSV 파일은 3MB 이하로 올려 주세요.');
                  setFile({ name: selected.name, text: await selected.text() });
                });
            }}
          />
        </label>
      </fieldset>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {message && (
        <output className="mt-3 block text-sm text-[#245b43]">{message}</output>
      )}
      {!final && file && preview && (
        <div className="mt-4 space-y-3 rounded-xl border p-3">
          <p className="font-semibold">
            {file.name} · 미리보기 {preview.rows.length}일 · 기존 날짜{' '}
            {preview.rows.filter((r) => oldByDate.has(r.date)).length}일 교체
          </p>
          {preview.errors.length > 0 && (
            <div role="alert" className="text-sm text-red-700">
              오류 {preview.errors.length}건 · 오류를 수정해야 저장할 수
              있습니다.
              <ul className="list-inside list-disc">
                {preview.errors.slice(0, 20).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
              {preview.errors.length > 20 && <p>처음 20건만 표시합니다.</p>}
            </div>
          )}
          <div className="max-h-80 overflow-auto">
            <table className="w-full min-w-[780px] text-left text-sm">
              <thead>
                <tr>
                  {[
                    '날짜',
                    '총 입도객',
                    '내국인',
                    '외국인',
                    '출처 · 기준일 · 상태',
                  ].map((h) => (
                    <th key={h} scope="col" className={cell}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 100).map((r) => {
                  const old = oldByDate.get(r.date);
                  return (
                    <tr key={r.date}>
                      <th scope="row" className={cell}>
                        {r.date}
                      </th>
                      {(['total', 'domestic', 'foreign'] as const).map((k) => (
                        <td key={k} className={cell}>
                          {old ? number(old[k]) + ' → ' : ''}
                          {number(r[k])}
                        </td>
                      ))}
                      <td className={cell}>
                        {old && (
                          <span className="block text-xs text-[#64776a]">
                            기존: {old.source} · {old.asOf} ·{' '}
                            {old.status === 'final' ? '확정' : '잠정'} →
                          </span>
                        )}
                        {r.source} · {r.asOf} ·{' '}
                        {r.status === 'final' ? '확정' : '잠정'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {preview.rows.length > 100 && (
            <p className="text-xs">
              처음 100일만 미리 봅니다. 저장 시 전체 {preview.rows.length}일을
              반영합니다.
            </p>
          )}
          <div className="flex gap-2">
            <Button
              disabled={
                disabled || preview.errors.length > 0 || !preview.rows.length
              }
              onClick={() =>
                void run(async () => {
                  await onPersist(
                    applyJejuImport(store, preview.rows, file.name, actorName),
                  );
                  setFile(null);
                  setMessage(
                    '입도객 자료를 저장했습니다. 기존 확정본은 유지됩니다.',
                  );
                })
              }
            >
              입도객 자료 반영
            </Button>
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() => setFile(null)}
            >
              취소
            </Button>
          </div>
        </div>
      )}
      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-medium">
          저장된 입도객 자료 {rows.length}일{final ? ' · 확정본' : ''}
        </summary>
        <div className="mt-2 max-h-80 overflow-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr>
                {jejuHeaders.map((h) => (
                  <th scope="col" key={h} className={cell}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.date}>
                  {[
                    r.date,
                    number(r.total),
                    number(r.domestic),
                    number(r.foreign),
                    r.source,
                    r.asOf,
                    r.status === 'final' ? '확정' : '잠정',
                  ].map((v, i) => (
                    <td key={i} className={cell}>
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {!final && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium">
            입도객 업로드 이력 · 되돌리기
          </summary>
          {[...(store.jejuImports ?? [])].reverse().map((entry) => (
            <div
              key={entry.id}
              className="flex flex-wrap items-center justify-between gap-2 border-b py-3 text-sm"
            >
              <span>
                {entry.filename} · {entry.actor} ·{' '}
                {new Date(entry.at).toLocaleString('ko-KR')} ·{' '}
                {entry.pruned
                  ? '· 되돌리기 기록 정리됨'
                  : `${entry.after.length}일 ${entry.undoneAt ? '· 복원됨' : ''}`}
              </span>
              <Button
                variant="outline"
                disabled={disabled || !!entry.undoneAt || !!entry.pruned}
                onClick={() =>
                  void run(async () => {
                    await onPersist(undoJejuImport(store, entry.id));
                    setMessage('입도객 업로드 이전 값으로 복원했습니다.');
                  })
                }
              >
                입도객 업로드 되돌리기
              </Button>
            </div>
          ))}
        </details>
      )}
    </section>
  );
}
