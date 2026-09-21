'use client';

import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Archive,
  CheckCircle2,
  Download,
  FileText,
  Plus,
  RefreshCw,
  Save,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import ReportNewsPicker from './report-news-picker';
import RatioComposition from './report-composition';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import type { Member, NewsItem, Task, WorkspaceState } from '@/lib/types';
import type {
  ReportAgenda,
  ReportConfig,
  ReportDocument,
  ReportRow,
  ReportStore,
} from '@/lib/report-types';
import {
  calculateMetrics,
  completedDay,
  collectReportRows,
  daysBetween,
  defaultReportConfig,
  emptyReportStore,
  finalizeReport,
  manualRow,
  newReport,
  previewStatistics,
  reportId,
  reportValidation,
  saveReport,
  scopeKey,
  shiftDay,
  statisticColumns,
  todayKst,
  undoStatisticImport,
  type CsvPreview,
} from '@/lib/reports';
import {
  downloadReportBlob,
  exportReportExcel,
  printReport,
  statisticsCsv,
} from '@/lib/report-export';

const input =
  'min-h-10 w-full min-w-0 rounded-lg border border-[#d8ded4] bg-white px-3 py-2 text-sm disabled:bg-[#f3f5f1]';
const panel = 'rounded-2xl border border-[#d8ded4] bg-white p-4 md:p-5';
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid min-w-0 gap-1.5 text-sm font-medium text-[#43594b]">
      <span>{label}</span>
      {children}
    </label>
  );
}
const ratioNotes: Record<string, string> = {
  '단체 구성비': '단체 ÷ 전체 · 외국인 단체 포함',
  '외국인 구성비': '외국인(개인+단체) ÷ 전체 · 외국인 단체 포함',
};
function MetricCards({
  report,
  store,
}: {
  report: ReportDocument;
  store: ReportStore;
}) {
  const metrics =
    report.status === 'final'
      ? report.metrics
      : calculateMetrics(
          store.statistics,
          report.config.statsStart,
          report.config.statsEnd,
        );
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {metrics.map((m) => (
        <div key={m.label} className={panel}>
          <p className="text-sm text-[#64776a]">{m.label}</p>
          {ratioNotes[m.label] && (
            <p className="text-xs text-[#8a968e]">{ratioNotes[m.label]}</p>
          )}
          <p className="mt-2 text-xl font-bold text-[#245b43]">
            {m.current === null
              ? '자료 없음'
              : m.current.toLocaleString('ko-KR', {
                  maximumFractionDigits: 1,
                }) + m.unit}
          </p>
          <p className="mt-1 text-sm">
            전년{' '}
            {m.previous === null
              ? '자료 없음'
              : m.previous.toLocaleString('ko-KR', {
                  maximumFractionDigits: 1,
                }) + m.unit}
          </p>
          <p className="mt-1 text-sm text-[#64776a]">
            {m.change === null
              ? m.comparison
              : (m.change > 0 ? '+' : '') + m.change.toFixed(1) + m.comparison}
          </p>
          {m.unit !== '%' && m.current !== null && m.previous !== null && (
            <p className="mt-1 text-sm text-[#64776a]">
              전년 차이 {(m.current - m.previous).toLocaleString('ko-KR')}
              {m.unit}
            </p>
          )}
          {(m.missing > 0 || m.previousMissing > 0) && (
            <p className="mt-1 text-xs text-amber-700">
              미입력: 당년 {m.missing}일 · 전년 {m.previousMissing}일
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

export default function ReportsView({
  active,
  data,
  actor,
  accessToken,
  news,
  onLoadNews,
  updateData,
  openTask,
}: {
  active: boolean;
  data: WorkspaceState;
  actor: Member;
  accessToken: string;
  news: NewsItem[];
  onLoadNews: () => void;
  updateData: (
    fn: (current: WorkspaceState) => WorkspaceState,
    message?: string,
  ) => void;
  openTask: (id: string) => void;
}) {
  const [store, setStore] = useState<ReportStore>(emptyReportStore);
  const [version, setVersion] = useState(0);
  const [report, setReport] = useState<ReportDocument | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [tab, setTab] = useState('weekly');
  const [showExcluded, setShowExcluded] = useState(false);
  const [openNotes, setOpenNotes] = useState<string[]>([]);
  const [showClosed, setShowClosed] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [csv, setCsv] = useState<{ text: string; filename: string } | null>(
    null,
  );
  const [clearBlanks, setClearBlanks] = useState(false);
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [archiveStart, setArchiveStart] = useState('');
  const [archiveEnd, setArchiveEnd] = useState('');
  const [archiveLink, setArchiveLink] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const loading = useRef(false);
  const canEdit = actor.role !== 'commenter';
  const readOnly = report?.status === 'final';
  async function load() {
    if (loading.current || !canEdit) return;
    loading.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/reports', {
        headers: { authorization: 'Bearer ' + accessToken },
        cache: 'no-store',
      });
      const body = (await response.json()) as {
        error?: string;
        store: ReportStore;
        version: number;
      };
      if (!response.ok)
        throw new Error(body.error ?? '보고서를 불러오지 못했습니다.');
      setStore(body.store);
      setVersion(body.version);
      setLoaded(true);
      setReport(
        body.store.reports
          .filter((r: ReportDocument) => r.status === 'draft')
          .sort((a: ReportDocument, b: ReportDocument) =>
            b.updatedAt.localeCompare(a.updatedAt),
          )[0] ??
          newReport(data, actor, defaultReportConfig(actor), body.store),
      );
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '불러오기 실패');
    } finally {
      setBusy(false);
      loading.current = false;
    }
  }
  const loadInitial = useEffectEvent(() => {
    void load();
  });
  useEffect(() => {
    if (!active || loaded) return;
    const timer = window.setTimeout(() => loadInitial(), 0);
    return () => window.clearTimeout(timer);
  }, [active, loaded]); // Load once on first entry; preserve editing when switching main tabs.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  async function persist(next: ReportStore) {
    if (busy) throw new Error('저장 중입니다. 잠시 기다려 주세요.');
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/reports', {
        method: 'PUT',
        headers: {
          authorization: 'Bearer ' + accessToken,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ version, store: next }),
      });
      const body = (await response.json()) as {
        error?: string;
        store: ReportStore;
        version: number;
      };
      if (!response.ok) throw new Error(body.error ?? '저장하지 못했습니다.');
      setStore(body.store);
      setVersion(body.version);
      return body.store as ReportStore;
    } finally {
      setBusy(false);
    }
  }
  async function run(action: () => void | Promise<void>) {
    setError('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : '작업에 실패했습니다.');
    }
  }
  function edit(change: Partial<ReportDocument>) {
    if (readOnly || busy) return;
    setReport((current) => (current ? { ...current, ...change } : null));
    setDirty(true);
    setMessage('');
  }
  function rowEdit(id: string, change: Partial<ReportRow>) {
    if (report)
      edit({
        rows: report.rows.map((r) => (r.id === id ? { ...r, ...change } : r)),
      });
  }
  function configEdit(key: keyof ReportConfig, value: string) {
    if (!report) return;
    const config = { ...report.config, [key]: value };
    if (key === 'scope' || key === 'team')
      edit({
        config,
        rows: collectReportRows(
          data,
          actor,
          config,
          store.tracks,
          report.rows.filter((r) => !r.taskId && !r.noteId),
        ),
      });
    else edit({ config });
  }
  async function save(final = false) {
    if (!report) return;
    const issue = reportValidation(report);
    if (issue) throw new Error(issue);
    const document = final ? finalizeReport(report, store.statistics) : report;
    const next = saveReport(store, document, actor);
    await persist(next);
    setReport(next.reports.find((r) => r.id === report.id)!);
    setDirty(false);
    setMessage(
      final ? '보고본을 확정하여 보관했습니다.' : '초안을 저장했습니다.',
    );
  }
  function confirmLeave() {
    return (
      !dirty ||
      window.confirm(
        '저장하지 않은 변경사항이 있습니다. 변경사항을 버리고 이동할까요?',
      )
    );
  }
  function startNext() {
    if (!report || !confirmLeave()) return;
    const config = defaultReportConfig(
      actor,
      shiftDay(report.config.meetingDate, 7),
    );
    config.scope = report.config.scope;
    config.team = report.config.team;
    setReport(newReport(data, actor, config, store));
    setDirty(true);
    setTab('weekly');
    setSelected([]);
    setMessage('다음 회차를 만들었습니다. 미완결 항목은 다시 기본 포함됩니다.');
  }
  function moveRow(id: string, delta: number) {
    if (!report) return;
    const rows = [...report.rows];
    const index = rows.findIndex((r) => r.id === id);
    const next = index + delta;
    if (next < 0 || next >= rows.length) return;
    [rows[index], rows[next]] = [rows[next], rows[index]];
    edit({ rows });
  }
  function createTask(row: ReportRow) {
    if (!row.title.trim()) throw new Error('업무 제목을 입력해 주세요.');
    if (!row.date) throw new Error('업무 등록 전 예정일을 입력해 주세요.');
    const task: Task = {
      id: reportId(),
      title: row.title,
      description: [row.summary, row.nextAction].filter(Boolean).join('\n'),
      date: row.date,
      categoryId:
        data.categories.find((c) => c.name === row.category)?.id ??
        data.categories[0]?.id ??
        '',
      assigneeId: actor.id,
      collaborators: [],
      priority: 'normal',
      status: 'scheduled',
      type: 'task',
      checklist: [],
      comments: [],
      createdBy: actor.id,
      createdAt: new Date().toISOString(),
    };
    updateData(
      (current) => ({ ...current, tasks: [...current.tasks, task] }),
      '보고 항목을 업무로 등록했습니다.',
    );
    rowEdit(row.id, { taskId: task.id, assignee: actor.name, status: '예정' });
  }
  function agendaTask(agenda: ReportAgenda) {
    if (
      !report ||
      !agenda.title.trim() ||
      !agenda.dueDate ||
      !agenda.assigneeId
    )
      throw new Error('안건 제목, 담당자, 기한을 입력해 주세요.');
    const id = reportId();
    updateData((current) => ({
      ...current,
      tasks: [
        ...current.tasks,
        {
          id,
          title: agenda.title,
          description: [agenda.situation, agenda.decision]
            .filter(Boolean)
            .join('\n'),
          date: agenda.dueDate,
          assigneeId: agenda.assigneeId,
          categoryId: data.categories[0]?.id ?? '',
          collaborators: [],
          priority: 'normal',
          status: 'scheduled',
          type: 'task',
          checklist: [],
          comments: [],
          createdBy: actor.id,
          createdAt: new Date().toISOString(),
        },
      ],
    }));
    edit({
      agendas: report.agendas.map((a) =>
        a.id === agenda.id ? { ...a, taskId: id, kind: '지시 후속' } : a,
      ),
      rows: [
        ...report.rows,
        {
          ...manualRow(
            agenda.dueDate < report.config.cutoff ? 'before' : 'after',
          ),
          title: agenda.title,
          summary: agenda.decision,
          nextAction: agenda.situation,
          taskId: id,
          date: agenda.dueDate,
          assignee:
            data.members.find((m) => m.id === agenda.assigneeId)?.name ?? '',
          status: '예정',
        },
      ],
    });
  }
  async function upload(file: File) {
    if (file.size > 3_000_000)
      throw new Error('CSV 파일은 3MB 이하로 올려 주세요.');
    const text = await file.text();
    setCsv({ text, filename: file.name });
    setPreview(previewStatistics(text, store.statistics, clearBlanks));
  }
  async function applyCsv() {
    if (!csv || !preview || preview.errors.length) return;
    const entry = {
      id: reportId(),
      filename: csv.filename,
      at: new Date().toISOString(),
      actor: actor.name,
      before: preview.rows.map(
        (r) => store.statistics.find((s) => s.date === r.date) ?? null,
      ),
      after: preview.rows,
    };
    await persist({
      ...store,
      statistics: [
        ...store.statistics.filter(
          (s) => !preview.rows.some((r) => r.date === s.date),
        ),
        ...preview.rows,
      ].sort((a, b) => a.date.localeCompare(b.date)),
      imports: [...store.imports, entry],
    });
    setCsv(null);
    setPreview(null);
    setMessage('CSV 통계를 한 번에 반영했습니다. 기존 확정본은 유지됩니다.');
  }
  if (!active) return null;
  if (!canEdit)
    return (
      <div className={panel}>
        보고서는 업무 작성자와 관리자만 이용할 수 있습니다.
      </div>
    );
  if (!loaded || !report)
    return (
      <div className={panel}>
        <p role="alert">{error || '보고서를 불러오는 중입니다.'}</p>
        {!busy && <Button onClick={() => void load()}>다시 불러오기</Button>}
      </div>
    );
  const included = report.rows.filter((r) => r.visible).length;
  const finalized = store.reports
    .filter(
      (r) =>
        r.status === 'final' &&
        (!archiveStart || r.config.meetingDate >= archiveStart) &&
        (!archiveEnd || r.config.meetingDate <= archiveEnd),
    )
    .sort(
      (a, b) =>
        b.config.meetingDate.localeCompare(a.config.meetingDate) ||
        b.revision - a.revision,
    );
  const effective = () =>
    report.status === 'final'
      ? report
      : finalizeReport(report, store.statistics);
  return (
    <div className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-lg font-bold text-[#245b43]">주간회의 통합보고</p>
          <p className="mt-1 text-sm text-[#64776a]">
            {report.config.scope === 'mine'
              ? '내 담당·협업 업무'
              : report.config.team + ' 팀'}{' '}
            ·{' '}
            {readOnly
              ? '확정본 · 수정 ' + report.revision
              : dirty
              ? '저장하지 않은 변경사항'
              : '초안'}{' '}
            {busy ? '· 저장 중' : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              if (confirmLeave()) void load();
            }}
          >
            <RefreshCw />
            서버 다시 불러오기
          </Button>
          <Button variant="outline" disabled={busy} onClick={startNext}>
            <Plus />
            다음 회차
          </Button>
          {!readOnly && (
            <Button disabled={busy} onClick={() => void run(() => save())}>
              <Save />
              초안 저장
            </Button>
          )}
          <Button variant="outline" onClick={() => setPreviewing(!previewing)}>
            <FileText />
            미리보기
          </Button>
        </div>
      </div>
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          {error}
        </div>
      )}
      {message && (
        <output className="rounded-xl bg-[#e3eee7] p-3 text-sm text-[#245b43]">
          {message}
        </output>
      )}
      <fieldset
        disabled={readOnly || busy}
        className={panel + ' grid gap-3 sm:grid-cols-2 xl:grid-cols-4'}
      >
        <Field label="보고서 제목">
          <input
            className={input}
            value={report.config.title}
            onChange={(e) => configEdit('title', e.target.value)}
          />
        </Field>
        <Field label="회의일">
          <input
            type="date"
            className={input}
            value={report.config.meetingDate}
            onChange={(e) => configEdit('meetingDate', e.target.value)}
          />
        </Field>
        <Field label="업무 구분 기준일">
          <input
            type="date"
            className={input}
            value={report.config.cutoff}
            onChange={(e) => configEdit('cutoff', e.target.value)}
          />
        </Field>
        <Field label="보고 범위">
          <select
            className={input}
            value={report.config.scope}
            onChange={(e) => configEdit('scope', e.target.value)}
          >
            <option value="mine">내 담당·협업 업무</option>
            <option value="team">선택 팀</option>
          </select>
        </Field>
        {report.config.scope === 'team' && (
          <Field label="선택 팀">
            <select
              className={input}
              value={report.config.team}
              onChange={(e) => configEdit('team', e.target.value)}
            >
              {[...new Set([actor.team, ...data.members.map((m) => m.team)])]
                .filter(Boolean)
                .map((team) => (
                  <option key={team}>{team}</option>
                ))}
            </select>
          </Field>
        )}
        {(
          [
            ['actualStart', '실적 시작일'],
            ['actualEnd', '실적 종료일'],
            ['planStart', '계획 시작일'],
            ['planEnd', '계획 종료일'],
            ['statsStart', '통계 시작일'],
            ['statsEnd', '통계 종료일'],
          ] as const
        ).map(([key, label]) => (
          <Field key={key} label={label}>
            <input
              type="date"
              className={input}
              value={report.config[key]}
              onChange={(e) => configEdit(key, e.target.value)}
            />
          </Field>
        ))}
        <Field label="작성자">
          <input
            className={input}
            value={report.config.author}
            onChange={(e) => configEdit('author', e.target.value)}
          />
        </Field>
        <Field label="참석자">
          <input
            className={input}
            value={report.config.attendees}
            onChange={(e) => configEdit('attendees', e.target.value)}
          />
        </Field>
      </fieldset>
      <MetricCards report={report} store={store} />
      <RatioComposition
        rows={report.status === 'final' ? report.statistics : store.statistics}
        start={report.config.statsStart}
        end={report.config.statsEnd}
      />
      <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-[#e3eee7] p-1">
          <TabsTrigger className="min-h-10 px-3" value="weekly">
            이번 주 보고
          </TabsTrigger>
          <TabsTrigger className="min-h-10 px-3" value="followup">
            전주 후속 확인
          </TabsTrigger>
          <TabsTrigger className="min-h-10 px-3" value="metrics">
            경영 지표
          </TabsTrigger>
          <TabsTrigger className="min-h-10 px-3" value="archive">
            보고서 보관함
          </TabsTrigger>
        </TabsList>
        <TabsContent value="weekly" className="space-y-4 pt-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span>
              표출 {included}건 · 제외 {report.rows.length - included}건
            </span>
            <label className="flex gap-2">
              <input
                type="checkbox"
                checked={showExcluded}
                onChange={(e) => setShowExcluded(e.target.checked)}
              />
              제외 항목 보기
            </label>
            <label className="flex gap-2">
              <input
                type="checkbox"
                checked={showClosed}
                onChange={(e) => setShowClosed(e.target.checked)}
              />
              보고 완결함
            </label>
            <Button
              variant="outline"
              disabled={readOnly || busy}
              onClick={() =>
                edit({
                  rows: collectReportRows(
                    data,
                    actor,
                    report.config,
                    store.tracks,
                    report.rows,
                    store.reports.find((r) => r.id === report.previousId),
                  ),
                })
              }
            >
              <RefreshCw />
              최신 업무 불러오기
            </Button>
          </div>
          {!readOnly && selected.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-[#e3eee7] p-3 text-sm">
              {selected.length}건 선택
              <Button
                variant="outline"
                onClick={() => {
                  edit({
                    rows: report.rows.map((r) =>
                      selected.includes(r.id) ? { ...r, closed: true } : r,
                    ),
                  });
                  setSelected([]);
                }}
              >
                선택 항목 보고 완결
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  edit({
                    rows: report.rows.map((r) =>
                      selected.includes(r.id) ? { ...r, closed: false } : r,
                    ),
                  });
                  setSelected([]);
                }}
              >
                선택 항목 재개
              </Button>
            </div>
          )}
          {showClosed && (
            <div className={panel}>
              <h3 className="font-bold">보고 완결함</h3>
              <p className="my-2 text-sm text-[#64776a]">
                재개한 항목은 초안을 저장하면 다음 보고서에도 이어집니다.
              </p>
              {store.tracks
                .filter(
                  (t) => t.closed && t.scopeKey === scopeKey(report.config),
                )
                .map((t) => (
                  <div
                    key={t.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-t py-3"
                  >
                    <div>
                      <p>{t.row.title}</p>
                      <p className="text-xs text-[#64776a]">
                        {t.history.at(-1)?.actor} ·{' '}
                        {t.history.at(-1)?.at.slice(0, 10)} ·{' '}
                        {t.history.at(-1)?.note}
                      </p>
                    </div>
                    <Button
                      disabled={readOnly || busy}
                      variant="outline"
                      onClick={() =>
                        edit({
                          rows: report.rows.some((r) => r.id === t.id)
                            ? report.rows.map((r) =>
                                r.id === t.id
                                  ? { ...r, closed: false, visible: true }
                                  : r,
                              )
                            : [
                                ...report.rows,
                                { ...t.row, closed: false, visible: true },
                              ],
                        })
                      }
                    >
                      보고 재개
                    </Button>
                  </div>
                ))}
            </div>
          )}
          {(['before', 'after'] as const).map((section) => (
            <section key={section} className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-lg font-bold">
                    {section === 'before' ? '이전 진행 내용' : '이후 진행 내용'}
                  </h3>
                  <p className="text-sm text-[#64776a]">
                    {section === 'before'
                      ? '보고 완결 전까지 과거 업무를 계속 포함합니다.'
                      : '루틴을 제외한 모든 이후 업무 · 일정 상한 없음'}
                  </p>
                </div>
                <Button
                  variant="outline"
                  disabled={readOnly || busy}
                  onClick={() =>
                    edit({ rows: [...report.rows, manualRow(section)] })
                  }
                >
                  <Plus />행 추가
                </Button>
              </div>
              {report.rows
                .filter(
                  (r) => r.section === section && (r.visible || showExcluded),
                )
                .map((row) => (
                  <ReportRowEditor
                    key={row.id}
                    row={row}
                    disabled={readOnly || busy}
                    data={data}
                    selected={selected.includes(row.id)}
                    onSelect={(checked) =>
                      setSelected((current) =>
                        checked
                          ? [...current, row.id]
                          : current.filter((id) => id !== row.id),
                      )
                    }
                    onChange={(change) => rowEdit(row.id, change)}
                    onMove={(delta) => moveRow(row.id, delta)}
                    onOpen={() => row.taskId && openTask(row.taskId)}
                    onCreate={() => void run(() => createTask(row))}
                    onLink={(id) => {
                      const task = data.tasks.find((t) => t.id === id);
                      if (!task) return;
                      if (
                        report.rows.some(
                          (r) => r.taskId === id && r.id !== row.id,
                        )
                      ) {
                        setError(
                          '이미 보고서에 포함된 업무입니다. 중복 행의 내용을 먼저 합쳐 주세요.',
                        );
                        return;
                      }
                      rowEdit(row.id, {
                        taskId: id,
                        noteId: task.sourceNoteId,
                        status:
                          task.status === 'completed'
                            ? '최종 완료'
                            : '연결된 업무',
                        date: row.date || task.date,
                        assignee:
                          row.assignee ||
                          data.members.find((m) => m.id === task.assigneeId)
                            ?.name ||
                          '',
                      });
                    }}
                    onCompletedDate={
                      actor.role === 'admin'
                        ? (date) => {
                            const completedAt = date || undefined;
                            rowEdit(row.id, { completedAt });
                            if (row.taskId)
                              updateData((current) => ({
                                ...current,
                                tasks: current.tasks.map((t) =>
                                  t.id === row.taskId
                                    ? { ...t, completedAt }
                                    : t,
                                ),
                              }));
                            else if (row.noteId)
                              updateData((current) => ({
                                ...current,
                                notes: current.notes.map((n) =>
                                  n.id === row.noteId
                                    ? { ...n, completedAt }
                                    : n,
                                ),
                              }));
                          }
                        : undefined
                    }
                    config={report.config}
                  />
                ))}
              {!report.rows.some(
                (r) => r.section === section && (r.visible || showExcluded),
              ) && (
                <div className={panel + ' text-sm text-[#64776a]'}>
                  표시할 항목이 없습니다. 최신 업무를 불러오거나 행을 추가해
                  주세요.
                </div>
              )}
            </section>
          ))}
          <section className={panel}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-bold">대표님 안건 · 결정 요청</h3>
              <Button
                variant="outline"
                disabled={readOnly || busy}
                onClick={() =>
                  edit({
                    agendas: [
                      ...report.agendas,
                      {
                        id: reportId(),
                        kind: '결정 요청',
                        title: '',
                        situation: '',
                        options: '',
                        opinion: '',
                        dueDate: '',
                        decision: '',
                        assigneeId: actor.id,
                        visible: true,
                      },
                    ],
                  })
                }
              >
                <Plus />
                안건 추가
              </Button>
            </div>
            {report.agendas.map((a) => (
              <fieldset
                key={a.id}
                disabled={readOnly || busy}
                className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-2"
              >
                <Field label="안건 구분">
                  <select
                    className={input}
                    value={a.kind}
                    onChange={(e) =>
                      edit({
                        agendas: report.agendas.map((item) =>
                          item.id === a.id
                            ? {
                                ...item,
                                kind: e.target.value as ReportAgenda['kind'],
                              }
                            : item,
                        ),
                      })
                    }
                  >
                    {['단순 보고', '결정 요청', '지시 후속'].map((kind) => (
                      <option key={kind}>{kind}</option>
                    ))}
                  </select>
                </Field>
                {(
                  [
                    'title',
                    'situation',
                    'options',
                    'opinion',
                    'decision',
                    'dueDate',
                  ] as const
                ).map((key, index) => (
                  <Field
                    key={key}
                    label={
                      [
                        '안건 제목',
                        '현황',
                        '선택안',
                        '작성자 의견',
                        '회의 결정·지시',
                        '결정 필요일',
                      ][index]
                    }
                  >
                    <input
                      type={key === 'dueDate' ? 'date' : 'text'}
                      className={input}
                      value={a[key]}
                      onChange={(e) =>
                        edit({
                          agendas: report.agendas.map((item) =>
                            item.id === a.id
                              ? { ...item, [key]: e.target.value }
                              : item,
                          ),
                        })
                      }
                    />
                  </Field>
                ))}
                <Field label="후속 담당자">
                  <select
                    className={input}
                    value={a.assigneeId}
                    onChange={(e) =>
                      edit({
                        agendas: report.agendas.map((item) =>
                          item.id === a.id
                            ? { ...item, assigneeId: e.target.value }
                            : item,
                        ),
                      })
                    }
                  >
                    {data.members
                      .filter((m) => m.active && m.role !== 'commenter')
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                  </select>
                </Field>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={a.visible}
                    onChange={(e) =>
                      edit({
                        agendas: report.agendas.map((item) =>
                          item.id === a.id
                            ? { ...item, visible: e.target.checked }
                            : item,
                        ),
                      })
                    }
                  />
                  이번 보고서에 표출
                </label>
                <Button
                  variant="outline"
                  onClick={() =>
                    a.taskId
                      ? openTask(a.taskId)
                      : void run(() => agendaTask(a))
                  }
                >
                  {a.taskId ? '연결 업무 보기' : '후속 업무 등록'}
                </Button>
              </fieldset>
            ))}
          </section>
          <section className={panel}>
            <h3 className="font-bold">특이사항 선택</h3>
            <p className="my-2 text-sm text-[#64776a]">
              선택한 내용만 보고서에 포함됩니다. 제목을 누르면 내용을 펼쳐 볼 수
              있고, 업무로 전환된 특이사항은 해당 업무와 연결합니다.
            </p>
            <div className="grid max-h-[28rem] gap-2 overflow-auto">
              {data.notes
                .filter((n) =>
                  report.config.scope === 'mine'
                    ? n.createdBy === actor.id
                    : data.members.some(
                        (m) =>
                          m.id === n.createdBy && m.team === report.config.team,
                      ),
                )
                .map((note) => (
                  <div
                    key={note.id}
                    className="rounded-lg border border-[#d8ded4] p-2 text-sm"
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        aria-label={note.label + ' 보고서에 포함'}
                        className="mt-1"
                        disabled={readOnly || busy}
                        checked={report.rows.some(
                          (r) => r.noteId === note.id && r.visible,
                        )}
                        onChange={(e) => {
                          const existing = report.rows.find(
                            (r) =>
                              r.noteId === note.id ||
                              (!!note.convertedTaskId &&
                                r.taskId === note.convertedTaskId),
                          );
                          if (existing) {
                            rowEdit(existing.id, {
                              noteId: note.id,
                              visible: e.target.checked,
                            });
                            return;
                          }
                          if (e.target.checked)
                            edit({
                              rows: [
                                ...report.rows,
                                {
                                  ...manualRow(
                                    note.date < report.config.cutoff
                                      ? 'before'
                                      : 'after',
                                  ),
                                  id: 'note:' + note.id,
                                  noteId: note.id,
                                  taskId: note.convertedTaskId,
                                  title: note.label,
                                  summary: note.body,
                                  date: note.date,
                                  category: '특이사항',
                                  assignee:
                                    data.members.find(
                                      (m) => m.id === note.createdBy,
                                    )?.name ?? '',
                                  status: note.completed
                                    ? '최종 완료'
                                    : '대응 중',
                                  completedAt: note.completedAt,
                                },
                              ],
                            });
                        }}
                      />
                      <button
                        type="button"
                        aria-expanded={openNotes.includes(note.id)}
                        className="min-w-0 flex-1 text-left"
                        onClick={() =>
                          setOpenNotes((current) =>
                            current.includes(note.id)
                              ? current.filter((id) => id !== note.id)
                              : [...current, note.id],
                          )
                        }
                      >
                        <span className="font-medium">
                          {note.date} · {note.label}
                        </span>
                        <span className="ml-2 text-xs text-[#2f6b4f]">
                          {openNotes.includes(note.id)
                            ? '접기 ▲'
                            : '내용 보기 ▼'}
                        </span>
                      </button>
                    </div>
                    {openNotes.includes(note.id) && (
                      <div className="mt-2 rounded-md bg-[#f6faf7] p-3 text-sm whitespace-pre-wrap">
                        {note.location && (
                          <p className="mb-1 text-xs text-[#64776a]">
                            위치: {note.location}
                          </p>
                        )}
                        {note.body || '작성된 내용이 없습니다.'}
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </section>
          <section className={panel}>
            <h3 className="font-bold">관광 동향 선택</h3>
            <p className="my-2 text-sm text-[#64776a]">
              키워드별 뉴스에서 고르고, 뉴스마다 긍정·부정으로 보고서에
              표시합니다.
            </p>
            <ReportNewsPicker
              news={news}
              selected={report.news}
              disabled={readOnly || busy}
              onOpen={onLoadNews}
              onChange={(next) => edit({ news: next })}
            />
          </section>
        </TabsContent>
        <TabsContent value="followup" className="space-y-3 pt-3">
          <div className={panel}>
            <h3 className="font-bold">지난 회의의 약속과 현재 결과</h3>
            <p className="mt-2 text-sm text-[#64776a]">
              {report.previousId
                ? '지난 확정본과 고유 업무 번호로 연결했습니다.'
                : '이전 확정본이 없습니다. 첫 보고서를 확정하면 다음 회차부터 대조할 수 있습니다.'}{' '}
              표출에서 제외한 미완결 항목도 후속 확인에 남습니다.
            </p>
          </div>
          {report.rows
            .filter((r) => r.previousPromise)
            .map((row) => (
              <fieldset
                key={row.id}
                disabled={readOnly || busy}
                className={panel + ' grid gap-3 sm:grid-cols-2'}
              >
                <div className="sm:col-span-2">
                  <h4 className="font-bold">{row.title}</h4>
                  <p className="mt-2 text-sm">
                    지난 약속: {row.previousPromise}
                  </p>
                  <p className="text-sm text-[#64776a]">
                    {row.status} ·{' '}
                    {row.date &&
                    row.date < todayKst() &&
                    row.status !== '최종 완료'
                      ? '기한 경과'
                      : row.date || '일정 미정'}
                  </p>
                </div>
                {(
                  ['followup', 'delayReason', 'nextAction', 'date'] as const
                ).map((key, index) => (
                  <Field
                    key={key}
                    label={
                      [
                        '현재 결과',
                        '미완료·지연 사유',
                        '다음 조치',
                        '후속 예정일',
                      ][index]
                    }
                  >
                    <input
                      className={input}
                      type={key === 'date' ? 'date' : 'text'}
                      value={row[key]}
                      onChange={(e) =>
                        rowEdit(row.id, { [key]: e.target.value })
                      }
                    />
                  </Field>
                ))}
              </fieldset>
            ))}
        </TabsContent>
        <TabsContent value="metrics" className="space-y-4 pt-3">
          <div className={panel}>
            <h3 className="font-bold">날짜별 매출·입장 통계</h3>
            <p className="my-2 text-sm text-[#64776a]">
              전년 같은 날짜 구간으로 비교합니다. 빈칸은 미입력, 0은 실제
              0입니다. 매출 범위·환불 처리·유무료 포함 여부 등 원본의 집계
              기준은 비고와 지표 설명에 기록해 주세요.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() =>
                  downloadReportBlob(
                    new Blob(
                      [
                        '\uFEFF' +
                          Object.keys(statisticColumns).join(',') +
                          '\r\n',
                      ],
                      { type: 'text/csv;charset=utf-8' },
                    ),
                    '경영지표_입력양식.csv',
                  )
                }
              >
                <Download />
                CSV 양식
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  downloadReportBlob(
                    new Blob(
                      [
                        statisticsCsv(
                          readOnly ? report.statistics : store.statistics,
                        ),
                      ],
                      { type: 'text/csv;charset=utf-8' },
                    ),
                    '경영지표_통계.csv',
                  )
                }
              >
                <Download />
                통계 CSV
              </Button>
              <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-4 text-sm">
                <Upload className="size-4" />
                CSV 업로드
                <input
                  aria-label="통계 CSV 파일"
                  className="sr-only"
                  type="file"
                  accept=".csv,text/csv"
                  disabled={readOnly || busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) void run(() => upload(f));
                  }}
                />
              </label>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={clearBlanks}
                disabled={readOnly || busy}
                onChange={(e) => {
                  setClearBlanks(e.target.checked);
                  if (csv)
                    void run(() =>
                      setPreview(
                        previewStatistics(
                          csv.text,
                          store.statistics,
                          e.target.checked,
                        ),
                      ),
                    );
                }}
              />
              파일의 빈칸으로 기존 값을 지우기 (없는 열은 유지)
            </label>
            {preview && (
              <div className="mt-4 space-y-3 rounded-xl bg-[#f3f5f1] p-4">
                <p className="text-sm font-bold">
                  {csv?.filename} · 신규 {preview.added} / 변경{' '}
                  {preview.changed} / 동일 {preview.same} / 오류{' '}
                  {preview.errors.length}
                </p>
                {preview.errors.length > 0 && (
                  <ul className="max-h-40 list-disc overflow-auto pl-5 text-sm text-red-700">
                    {preview.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                )}
                <div className="max-h-56 overflow-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr>
                        <th>날짜</th>
                        <th>기존 매출 → 변경</th>
                        <th>기존 입장객 → 변경</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((r, i) => (
                        <tr key={i}>
                          <td>{r.date}</td>
                          <td>
                            {store.statistics.find((s) => s.date === r.date)
                              ?.revenue ?? '미입력'}{' '}
                            → {r.revenue ?? '미입력'}
                          </td>
                          <td>
                            {store.statistics.find((s) => s.date === r.date)
                              ?.visitors ?? '미입력'}{' '}
                            → {r.visitors ?? '미입력'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Button
                  disabled={busy || !!preview.errors.length || readOnly}
                  onClick={() => void run(applyCsv)}
                >
                  검사된 {preview.rows.length}행 반영
                </Button>
              </div>
            )}
            <div className="mt-4">
              <Field label="지표 변화 설명 · 매출·입장객 집계 범위">
                <textarea
                  className={input + ' min-h-24'}
                  disabled={readOnly || busy}
                  value={report.config.metricNote}
                  onChange={(e) => configEdit('metricNote', e.target.value)}
                />
              </Field>
            </div>
            <p className="mt-3 text-sm text-[#64776a]">
              집계 {report.config.statsStart} ~ {report.config.statsEnd} (
              {
                daysBetween(report.config.statsStart, report.config.statsEnd)
                  .length
              }
              일) · 비교 {effective().comparisonStart} ~{' '}
              {effective().comparisonEnd} (
              {
                daysBetween(
                  effective().comparisonStart,
                  effective().comparisonEnd,
                ).length
              }
              일). 윤일의 전년 말일은 2월 28일로 적용합니다.
            </p>
          </div>
          <div className={panel + ' overflow-x-auto'}>
            <h3 className="mb-3 font-bold">상세 통계 · 분모는 전체 입장객</h3>
            <table className="min-w-[700px] w-full text-left text-sm">
              <thead>
                <tr>
                  {[
                    '날짜',
                    '매출',
                    '전체',
                    '단체',
                    '외국인 전체',
                    '외국인 개별',
                    '외국인 단체',
                    '단체 일반',
                    '도민',
                    '경로·복지',
                  ].map((h) => (
                    <th className="p-2" key={h}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(readOnly ? report.statistics : store.statistics)
                  .filter(
                    (s) =>
                      s.date >= report.config.statsStart &&
                      s.date <= report.config.statsEnd,
                  )
                  .map((s) => (
                    <tr className="border-t" key={s.date}>
                      {[
                        s.date,
                        s.revenue,
                        s.visitors,
                        s.groups,
                        s.foreigners,
                        s.foreigners !== null && s.foreignGroups !== null
                          ? s.foreigners - s.foreignGroups
                          : null,
                        s.foreignGroups,
                        s.groupGeneral,
                        s.groupLocal,
                        s.groupWelfare,
                      ].map((v, i) => (
                        <td className="p-2" key={i}>
                          {v ?? '미입력'}
                        </td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className={panel}>
            <h3 className="font-bold">업로드 이력</h3>
            {store.imports.toReversed().map((entry) => (
              <div
                className="flex flex-wrap items-center justify-between gap-2 border-b py-3 text-sm"
                key={entry.id}
              >
                <span>
                  {entry.filename} · {entry.actor} ·{' '}
                  {entry.at.slice(0, 16).replace('T', ' ')} ·{' '}
                  {entry.after.length}행 {entry.undoneAt ? '· 복원됨' : ''}
                </span>
                <Button
                  variant="outline"
                  disabled={busy || !!entry.undoneAt || readOnly}
                  onClick={() =>
                    void run(async () => {
                      await persist(undoStatisticImport(store, entry.id));
                      setMessage('업로드 이전 값으로 복원했습니다.');
                    })
                  }
                >
                  업로드 되돌리기
                </Button>
              </div>
            ))}
          </div>
        </TabsContent>
        <TabsContent value="archive" className="space-y-4 pt-3">
          <div className={panel}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-bold">보고서 보관함</h3>
                <p className="mt-1 text-sm text-[#64776a]">
                  확정본{' '}
                  {store.reports.filter((r) => r.status === 'final').length}개 ·
                  저장 데이터{' '}
                  {(new Blob([JSON.stringify(store)]).size / 1024).toFixed(1)}{' '}
                  KB · 출력 파일은 내려받을 때 생성합니다.
                </p>
              </div>
              <Button
                variant="outline"
                disabled={!finalized.length || busy}
                onClick={() =>
                  void run(async () => {
                    for (const item of finalized) await exportReportExcel(item);
                    setMessage(
                      '선택 기간의 Excel 다운로드를 요청했습니다. 브라우저에서 여러 파일 다운로드를 허용해 주세요.',
                    );
                  })
                }
              >
                <Download />
                기간별 Excel 내보내기
              </Button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label="보관함 시작일">
                <input
                  type="date"
                  className={input}
                  value={archiveStart}
                  onChange={(e) => setArchiveStart(e.target.value)}
                />
              </Field>
              <Field label="보관함 종료일">
                <input
                  type="date"
                  className={input}
                  value={archiveEnd}
                  onChange={(e) => setArchiveEnd(e.target.value)}
                />
              </Field>
            </div>
          </div>
          {store.reports
            .filter((r) => r.status === 'draft')
            .map((item) => (
              <div
                key={item.id}
                className={
                  panel + ' flex flex-wrap items-center justify-between gap-3'
                }
              >
                <span className="text-sm">
                  초안 · {item.config.meetingDate} · {item.config.title}
                </span>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (confirmLeave()) {
                      setReport(structuredClone(item));
                      setDirty(false);
                      setTab('weekly');
                    }
                  }}
                >
                  초안 열기
                </Button>
              </div>
            ))}
          {finalized.map((item) => (
            <article key={item.id} className={panel}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-[#64776a]">
                    {item.config.meetingDate} · {item.config.author} · 수정{' '}
                    {item.revision}
                  </p>
                  <h4 className="mt-1 font-bold">{item.config.title}</h4>
                  <p className="text-sm text-[#64776a]">
                    표출 {item.rows.filter((r) => r.visible).length}건 ·{' '}
                    {(new Blob([JSON.stringify(item)]).size / 1024).toFixed(1)}{' '}
                    KB
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (confirmLeave()) {
                        setReport(structuredClone(item));
                        setDirty(false);
                        setArchiveLink(store.archiveLinks[item.id] ?? '');
                        setTab('weekly');
                      }
                    }}
                  >
                    확정본 열기
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void run(() => exportReportExcel(item))}
                  >
                    Excel
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void run(() => printReport(item))}
                  >
                    PDF / 인쇄
                  </Button>
                  <Button
                    onClick={() => {
                      if (!confirmLeave()) return;
                      const originalId = item.originalId ?? item.id;
                      const revision =
                        Math.max(
                          ...store.reports
                            .filter(
                              (r) => (r.originalId ?? r.id) === originalId,
                            )
                            .map((r) => r.revision),
                        ) + 1;
                      setReport({
                        ...structuredClone(item),
                        id: reportId(),
                        status: 'draft',
                        originalId,
                        revision,
                        finalizedAt: undefined,
                        createdAt: new Date().toISOString(),
                      });
                      setDirty(true);
                      setTab('weekly');
                    }}
                  >
                    수정본 작성
                  </Button>
                </div>
              </div>
              {store.archiveLinks[item.id] && (
                <a
                  className="mt-3 block text-sm text-[#2f6b4f] underline"
                  target="_blank"
                  rel="noreferrer"
                  href={store.archiveLinks[item.id]}
                >
                  외부 보관 링크
                </a>
              )}
            </article>
          ))}
          {!finalized.length && (
            <p className={panel + ' text-sm text-[#64776a]'}>
              확정한 보고서가 없습니다. 미리보기를 확인한 후 보고본을 확정해
              주세요.
            </p>
          )}
        </TabsContent>
      </Tabs>
      {previewing && (
        <section className={panel}>
          <h3 className="font-bold">
            출력 미리보기 · 표출 {included}건 / 제외{' '}
            {report.rows.length - included}건
          </h3>
          <p className="mt-2 text-sm">
            {report.config.title} · {report.config.meetingDate} ·{' '}
            {report.config.author}
          </p>
          <div className="mt-3 space-y-3">
            {report.agendas
              .filter((a) => a.visible)
              .map((a) => (
                <div key={a.id} className="border-t pt-3">
                  <b>
                    {a.kind} · {a.title}
                  </b>
                  <p className="whitespace-pre-wrap text-sm">
                    {[a.situation, a.options, a.opinion, a.decision]
                      .filter(Boolean)
                      .join('\n')}
                  </p>
                </div>
              ))}
            {report.rows
              .filter((r) => r.visible)
              .map((r) => (
                <div key={r.id} className="border-t pt-3">
                  <b>
                    {r.category} · {r.title}
                  </b>
                  <p className="whitespace-pre-wrap text-sm">{r.summary}</p>
                  <p className="text-sm">
                    다음 행동: {r.nextAction || '—'} · {r.date || '일정 미정'} ·{' '}
                    {r.closed ? '보고 완결' : r.status}
                  </p>
                </div>
              ))}
          </div>
          <Button
            className="mt-3"
            variant="outline"
            onClick={() => void run(() => printReport(effective()))}
          >
            전체 출력 미리보기 / PDF
          </Button>
        </section>
      )}
      <div
        className={panel + ' flex flex-wrap items-center justify-between gap-3'}
      >
        <div>
          <p className="font-bold">
            {readOnly ? '보관된 확정본' : '보고본 확정'}
          </p>
          <p className="mt-1 text-sm text-[#64776a]">
            표출 {included}건 · 제외 {report.rows.length - included}건. 보고
            완결은 원래 업무 상태를 바꾸지 않습니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => void run(() => exportReportExcel(effective()))}
          >
            <Download />
            Excel 다운로드
          </Button>
          <Button
            variant="outline"
            onClick={() => void run(() => printReport(effective()))}
          >
            PDF / 인쇄
          </Button>
          {!readOnly && (
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setPreviewing(true);
                  if (
                    window.confirm(
                      '표출 ' +
                        included +
                        '건, 제외 ' +
                        (report.rows.length - included) +
                        '건으로 확정할까요? 확정본은 수정본을 만들어 변경할 수 있습니다.',
                    )
                  )
                    await save(true);
                })
              }
            >
              <CheckCircle2 />
              보고본 확정·보관
            </Button>
          )}
        </div>
      </div>
      {readOnly && (
        <div className={panel + ' flex flex-wrap items-end gap-3'}>
          <div className="min-w-0 flex-1">
            <Field label="구글 시트 등 외부 보관 링크">
              <input
                className={input}
                type="url"
                value={archiveLink}
                placeholder="https://docs.google.com/..."
                onChange={(e) => setArchiveLink(e.target.value)}
              />
            </Field>
          </div>
          <Button
            disabled={busy}
            variant="outline"
            onClick={() =>
              void run(async () => {
                if (archiveLink && !/^https?:\/\//i.test(archiveLink))
                  throw new Error('http 또는 https 링크를 입력해 주세요.');
                await persist({
                  ...store,
                  archiveLinks: {
                    ...store.archiveLinks,
                    [report.id]: archiveLink,
                  },
                });
                setMessage('외부 보관 링크를 저장했습니다.');
              })
            }
          >
            <Archive />
            링크 저장
          </Button>
        </div>
      )}
    </div>
  );
}

function ReportRowEditor({
  row,
  disabled,
  data,
  selected,
  onSelect,
  onChange,
  onMove,
  onOpen,
  onCreate,
  onLink,
  onCompletedDate,
  config,
}: {
  row: ReportRow;
  disabled: boolean;
  data: WorkspaceState;
  selected: boolean;
  onSelect: (v: boolean) => void;
  onChange: (v: Partial<ReportRow>) => void;
  onMove: (n: number) => void;
  onOpen: () => void;
  onCreate: () => void;
  onLink: (id: string) => void;
  onCompletedDate?: (date: string) => void;
  config: ReportConfig;
}) {
  const bucket = !row.date
    ? '일정 미정'
    : row.date <= config.planEnd
    ? '이번 주'
    : row.date <= shiftDay(config.planEnd, 7)
    ? '다음 주'
    : '그 이후';
  const actual = completedDay(row.completedAt);
  const highlight =
    actual && actual >= config.actualStart && actual <= config.actualEnd;
  return (
    <fieldset
      disabled={disabled}
      className={panel + (row.visible ? '' : ' opacity-70')}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex gap-2">
            <input
              type="checkbox"
              aria-label={row.title + ' 선택'}
              checked={selected}
              onChange={(e) => onSelect(e.target.checked)}
            />
            선택
          </label>
          <span className="rounded-full bg-[#e3eee7] px-2 py-1 text-[#245b43]">
            {row.status}
            {highlight ? ' · 실적 기간 완료' : ''}
          </span>
          {row.section === 'after' && <span>{bucket}</span>}
          {row.status === '최종 완료' && !row.completedAt && (
            <span className="text-amber-700">완료일 미확인</span>
          )}
          {row.sourceChanged && (
            <span className="text-amber-700">{row.sourceChanged}</span>
          )}
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={row.visible}
              onChange={(e) => onChange({ visible: e.target.checked })}
            />
            이번 보고서에 표출
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={row.closed}
              onChange={(e) => onChange({ closed: e.target.checked })}
            />
            보고 완결
          </label>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="보고 분류">
          <input
            className={input}
            value={row.category}
            onChange={(e) => onChange({ category: e.target.value })}
          />
        </Field>
        <div className="xl:col-span-2">
          <Field label="보고 제목">
            <input
              className={input}
              value={row.title}
              onChange={(e) => onChange({ title: e.target.value })}
            />
          </Field>
        </div>
        <Field label="이전 / 이후">
          <select
            className={input}
            value={row.section}
            onChange={(e) =>
              onChange({ section: e.target.value as ReportRow['section'] })
            }
          >
            <option value="before">이전 진행 내용</option>
            <option value="after">이후 진행 내용</option>
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="진행 내용·결과">
            <textarea
              className={input + ' min-h-24'}
              value={row.summary}
              onChange={(e) => onChange({ summary: e.target.value })}
            />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="다음 행동·이번 주 약속">
            <textarea
              className={input + ' min-h-24'}
              value={row.nextAction}
              onChange={(e) => onChange({ nextAction: e.target.value })}
            />
          </Field>
        </div>
        <Field label="담당자">
          <input
            className={input}
            value={row.assignee}
            onChange={(e) => onChange({ assignee: e.target.value })}
          />
        </Field>
        <Field label="예정일">
          <input
            className={input}
            type="date"
            value={row.date}
            onChange={(e) => onChange({ date: e.target.value })}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="보고 완결·재개 결과 메모">
            <input
              className={input}
              value={row.closeNote}
              onChange={(e) => onChange({ closeNote: e.target.value })}
            />
          </Field>
        </div>
      </div>
      {row.status === '최종 완료' && (
        <div className="mt-3 max-w-xs">
          <Field label="확인된 실제 완료일 (관리자)">
            <input
              className={input}
              type="date"
              value={completedDay(row.completedAt)}
              disabled={!onCompletedDate || disabled}
              onChange={(e) => onCompletedDate?.(e.target.value)}
            />
          </Field>
        </div>
      )}
      {row.checklist.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer">
            단계별 진행 {row.checklist.filter((c) => c.done).length}/
            {row.checklist.length}
          </summary>
          {row.checklist.map((c) => (
            <p key={c.id}>
              {c.done ? '✓' : '□'} {c.text}
            </p>
          ))}
        </details>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => onMove(-1)}>
          위로
        </Button>
        <Button size="sm" variant="outline" onClick={() => onMove(1)}>
          아래로
        </Button>
        {row.taskId ? (
          <Button size="sm" variant="outline" onClick={onOpen}>
            원래 업무 보기
          </Button>
        ) : (
          <>
            <Button size="sm" variant="outline" onClick={onCreate}>
              새 업무로 등록
            </Button>
            <select
              aria-label="기존 업무 연결"
              className={input + ' max-w-64'}
              value=""
              onChange={(e) => onLink(e.target.value)}
            >
              <option value="">기존 업무 연결</option>
              {data.tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
    </fieldset>
  );
}
