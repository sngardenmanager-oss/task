'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useCurrentTeam, withTeam } from './team-context';
import RecordBrowser from './record-browser';
import type { ReportDocument } from '@/lib/report-types';
import type { WorkDecision } from '@/lib/record-types';
import type { Member, Task, WorkspaceState } from '@/lib/types';
import { workflowLabels } from '@/lib/report-workflow';

export function LongTermReports({
  accessToken,
  onOpen,
}: {
  accessToken: string;
  onOpen: (r: ReportDocument) => void;
}) {
  const teamId = useCurrentTeam()?.id;
  const [items, setItems] = useState<
    {
      report_id: string;
      archived_at: string;
      config: ReportDocument['config'];
      revision: number;
      workflow?: ReportDocument['workflow'];
    }[]
  >([]);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setBusy(true);
      setError('');
      fetch(
        withTeam(
          '/api/records?kind=archive&page=' +
            page +
            '&q=' +
            encodeURIComponent(query),
          teamId,
        ),
        {
          headers: { authorization: 'Bearer ' + accessToken },
          signal: controller.signal,
        },
      )
        .then(async (r) => {
          const b = (await r.json()) as {
            error?: string;
            items: {report_id:string;archived_at:string;config:ReportDocument['config'];revision:number;workflow?:ReportDocument['workflow']}[];
          };
          if (!r.ok) throw new Error(b.error);
          setItems(b.items);
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
  }, [accessToken, teamId, page, query]);
  async function open(id: string) {
    setBusy(true);
    setError('');
    try {
      const r = await fetch(
        withTeam(
          '/api/records?kind=archive&reportId=' + encodeURIComponent(id),
          teamId,
        ),
        { headers: { authorization: 'Bearer ' + accessToken } },
      );
      const b = (await r.json()) as {
        error?: string;
        items: {payload:ReportDocument}[];
      };
      if (!r.ok || !b.items[0])
        throw new Error(b.error ?? '보고서를 찾지 못했습니다.');
      onOpen(b.items[0].payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : '보관본 조회 실패');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3 rounded-2xl border bg-white p-4">
      <h3 className="font-bold text-[#245b43]">장기 보관함</h3>
      <p className="text-sm text-[#64776a]">
        백업 후 활성 목록에서 정리한 확정본도 내용과 버전을 유지합니다. 과거
        정리된 자료는 백업 복원 후 조회할 수 있습니다.
      </p>
      <input
        className="w-full rounded-lg border p-2"
        aria-label="장기 보관 보고 검색"
        placeholder="보고서 제목 검색"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setPage(0);
        }}
      />
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {busy && <p>불러오는 중…</p>}
      {items.map((item) => (
        <article
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#f4f6f2] p-3"
          key={item.report_id}
        >
          <div>
            <strong>{item.config.title}</strong>
            <p className="text-sm">
              {item.config.meetingDate} · 수정 {item.revision} ·{' '}
              {item.workflow
                ? workflowLabels[item.workflow.status]
                : '기존 확정본'}
            </p>
            <p className="break-all text-xs text-[#64776a]">{item.report_id}</p>
          </div>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void open(item.report_id)}
          >
            보관본 열기
          </Button>
        </article>
      ))}
      {!busy && !items.length && <p>보관된 확정본이 없습니다.</p>}
      <div className="flex gap-3">
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
    </section>
  );
}

