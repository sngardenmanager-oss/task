'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useCurrentTeam, withTeam } from './team-context';
import type { WorkRecord } from '@/lib/record-types';
import type { ReportDocument } from '@/lib/report-types';
import { exportReportExcel, printReport } from '@/lib/report-export';

const labels: Record<string, string> = {
  visitors: '입장객', revenue: '매출', groups: '단체', foreigners: '외국인', foreignGroups: '외국인 단체', groupGeneral: '일반 단체', groupLocal: '도민 단체', groupWelfare: '복지 단체', memo: '비고', total: '총 입도객', domestic: '내국인 입도객', foreign: '외국인 입도객', source: '자료 출처', asOf: '자료 기준일',
  changeNote: '\uBCC0\uACBD \uC0AC\uC720',
  title: '제목',
  description: '설명',
  date: '시작일',
  endDate: '종료일',
  assigneeId: '담당자 번호',
  status: '상태',
  parentId: '메인 업무 번호',
  links: '업무 연결',
  checklist: '체크리스트',
  comments: '댓글',
  body: '내용',
  reason: '사유',
  dueDate: '기한',
  result: '조치 결과',
  evidence: '근거 링크',
  decidedBy: '결정자',
  decidedAt: '결정 시각',
  taskIds: '후속 업무 번호',
};
function readable(value: unknown): string {
  if (value == null) return '없음';
  if (typeof value === 'string')
    return (
      (
        {
          scheduled: '예정',
          in_progress: '진행 중',
          completion_requested: '완료 요청',
          completed: '최종 완료',
          open: '조치 중',
          done: '조치 종료',
          on_hold: '보류',
        } as Record<string, string>
      )[value] ?? value
    );
  if (Array.isArray(value))
    return value
      .map((item) =>
        typeof item === 'object' && item
          ? Object.entries(item)
              .filter(([key]) =>
                [
                  'text',
                  'body',
                  'taskId',
                  'kind',
                  'done',
                  'removedAt',
                ].includes(key),
              )
              .map(([key, v]) => `${key}: ${readable(v)}`)
              .join(' / ')
          : readable(item),
      )
      .join('\n');
  return JSON.stringify(value);
}
export default function RecordBrowser({
  accessToken,
  taskId,
  reportId,
  onOpenReport,
  openTask,
}: {
  accessToken: string;
  taskId?: string;
  reportId?: string;
  onOpenReport?: (report: ReportDocument) => void;
  openTask?: (id: string) => void;
}) {
  const teamId = useCurrentTeam()?.id;
  const [items, setItems] = useState<WorkRecord[]>([]);
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<WorkRecord | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      page: String(page),
      q: query,
      type,
      from,
      to,
    });
    if (taskId) params.set('taskId', taskId);
    if (reportId) params.set('reportId', reportId);
    const timer = setTimeout(() => {
      setBusy(true);
      setError('');
      fetch(withTeam('/api/records?' + params, teamId), {
        headers: { authorization: 'Bearer ' + accessToken },
        signal: controller.signal,
      })
        .then(async (response) => {
          const body = (await response.json()) as {
            error?: string;
            items: WorkRecord[];
          };
          if (!response.ok) throw new Error(body.error);
          setItems(body.items);
        })
        .catch((e) => {
          if (e.name !== 'AbortError') setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    accessToken,
    teamId,
    taskId,
    reportId,
    query,
    type,
    from,
    to,
    page,
    refresh,
  ]);
  async function show(id: string) {
    setError('');
    try {
      const response = await fetch(
        withTeam('/api/records?id=' + encodeURIComponent(id), teamId),
        { headers: { authorization: 'Bearer ' + accessToken } },
      );
      const body = (await response.json()) as {
        error?: string;
        items: WorkRecord[];
      };
      if (!response.ok) throw new Error(body.error);
      setDetail(body.items[0] ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '기록 조회 실패');
    }
  }
  const report =
    detail?.entity_type === 'report'
      ? (detail.data as unknown as ReportDocument)
      : null;
  const field = 'min-w-0 rounded-lg border p-2 text-sm';
  return (
    <section className="space-y-3 rounded-2xl border border-[#d8ded4] bg-white p-4">
      <h3 className="font-bold text-[#245b43]">
        {taskId ? '업무의 보고와 변경 이력' : '기록 검색'}
      </h3>
      <p className="text-xs text-[#64776a]">
        기능 적용 이후 저장된 변경을 조회합니다. 과거 확정본은 장기 보관함에서
        확인할 수 있습니다.
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          className={field + ' flex-1'}
          aria-label="기록 검색어"
          placeholder="제목·내용·근거 검색"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
        <select
          className={field}
          aria-label="기록 종류"
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setPage(0);
          }}
        >
          <option value="">모든 기록</option>
          <option value="task">업무</option>
          <option value="report">보고</option>
          <option value="decision">결정·후속 조치</option>
          <option value="statistic">통계</option>
          <option value="note">특이사항</option>
          <option value="routine">루틴</option>
        </select>
        <input
          className={field}
          type="date"
          aria-label="기록 시작일"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setPage(0);
          }}
        />
        <input
          className={field}
          type="date"
          aria-label="기록 종료일"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setPage(0);
          }}
        />
        <Button variant="outline" onClick={() => setRefresh((v) => v + 1)}>
          기록 새로고침
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {busy && <p>기록을 불러오는 중…</p>}
      <ol className="space-y-2">
        {items.map((item) => (
          <li key={item.id} className="rounded-xl bg-[#f4f6f2] p-3">
            <button
              className="text-left font-semibold underline"
              onClick={() => void show(item.id)}
            >
              {item.action} · {item.title}
            </button>
            <p className="mt-1 text-xs text-[#64776a]">
              {item.actor.name ?? '처리자 기록 없음'} ·{' '}
              {new Date(item.recorded_at).toLocaleString('ko-KR')}
              {item.actor.note ? ' · ' + item.actor.note : ''}
            </p>
          </li>
        ))}
      </ol>
      {!busy && !items.length && (
        <p className="text-sm text-[#64776a]">조건에 맞는 기록이 없습니다.</p>
      )}
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          disabled={page === 0 || busy}
          onClick={() => setPage((v) => v - 1)}
        >
          이전
        </Button>
        <span>{page + 1}쪽</span>
        <Button
          variant="outline"
          disabled={items.length < 20 || busy}
          onClick={() => setPage((v) => v + 1)}
        >
          다음
        </Button>
      </div>
      {detail && (
        <div className="space-y-3 rounded-xl border border-[#b8cbbd] p-3">
          <div className="flex justify-between gap-3">
            <h4 className="font-bold">
              {detail.title} · {detail.action}
            </h4>
            <Button variant="outline" onClick={() => setDetail(null)}>
              상세 닫기
            </Button>
          </div>
          {report ? (
            <>
              <p className="text-sm">
                당시 보고 · {report.config.meetingDate} · 수정 {report.revision}{' '}
                · {report.rows.filter((r) => r.visible).length}개 표출 항목
              </p>
              {report.rows
                .filter((r) => r.visible)
                .map((row) => (
                  <div key={row.id} className="border-t pt-2 text-sm">
                    <strong>{row.title}</strong>
                    <p className="whitespace-pre-wrap">{row.summary}</p>
                    <p>
                      {row.assignee} · {row.date} · {row.status}
                    </p>
                    {row.taskId && openTask && (
                      <button
                        className="underline"
                        onClick={() => openTask(row.taskId!)}
                      >
                        현재 업무 보기
                      </button>
                    )}
                  </div>
                ))}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() =>
                    void exportReportExcel(report).catch((e) =>
                      setError(e.message),
                    )
                  }
                >
                  당시 Excel
                </Button>
                <Button variant="outline" onClick={() => printReport(report)}>
                  당시 PDF / 인쇄
                </Button>
                {onOpenReport && report.status === 'final' && (
                  <Button onClick={() => onOpenReport(report)}>
                    확정본 열기
                  </Button>
                )}
              </div>
            </>
          ) : (
            <div className="space-y-2">
              {Object.entries(labels)
                .filter(
                  ([key]) =>
                    JSON.stringify(detail.before_data?.[key]) !==
                    JSON.stringify(detail.data?.[key]),
                )
                .map(([key, label]) => (
                  <div
                    key={key}
                    className="grid gap-2 border-t pt-2 text-sm sm:grid-cols-[110px_1fr_1fr]"
                  >
                    <strong>{label}</strong>
                    <div className="whitespace-pre-wrap break-all text-[#7d655d]">
                      이전: {readable(detail.before_data?.[key])}
                    </div>
                    <div className="whitespace-pre-wrap break-all">
                      변경: {readable(detail.data?.[key])}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