export function ReportDecisions({
  report,
  accessToken,
  actor,
  data,
  openTask,
  onTask,
}: {
  report: ReportDocument;
  accessToken: string;
  actor: Member;
  data: WorkspaceState;
  openTask: (id: string) => void;
  onTask: (task: Task) => void;
}) {
  const teamId = useCurrentTeam()?.id;
  const [items, setItems] = useState<WorkDecision[]>([]);
  const [editing, setEditing] = useState<WorkDecision | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [createTask, setCreateTask] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(
      withTeam(
        '/api/records?kind=decisions&reportId=' + encodeURIComponent(report.id),
        teamId,
      ),
      {
        headers: { authorization: 'Bearer ' + accessToken },
        signal: controller.signal,
      },
    )
      .then(async (r) => {
        const b = (await r.json()) as {
          error?: string;
          items: WorkDecision[];
        };
        if (!r.ok) throw new Error(b.error);
        setItems(b.items);
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      });
    return () => controller.abort();
  }, [report.id, accessToken, teamId, refresh]);
  function start() {
    setCreateTask(false);
    setEditing({
      id: crypto.randomUUID(),
      version: 0,
      updated_at: '',
      payload: {
        title: '',
        body: '',
        reason: '',
        reportId: report.id,
        taskIds: [],
        assigneeId: data.members.find((m) => m.active)?.id ?? '',
        dueDate: report.config.planEnd,
        status: 'open',
        evidence: '',
        result: '',
        decidedBy: '',
        decidedAt: '',
      },
    });
  }
  async function save() {
    if (!editing || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(withTeam('/api/records', teamId), {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + accessToken,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          ...editing,
          requestId: crypto.randomUUID(),
          createTask,
        }),
      });
      const body = (await response.json()) as { error?: string; task?: Task };
      if (!response.ok) throw new Error(body.error);
      if (body.task) onTask(body.task);
      setEditing(null);
      setRefresh((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setBusy(false);
    }
  }
  function set(key: keyof WorkDecision['payload'], value: unknown) {
    setEditing((item) =>
      item ? { ...item, payload: { ...item.payload, [key]: value } } : null,
    );
  }
  const admin = actor.role === 'admin';
  const field = 'w-full rounded-lg border p-2 text-sm';
  return (
    <section className="space-y-3 rounded-2xl border bg-white p-4">
      <div className="flex flex-wrap justify-between gap-3">
        <h3 className="font-bold text-[#245b43]">회의 결정과 후속 조치</h3>
        {admin && <Button onClick={start}>결정 등록</Button>}
      </div>
      <p className="text-sm text-[#64776a]">
        확정 보고본은 유지하고, 이후의 결정과 조치 결과를 별도로 기록합니다.
      </p>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {items.map((item) => (
        <article
          key={item.id}
          className="space-y-2 rounded-xl bg-[#f4f6f2] p-3"
        >
          <strong>{item.payload.title}</strong>
          <p className="text-sm">
            {item.payload.status === 'done'
              ? '조치 종료'
              : item.payload.status === 'on_hold'
                ? '보류'
                : '조치 중'}{' '}
            · 기한 {item.payload.dueDate} ·{' '}
            {data.members.find((m) => m.id === item.payload.assigneeId)?.name ??
              '담당자 기록 확인'}
          </p>
          <p className="whitespace-pre-wrap text-sm">{item.payload.body}</p>
          <p className="text-xs">
            결정 {item.payload.decidedBy} ·{' '}
            {new Date(item.payload.decidedAt).toLocaleString('ko-KR')}
          </p>
          {item.payload.result && (
            <p className="text-sm">결과: {item.payload.result}</p>
          )}
          {item.payload.evidence && (
            <a
              className="text-sm underline"
              href={item.payload.evidence}
              target="_blank"
              rel="noreferrer"
            >
              근거 자료 열기
            </a>
          )}
          <div className="flex flex-wrap gap-2">
            {item.payload.taskIds.map((id) => (
              <Button variant="outline" key={id} onClick={() => openTask(id)}>
                {data.tasks.find((t) => t.id === id)?.title ?? '연결 업무'}
              </Button>
            ))}
            {(admin || item.payload.assigneeId === actor.id) && (
              <Button
                variant="outline"
                onClick={() => {
                  setEditing(structuredClone(item));
                  setCreateTask(false);
                }}
              >
                결과·변경 기록
              </Button>
            )}
          </div>
        </article>
      ))}
      {!items.length && <p className="text-sm">등록된 결정이 없습니다.</p>}
      {editing && (
        <div className="space-y-3 rounded-xl border bg-[#f9faf7] p-3">
          {admin && (
            <>
              <label className="block text-sm">
                결정 제목
                <input
                  aria-label="결정 제목"
                  className={field}
                  value={editing.payload.title}
                  onChange={(e) => set('title', e.target.value)}
                />
              </label>
              <label className="block text-sm">
                결정 내용
                <textarea
                  aria-label="결정 내용"
                  className={field}
                  value={editing.payload.body}
                  onChange={(e) => set('body', e.target.value)}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="text-sm">
                  조치 담당자
                  <select
                    className={field}
                    value={editing.payload.assigneeId}
                    onChange={(e) => set('assigneeId', e.target.value)}
                  >
                    {data.members
                      .filter((m) => m.active)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="text-sm">
                  조치 기한
                  <input
                    className={field}
                    type="date"
                    value={editing.payload.dueDate}
                    onChange={(e) => set('dueDate', e.target.value)}
                  />
                </label>
                <label className="text-sm">
                  조치 상태
                  <select
                    className={field}
                    value={editing.payload.status}
                    onChange={(e) => set('status', e.target.value)}
                  >
                    <option value="open">조치 중</option>
                    <option value="on_hold">보류</option>
                    <option value="done">결과 확인 후 종료</option>
                  </select>
                </label>
              </div>
              <label className="block text-sm">
                연결 업무
                <select
                  className={field}
                  multiple
                  value={editing.payload.taskIds}
                  onChange={(e) =>
                    set(
                      'taskIds',
                      Array.from(e.target.selectedOptions, (o) => o.value),
                    )
                  }
                >
                  {data.tasks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
              </label>
              {!editing.version && (
                <label className="flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={createTask}
                    onChange={(e) => setCreateTask(e.target.checked)}
                  />
                  이 결정으로 새 후속 업무도 만들기
                </label>
              )}
            </>
          )}
          <label className="block text-sm">
            등록·변경 사유와 완료 기준
            <textarea
              aria-label="결정 사유"
              className={field}
              value={editing.payload.reason}
              onChange={(e) => set('reason', e.target.value)}
            />
          </label>
          <label className="block text-sm">
            조치 결과
            <textarea
              aria-label="조치 결과"
              className={field}
              value={editing.payload.result}
              onChange={(e) => set('result', e.target.value)}
            />
          </label>
          <label className="block text-sm">
            근거 자료 링크
            <input
              type="url"
              className={field}
              value={editing.payload.evidence}
              onChange={(e) => set('evidence', e.target.value)}
              placeholder="https://"
            />
          </label>
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => void save()}>
              결정·조치 저장
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setEditing(null)}
            >
              취소
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
export { RecordBrowser };
