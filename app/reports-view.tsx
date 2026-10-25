'use client';

import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useCurrentTeam, withTeam } from '@/app/team-context';
import { byteLength, REQUEST_LIMIT_BYTES } from '@/lib/retention';
import ReportWorkflowPanel from './report-workflow-panel';
import { ArchivedTasks, LongTermReports, ReportDecisions, RecordBrowser } from './report-records';
import ReportProjects from './report-projects';
import CorrectionPanel from './report-corrections-panel';
import ClosedArchive from './report-closed-archive';
import { openCorrections } from '@/lib/report-corrections';
import { reportLocked, workflowLabels, type WorkflowAction } from '@/lib/report-workflow';
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Download,
  FileText,
  Plus,
  RefreshCw,
  Save,
  Upload,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import ReportNewsPicker from './report-news-picker';
import RatioComposition, { DailyVisitorChart } from './report-composition';
import { JejuReport, JejuImportPanel } from './report-jeju';
import { PlannerStatus, type PlannerSummary } from './report-planner';
import { PLANNER_TEAM_ID, PLANNER_URL } from '@/lib/planner-link';
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
  categoryCounts,
  compareDue,
  completedDay,
  collectReportRows,
  completionSuggestions,
  daysBetween,
  ALL_MEMBERS_TEAM,
  closedTracksInScope,
  defaultReportConfig,
  emptyReportStore,
  finalizeReport,
  manualRow,
  newReport,
  previewStatistics,
  reportId,
  reportValidation,
  rowsKeptOnScopeChange,
  sameReportValue,
  saveReport,
  inReportTeam,
  scopeLabel,
  shiftDay,
  statisticColumns,
  suggestedCloseNote,
  todayKst,
  undoStatisticImport,
  type CsvPreview,
} from '@/lib/reports';
import {
  downloadReportBlob,
  exportReportExcel,
  printReport,
  statisticsCsv,
  trendOf,
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
// 증가는 빨강, 감소는 파랑으로 강조한다. 화면에 보이는 소수 첫째 자리 기준.
function changeClass(change: number | null) {
  const trend =
    change === null ? undefined : trendOf(Number(change.toFixed(1)));
  if (trend === 'up')
    return 'inline-block rounded bg-[#fdecec] px-1.5 font-bold text-[#d32f2f]';
  if (trend === 'down')
    return 'inline-block rounded bg-[#e6effb] px-1.5 font-bold text-[#1565c0]';
  return 'text-[#64776a]';
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
    reportLocked(report)
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
          <p className={'mt-1 text-sm ' + changeClass(m.change)}>
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
          <p
            className={
              'mt-1 text-xs ' +
              (m.missing > 0 || m.previousMissing > 0
                ? 'text-amber-700'
                : 'text-[#8a968e]')
            }
          >
            누락 일수: 당년 {m.missing}일 · 전년 {m.previousMissing}일
          </p>
        </div>
      ))}
    </div>
  );
}

/** 탭 위에는 지표를 한 줄로만 보여 주고, 카드·그래프·입도객·구성비는 경영 지표 탭에서 봅니다. */
function MetricStrip({
  report,
  store,
  onOpen,
}: {
  report: ReportDocument;
  store: ReportStore;
  onOpen: () => void;
}) {
  const metrics = reportLocked(report)
    ? report.metrics
    : calculateMetrics(store.statistics, report.config.statsStart, report.config.statsEnd);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-[#d8ded4] bg-white px-4 py-3 text-left text-sm md:px-5"
    >
      <b className="text-[#245b43]">경영 지표</b>
      {metrics.map((m) => (
        <span key={m.label}>
          {m.label}{' '}
          <b>
            {m.current === null
              ? '자료 없음'
              : m.current.toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + m.unit}
          </b>
          {m.change !== null && (
            <span className={'ml-1 ' + changeClass(m.change)}>
              {(m.change > 0 ? '+' : '') + m.change.toFixed(1) + m.comparison}
            </span>
          )}
        </span>
      ))}
      <span className="ml-auto text-xs font-bold text-[#2f6b4f]">그래프·입도객·구성비 보기 →</span>
    </button>
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
  // 보고 행 보기: 보고 대상 / 완결 제안 / 이번 회차에 완결한 항목
  const [rowView, setRowView] = useState<'active' | 'suggested' | 'closed'>('active');
  // 행은 한 줄 요약으로 보이고, 펼친 행만 전체 입력칸을 보여 줍니다.
  const [expandedRows, setExpandedRows] = useState<string[]>([]);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [correctionNote, setCorrectionNote] = useState<{ reportId: string; note: string } | null>(null);
  const [catFilter, setCatFilter] = useState<
    Record<ReportRow['section'], string[]>
  >({
    before: [],
    after: [],
  });
  const [catSort, setCatSort] = useState<Record<ReportRow['section'], boolean>>(
    {
      before: true,
      after: true,
    },
  );
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
  const readOnly = report ? reportLocked(report) : false;
  // 보고서 저장소는 팀마다 따로입니다.
  const teamId = useCurrentTeam()?.id;
  // 파크사업팀 실적은 경영플래너가 원천입니다. 이 팀은 여기서 CSV를 올리지 않고 경영플래너에서 올립니다.
  const plannerOwned = (teamId ?? 'park') === PLANNER_TEAM_ID;
  const [plannerSummary, setPlannerSummary] = useState<PlannerSummary | null>(null);
  async function load() {
    if (loading.current || !canEdit) return;
    loading.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(withTeam('/api/reports', teamId), {
        headers: { authorization: 'Bearer ' + accessToken },
        cache: 'no-store',
      });
      const body = (await response.json()) as {
        error?: string;
        store: ReportStore;
        version: number;
        plannerSummary?: PlannerSummary | null;
      };
      if (!response.ok)
        throw new Error(body.error ?? '보고서를 불러오지 못했습니다.');
      setStore(body.store);
      setVersion(body.version);
      setPlannerSummary(body.plannerSummary ?? null);
      setLoaded(true);
      // 저장소는 팀이 함께 쓴다. 팀 범위 초안과 내가 쓴 "내 업무" 초안 중 가장 최근 것을 연다.
      setReport(
        body.store.reports
          .filter(
            (r: ReportDocument) =>
              r.status === 'draft' &&
              (r.config.scope === 'team' || r.ownerId === actor.id),
          )
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
  const reloadShared = useEffectEvent(() => {
    // 다른 사람이 저장한 초안·경영 지표를 보이도록, 저장하지 않은 변경이 없을 때만 다시 불러온다.
    if (loaded && !dirty && !busy) void load();
  });
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => reloadShared(), 0);
    return () => window.clearTimeout(timer);
  }, [active]);
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
      // 팀 저장소는 서버가 병합한다. 내가 바꾼 보고서마다 내가 마지막으로 본 서버 값을 함께 보낸다.
      // 서버는 바뀐 보고서·새 업로드·되돌리기·보관 링크만 씁니다. 실적 사본과 이미 저장된 기록은 보내지 않습니다.
      const changedEntries = <T extends { id: string; undoneAt?: string }>(list: T[] = [], old: T[] = []) =>
        list.filter((entry) => {
          const before = old.find((item) => item.id === entry.id);
          return !before || before.undoneAt !== entry.undoneAt;
        });
      const slim: ReportStore = {
        ...next,
        reports: next.reports.filter((r) => !sameReportValue(r, store.reports.find((b) => b.id === r.id))),
        tracks: [],
        statistics: [],
        jejuArrivals: [],
        imports: changedEntries(next.imports, store.imports),
        jejuImports: changedEntries(next.jejuImports, store.jejuImports),
      };
      const payload = JSON.stringify({
        version,
        store: slim,
        bases: {
          reports: Object.fromEntries(
            next.reports
              .map(
                (r) => [r, store.reports.find((b) => b.id === r.id)] as const,
              )
              .filter(([r, b]) => !sameReportValue(r, b))
              .map(([r, b]) => [r.id, b ?? null]),
          ),
          archiveLinks: store.archiveLinks,
        },
      });
      // 서버가 한 번에 받을 수 있는 양을 넘으면 보내기 전에 알려 준다.
      const bytes = byteLength(payload);
      if (bytes > REQUEST_LIMIT_BYTES) {
        // 너무 커서 서버로 보낼 수 없으니, 막혔다는 사실만 조용히 알립니다.
        void fetch(withTeam('/api/alerts', teamId), {
          method: 'POST',
          headers: {
            authorization: 'Bearer ' + accessToken,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ bytes }),
        }).catch(() => undefined);
        throw new Error(
          '보고서 저장 공간이 부족해 지금은 저장하지 못했습니다. 작성한 내용은 화면에 그대로 있으니 잠시 후 다시 저장해 주세요.',
        );
      }
      const response = await fetch(withTeam('/api/reports', teamId), {
        method: 'PUT',
        headers: {
          authorization: 'Bearer ' + accessToken,
          'content-type': 'application/json',
        },
        body: payload,
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
  function changeScope(config: ReportConfig) {
    if (!report) return;
    edit({
      config,
      rows: collectReportRows(
        data,
        actor,
        config,
        store.tracks,
        rowsKeptOnScopeChange(report.rows, data, actor, config),
      ),
    });
  }
  function configEdit(key: keyof ReportConfig, value: string) {
    if (!report) return;
    const config = { ...report.config, [key]: value };
    if (key === 'scope' || key === 'team') changeScope(config);
    else edit({ config });
  }
  async function save() {
    if (!report) return;
    const issue = reportValidation(report);
    if (issue) throw new Error(issue);
    const document = report;
    const next = saveReport(store, document, actor);
    const saved = await persist(next);
    // 다른 사람이 같은 초안에 저장한 체크·문구가 병합되어 돌아온다.
    setReport(saved.reports.find((r) => r.id === report.id)!);
    setDirty(false);
    setMessage('초안을 저장했습니다.');
  }
  async function workflowAction(action: WorkflowAction, reviewerId: string, finalizerId: string, note: string) {
    if (!report || busy) return;
    await run(async () => {
      setBusy(true);
      try {
        const response = await fetch(withTeam('/api/reports', teamId), {
          method: 'POST', headers: { authorization: 'Bearer ' + accessToken, 'content-type': 'application/json' },
          body: JSON.stringify({ action, reportId: report.id, expectedUpdatedAt: report.updatedAt, requestId: crypto.randomUUID(), reviewerId, finalizerId, note }),
        });
        const body = await response.json() as { error?: string; store: ReportStore; version: number };
        if (!response.ok) throw new Error(body.error ?? '보고 처리 실패');
        setStore(body.store); setVersion(body.version);
        setReport(body.store.reports.find((item: ReportDocument) => item.id === report.id) ?? null);
        setDirty(false); setMessage('보고 처리와 이력을 저장했습니다.');
      } finally { setBusy(false); }
    });
  }
  function openRecordedReport(item: ReportDocument) {
    if (!confirmLeave()) return;
    setReport(structuredClone(item)); setDirty(false); setTab('weekly');
  }
  function reviseRecordedReport(item: ReportDocument, confirmed = false) {
    if (!confirmed && !confirmLeave()) return;
    const id = reportId();
    setReport({ ...structuredClone(item), id, ownerId: actor.id, status: 'draft', originalId: item.originalId ?? item.id,
      revision: Math.max(item.revision, ...store.reports.filter(r => (r.originalId ?? r.id) === (item.originalId ?? item.id)).map(r => r.revision)) + 1,
      workflow: undefined, projects: undefined, finalizedAt: undefined, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    setDirty(true); setTab('weekly');
    return id;
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
  async function correctionCall(body: Record<string, unknown>) {
    const response = await fetch(withTeam('/api/reports', teamId), {
      method: 'POST',
      headers: { authorization: 'Bearer ' + accessToken, 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, requestId: crypto.randomUUID() }),
    });
    const result = (await response.json()) as { error?: string; store: ReportStore; version: number };
    if (!response.ok) throw new Error(result.error ?? '정정 제안을 처리하지 못했습니다.');
    setStore(result.store);
    setVersion(result.version);
    return result.store;
  }
  async function proposeCorrection(note: string) {
    if (!report || busy) return false;
    let ok = false;
    await run(async () => {
      setBusy(true);
      try {
        await correctionCall({ kind: 'correction', reportId: report.id, note });
        setMessage('정정 제안을 등록했습니다. 관리자가 반영 여부를 결정합니다.');
        ok = true;
      } finally {
        setBusy(false);
      }
    });
    return ok;
  }
  async function dismissCorrection(proposalId: string, reason: string) {
    if (busy) return;
    await run(async () => {
      setBusy(true);
      try {
        await correctionCall({ kind: 'correction-resolve', proposalId, decision: 'dismissed', note: reason });
        setMessage('정정 제안을 반려했습니다.');
      } finally {
        setBusy(false);
      }
    });
  }
  /** 대기 중인 정정 제안을 반영 처리하고, 제안 내용을 정정 사유로 채운 정정본을 엽니다. */
  async function applyCorrections(ids: string[]) {
    if (!report || busy || !confirmLeave()) return;
    const original = report;
    const notes = (store.corrections ?? [])
      .filter((item) => ids.includes(item.id))
      .map((item) => `- ${item.note} (${item.proposedByName})`);
    await run(async () => {
      setBusy(true);
      try {
        for (const proposalId of ids)
          await correctionCall({ kind: 'correction-resolve', proposalId, decision: 'applied' });
      } finally {
        setBusy(false);
      }
      const draft = reviseRecordedReport(original, true);
      if (draft) setCorrectionNote({ reportId: draft, note: '정정 제안 반영:\n' + notes.join('\n') });
      setMessage('정정본을 만들었습니다. 내용을 고친 뒤 초안을 저장하고 제출해 주세요. 정정 사유는 제안 내용으로 채워 두었습니다.');
      jump('report-submit');
    });
  }
  function jump(id: string, tabName?: string) {
    if (tabName) setTab(tabName);
    window.setTimeout(
      () => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      40,
    );
  }
  function reopenTrack(track: ReportStore['tracks'][number]) {
    if (!report) return;
    edit({
      rows: report.rows.some((r) => r.id === track.id)
        ? report.rows.map((r) =>
            r.id === track.id ? { ...r, closed: false, visible: true, reopenedAt: new Date().toISOString() } : r,
          )
        : [...report.rows, { ...track.row, closed: false, visible: true, reopenedAt: new Date().toISOString() }],
    });
    setMessage('보고를 재개했습니다. 초안을 저장하면 다음 회차에도 이어집니다.');
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
  const suggestions = completionSuggestions(report, store.reports);
  const suggestedIds = new Set(suggestions.map((item) => item.row.id));
  const viewOf = (row: ReportRow) =>
    row.closed ? 'closed' : suggestedIds.has(row.id) ? 'suggested' : 'active';
  const viewCounts = { active: 0, suggested: 0, closed: 0 };
  for (const row of report.rows) viewCounts[viewOf(row)] += 1;
  const scopeTracks = closedTracksInScope(store.tracks, data, actor, report.config, report.ownerId);
  // 내가 검토하거나 확정할 차례인 보고
  const myQueue = store.reports.filter(
    (r) =>
      r.status !== 'final' &&
      !!r.workflow &&
      ((r.workflow.reviewerId === actor.id && ['submitted', 'reviewing'].includes(r.workflow.status)) ||
        (r.workflow.finalizerId === actor.id && r.workflow.status === 'approved')),
  );
  const pendingCorrections =
    actor.role === 'admin'
      ? openCorrections(store).filter((c) => store.reports.some((r) => r.id === c.reportId))
      : [];
  const steps = ['작성', '저장', '제출', '검토', '확정'];
  const wf = report.workflow?.status;
  const step =
    report.status === 'final'
      ? 5
      : wf === 'reviewing' || wf === 'approved'
        ? 3
        : wf === 'submitted'
          ? 2
          : dirty || !store.reports.some((r) => r.id === report.id)
            ? 0
            : 1;
  const sectionLinks: [string, string, string | undefined, number | undefined][] = [
    ['report-period', '기간·범위', undefined, undefined],
    ['report-projects', '연결 프로젝트', 'weekly', undefined],
    ['report-before', '이전 진행', 'weekly', undefined],
    ['report-after', '이후 진행', 'weekly', undefined],
    ['report-agenda', '안건', 'weekly', undefined],
    ['report-notes', '특이사항', 'weekly', undefined],
    ['report-news', '관광 동향', 'weekly', undefined],
    ['report-metrics', '경영 지표', 'metrics', undefined],
    ['report-closed-archive', '완결 아카이브', 'archive', undefined],
    ['report-submit', '제출·확정', undefined, myQueue.length + pendingCorrections.length || undefined],
  ];
  const effective = () =>
    reportLocked(report)
      ? report
      : finalizeReport(report, store.statistics, store.jejuArrivals ?? []);
  return (
    <div className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-lg font-bold text-[#245b43]">주간회의 통합보고</p>
          <p className="mt-1 text-sm text-[#64776a]">
            {scopeLabel(report.config)} ·{' '}
            {report.config.title} · 회의 {report.config.meetingDate}
          </p>
          {actor.role === 'admin' && report.config.scope === 'mine' && !readOnly && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-[#fff6e5] px-3 py-2 text-sm text-[#7a5a12]">
              <span>내 담당·협업 업무만 불러오는 보고서입니다. 써 둔 내용은 그대로 두고 팀원 업무를 더합니다.</span>
              <Button
                size="sm"
                variant="outline"
                className="bg-white"
                disabled={busy}
                onClick={() =>
                  changeScope({ ...report.config, scope: 'team', team: ALL_MEMBERS_TEAM })
                }
              >
                전체 팀원 업무로 바꾸기
              </Button>
            </div>
          )}
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
          {report.status === 'final' && <Button variant="outline" disabled={busy} onClick={() => reviseRecordedReport(report)}>정정본 작성</Button>}
        </div>
      </div>
      {/* 상단 고정 작업 바: 어디까지 내려가 있어도 상태·저장·미리보기·제출·확정과 섹션 이동이 보입니다. */}
      <div className="sticky top-16 z-30 -mx-4 space-y-2 border-y border-[#d8ded4] bg-[#fbfaf5]/95 px-4 py-2 backdrop-blur md:-mx-7 md:px-7">
        <div className="flex flex-wrap items-center gap-2">
          <span className={'rounded-full px-2.5 py-1 text-xs font-bold ' + (readOnly ? 'bg-[#e3eee7] text-[#245b43]' : 'bg-white text-[#43594b] ring-1 ring-[#d8ded4]')}>
            {readOnly
              ? (report.workflow ? workflowLabels[report.workflow.status] : '확정본') + ' · 수정 ' + report.revision
              : report.workflow ? workflowLabels[report.workflow.status] : '초안'}
          </span>
          {dirty && <span className="rounded-full bg-[#fff3dc] px-2.5 py-1 text-xs font-bold text-[#9a5800]">● 저장 안 됨</span>}
          {busy && <span className="text-xs text-[#64776a]">저장 중…</span>}
          {myQueue.length > 0 && (
            <button type="button" className="rounded-full bg-[#e8eefc] px-2.5 py-1 text-xs font-bold text-[#1d4ed8]" onClick={() => { openRecordedReport(myQueue[0]); jump('report-submit'); }}>
              내 처리 대기 {myQueue.length}
            </button>
          )}
          {pendingCorrections.length > 0 && (
            <button type="button" className="rounded-full bg-[#fff3dc] px-2.5 py-1 text-xs font-bold text-[#9a5800]" onClick={() => { const item = store.reports.find(r => r.id === pendingCorrections[0].reportId); if (item) { openRecordedReport(item); jump('report-submit'); } }}>
              정정 제안 {pendingCorrections.length}
            </button>
          )}
          <ol className="hidden items-center gap-1 text-xs lg:flex" aria-label="보고 진행 단계">
            {steps.map((label, index) => (
              <li key={label} className={'flex items-center gap-1 ' + (index < step ? 'text-[#2f6b4f]' : index === step ? 'font-bold text-[#1d4ed8]' : 'text-[#9aa79f]')}>
                {index > 0 && <span aria-hidden>→</span>}
                {index < step ? '✓ ' : ''}{label}
              </li>
            ))}
          </ol>
          <div className="ml-auto flex flex-wrap gap-2">
            {!readOnly && (
              <Button size="sm" disabled={busy} onClick={() => void run(() => save())}>
                <Save />
                초안 저장
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setPreviewing(true)}>
              <FileText />
              미리보기
            </Button>
            <Button size="sm" variant="outline" onClick={() => jump('report-submit')}>
              <ArrowDown />
              제출·확정
            </Button>
          </div>
        </div>
        <nav aria-label="보고서 섹션 바로가기" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5 text-xs">
          {sectionLinks.map(([id, label, tabName, badge]) => (
            <button key={id} type="button" className="shrink-0 rounded-full border border-[#d8ded4] bg-white px-2.5 py-1 font-medium text-[#43594b] hover:border-[#2f6b4f]" onClick={() => jump(id, tabName)}>
              {label}
              {badge ? <b className="ml-1 text-[#b42318]">{badge}</b> : null}
            </button>
          ))}
          <button type="button" className="shrink-0 rounded-full px-2.5 py-1 text-[#64776a]" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            <ArrowUp className="inline size-3" /> 맨 위
          </button>
        </nav>
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
        <output className="block rounded-xl bg-[#e3eee7] p-3 text-sm text-[#245b43]">
          {message}
        </output>
      )}
      <label className="block text-sm font-medium text-[#43594b]">보고 목록과 검토함
        <select className={input} value={store.reports.some(item => item.id === report.id) ? report.id : ''} onChange={event => { const item = store.reports.find(r => r.id === event.target.value); if(item) openRecordedReport(item); }}>
          <option value="" disabled>보고서를 선택해 주세요</option>
          {[...store.reports].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).map(item => <option key={item.id} value={item.id}>{item.workflow ? workflowLabels[item.workflow.status] : item.status === 'final' ? '확정' : '작성 중'} · {item.config.meetingDate} · {item.config.title}{item.workflow?.reviewerId === actor.id && ['submitted','reviewing'].includes(item.workflow.status) ? ' · 내 검토 대기' : ''}</option>)}
        </select>
      </label>
      <details
        id="report-period"
        className="scroll-mt-44 rounded-2xl border border-[#d8ded4] bg-white"
        open={periodOpen}
        onToggle={(e) => setPeriodOpen(e.currentTarget.open)}
      >
        <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm md:px-5">
          <b className="text-[#245b43]">기간·범위</b>
          <span>회의 {report.config.meetingDate}</span>
          <span>실적 {report.config.actualStart}~{report.config.actualEnd}</span>
          <span>계획 {report.config.planStart}~{report.config.planEnd}</span>
          <span>통계 {report.config.statsStart}~{report.config.statsEnd}</span>
          <span>기준일 {report.config.cutoff}</span>
          <span className="ml-auto text-xs font-bold text-[#2f6b4f]">{periodOpen ? '접기 ▲' : readOnly ? '자세히 ▼' : '변경 ▼'}</span>
        </summary>
      <fieldset
        disabled={readOnly || busy}
        className="grid gap-3 border-t border-[#e3e8e0] p-4 sm:grid-cols-2 md:p-5 xl:grid-cols-4"
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
              {[...new Set([ALL_MEMBERS_TEAM, actor.team, ...data.members.map((m) => m.team)])]
                .filter(Boolean)
                .map((team) => (
                  <option key={team} value={team}>
                    {team === ALL_MEMBERS_TEAM ? '전체 팀원' : team}
                  </option>
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
      </details>
      <MetricStrip report={report} store={store} onOpen={() => jump('report-metrics', 'metrics')} />
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
          <TabsTrigger className="min-h-10 px-3" value="records">보고·업무 기록</TabsTrigger>
        </TabsList>
        <TabsContent value="weekly" className="space-y-4 pt-3">
          <ReportProjects key={report.id} report={report} data={data} openTask={openTask} />
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
            <Button size="sm" variant="ghost" onClick={() => jump('report-closed-archive', 'archive')}>
              <Archive />
              완결 아카이브 {scopeTracks.length}건
            </Button>
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
          <fieldset className="m-0 flex min-w-0 flex-wrap items-center gap-2 border-0 p-0" aria-label="보고 행 보기">
            {(
              [
                ['active', '보고 대상'],
                ['suggested', '완결 제안'],
                ['closed', '이번 회차 완결'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={rowView === key}
                className={
                  'min-h-9 rounded-full border px-3 text-sm font-bold ' +
                  (rowView === key
                    ? key === 'suggested'
                      ? 'border-[#9a5800] bg-[#9a5800] text-white'
                      : 'border-[#2f6b4f] bg-[#2f6b4f] text-white'
                    : key === 'suggested' && viewCounts.suggested
                      ? 'border-[#efcf94] bg-[#fff3dc] text-[#9a5800]'
                      : 'border-[#d8ded4] bg-white text-[#43594b]')
                }
                onClick={() => setRowView(key)}
              >
                {label} {viewCounts[key]}
              </button>
            ))}
            <button
              type="button"
              className="ml-auto text-sm font-bold text-[#2f6b4f]"
              onClick={() =>
                setExpandedRows(
                  expandedRows.length ? [] : report.rows.filter((r) => viewOf(r) === rowView).map((r) => r.id),
                )
              }
            >
              {expandedRows.length ? '모든 행 접기' : '모든 행 펼치기'}
            </button>
          </fieldset>
          {suggestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#efcf94] bg-[#fff8ea] p-3 text-sm">
              <p className="min-w-0 flex-1">
                <b className="text-[#9a5800]">완결 제안 {suggestions.length}건</b> · 최종 완료 후 확정본에 보고된
                항목입니다(먼저 끝난 하위 일정 포함). 완결하면 다음 회차부터 빠지고 완결 아카이브에 남습니다.
              </p>
              {rowView !== 'suggested' && (
                <Button size="sm" variant="outline" onClick={() => setRowView('suggested')}>
                  제안 확인
                </Button>
              )}
              <Button
                size="sm"
                disabled={readOnly || busy}
                onClick={() => {
                  const notes = new Map(suggestions.map((item) => [item.row.id, suggestedCloseNote(item.reportedIn)]));
                  edit({
                    rows: report.rows.map((r) =>
                      notes.has(r.id) ? { ...r, closed: true, closeNote: r.closeNote || notes.get(r.id)! } : r,
                    ),
                  });
                  setMessage(`${suggestions.length}건을 보고 완결했습니다. 초안을 저장하면 반영됩니다.`);
                }}
              >
                제안 {suggestions.length}건 모두 완결
              </Button>
            </div>
          )}
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
          {(['before', 'after'] as const).map((section) => {
            const pool = report.rows.filter(
              (r) =>
                r.section === section &&
                viewOf(r) === rowView &&
                (r.visible || showExcluded),
            );
            const counts = categoryCounts(pool);
            const picked = catFilter[section].filter((c) =>
              counts.some(([name]) => name === c),
            );
            const order = counts.map(([name]) => name);
            const shown = pool
              .filter(
                (r) => !picked.length || picked.includes(r.category || '기타'),
              )
              .map((r, i) => ({ r, i }))
              .sort((a, b) =>
                catSort[section]
                  ? order.indexOf(a.r.category || '기타') -
                      order.indexOf(b.r.category || '기타') ||
                    compareDue(a.r, b.r) ||
                    a.i - b.i
                  : a.i - b.i,
              )
              .map(({ r }) => r);
            const chip = (on: boolean) =>
              'min-h-8 rounded-full border px-3 text-xs font-bold ' +
              (on
                ? 'border-[#2f6b4f] bg-[#2f6b4f] text-white'
                : 'border-[#d8ded4] bg-white text-[#43594b]');
            return (
              <section key={section} id={'report-' + section} className="scroll-mt-44 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-lg font-bold">
                      {section === 'before'
                        ? '이전 진행 내용'
                        : '이후 진행 내용'}
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
                {counts.length > 0 && (
                  <fieldset
                    aria-label={
                      (section === 'before' ? '이전' : '이후') +
                      ' 진행 분류 필터'
                    }
                    className="m-0 flex min-w-0 flex-wrap items-center gap-1.5 border-0 p-0"
                  >
                    <button
                      type="button"
                      aria-pressed={!picked.length}
                      className={chip(!picked.length)}
                      onClick={() =>
                        setCatFilter((f) => ({ ...f, [section]: [] }))
                      }
                    >
                      전체 {pool.length}
                    </button>
                    {counts.map(([name, n]) => (
                      <button
                        key={name}
                        type="button"
                        aria-pressed={picked.includes(name)}
                        className={chip(picked.includes(name))}
                        onClick={() =>
                          setCatFilter((f) => ({
                            ...f,
                            [section]: picked.includes(name)
                              ? picked.filter((c) => c !== name)
                              : [...picked, name],
                          }))
                        }
                      >
                        {name} {n}
                      </button>
                    ))}
                    <label className="ml-auto flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={catSort[section]}
                        onChange={(e) =>
                          setCatSort((s) => ({
                            ...s,
                            [section]: e.target.checked,
                          }))
                        }
                      />
                      분류별로 모아 보기 (많은 분류 순 · 예정일 빠른 순)
                    </label>
                  </fieldset>
                )}
                {shown.map((row) => (
                  <ReportRowEditor
                    key={row.id}
                    row={row}
                    expanded={expandedRows.includes(row.id)}
                    suggestion={suggestions.find((item) => item.row.id === row.id)?.reportedIn}
                    onToggle={() =>
                      setExpandedRows((current) =>
                        current.includes(row.id)
                          ? current.filter((id) => id !== row.id)
                          : [...current, row.id],
                      )
                    }
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
                {!shown.length && (
                  <div className={panel + ' text-sm text-[#64776a]'}>
                    {pool.length
                      ? '선택한 분류에 해당하는 항목이 없습니다.'
                      : rowView === 'suggested'
                        ? '완결 제안이 없습니다.'
                        : rowView === 'closed'
                          ? '이번 회차에 완결한 항목이 없습니다.'
                          : '표시할 항목이 없습니다. 최신 업무를 불러오거나 행을 추가해 주세요.'}
                  </div>
                )}
              </section>
            );
          })}
          <section id="report-agenda" className={panel + ' scroll-mt-44'}>
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
          <section id="report-notes" className={panel + ' scroll-mt-44'}>
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
                          m.id === n.createdBy &&
                          inReportTeam(m, report.config.team),
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
          <section id="report-news" className={panel + ' scroll-mt-44'}>
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
        <TabsContent value="metrics" id="report-metrics" className="scroll-mt-44 space-y-4 pt-3">
      <MetricCards report={report} store={store} />
      {!readOnly && <PlannerStatus summary={plannerSummary} />}
      <DailyVisitorChart
        rows={readOnly ? report.statistics : store.statistics}
        start={report.config.statsStart}
        end={report.config.statsEnd}
      />
      <JejuReport report={report} store={readOnly ? { ...store, statistics: report.statistics, jejuArrivals: report.jejuArrivals } : store} />
      <RatioComposition
        rows={readOnly ? report.statistics : store.statistics}
        start={report.config.statsStart}
        end={report.config.statsEnd}
      />

          {plannerOwned ? (
            <div className={panel}>
              <h3 className="font-bold">실적·입도객 자료는 경영플래너에서 올립니다</h3>
              <p className="my-2 text-sm text-[#64776a]">
                파크사업팀의 매출·입장 통계와 제주 입도객은 경영플래너가 원천입니다. 구글 시트 자동 전송이나 경영플래너
                [데이터] 탭의 CSV 업로드로 올리면 이 보고서에 자동으로 반영됩니다. 되돌리기도 경영플래너 업로드 이력에서 합니다.
              </p>
              <a className="text-sm font-bold text-[#2f6b4f] underline" href={PLANNER_URL} target="_blank" rel="noreferrer">
                경영플래너 열기
              </a>
            </div>
          ) : (
            <>
          <JejuImportPanel
            key={report.id}
            report={report}
            store={store}
            busy={busy}
            actorName={actor.name}
            onPersist={persist}
          />
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
                  {entry.pruned
                    ? '· 되돌리기 기록 정리됨'
                    : `${entry.after.length}행 ${entry.undoneAt ? '· 복원됨' : ''}`}
                </span>
                <Button
                  variant="outline"
                  disabled={busy || !!entry.undoneAt || !!entry.pruned || readOnly}
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
            </>
          )}
        </TabsContent>
        <TabsContent value="archive" className="space-y-4 pt-3">
          <div className={panel}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-bold">보고서 보관함 · 최근 확정본</h3>
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
                    {openCorrections(store, item.id).length > 0 && (
                      <b className="mr-1 text-[#9a5800]">정정 제안 {openCorrections(store, item.id).length}건 ·</b>
                    )}
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
                        ownerId: actor.id,
                        workflow: undefined,
                        projects: undefined,
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
              최근 1개월 확정본이 없습니다. 지난 확정본은 아래 장기 보관함에서 찾을 수 있습니다.
            </p>
          )}
          <p className="text-sm text-[#64776a]">
            확정한 지 1개월이 지난 보고서는 월 백업 후 위 목록에서 빠지고 아래 <b>장기 보관함</b>에 그대로 보관됩니다.
          </p>
          <LongTermReports accessToken={accessToken} onOpen={openRecordedReport} />
          <ArchivedTasks accessToken={accessToken} data={data} />
          <ClosedArchive tracks={scopeTracks} disabled={readOnly || busy} onReopen={reopenTrack} />
        </TabsContent>
        <TabsContent value="records" className="space-y-4 pt-3">
          <RecordBrowser accessToken={accessToken} onOpenReport={openRecordedReport} openTask={openTask} />
        </TabsContent>
      </Tabs>
      <section id="report-submit" className="scroll-mt-44 space-y-4 rounded-2xl border-2 border-[#cbd8ce] p-3 md:p-4">
        <h2 className="text-lg font-bold text-[#245b43]">제출·확정</h2>
      <ReportWorkflowPanel key={report.id + (report.workflow?.submission ?? 0)} report={report} actor={actor} data={data} busy={busy} dirty={dirty} onAction={workflowAction} initialNote={correctionNote?.reportId === report.id ? correctionNote.note : ''} />
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
          {report.status !== 'final' && <p className="max-w-xs text-sm text-[#64776a]">위의 보고 제출 → 검토 완료 → 최종 확정 순서로 처리합니다.</p>}
        </div>
      </div>
      {report.status === 'final' && (
        <CorrectionPanel
          key={'c' + report.id}
          report={report}
          store={store}
          actor={actor}
          busy={busy}
          onPropose={proposeCorrection}
          onDismiss={dismissCorrection}
          onApply={applyCorrections}
        />
      )}
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
      {report.status === 'final' && <ReportDecisions key={report.id} report={report} accessToken={accessToken} actor={actor} data={data} openTask={openTask} onTask={task => updateData(current => ({ ...current, tasks: current.tasks.some(item => item.id === task.id) ? current.tasks : [...current.tasks, task] }), '결정에 연결된 후속 업무를 등록했습니다.')} />}
      </section>
      {previewing && (
        <dialog
          ref={(node) => {
            if (node && !node.open) node.showModal();
          }}
          aria-label="출력 미리보기"
          className="m-auto max-h-[90vh] w-[calc(100%-1.5rem)] max-w-3xl rounded-2xl bg-transparent p-0 backdrop:bg-black/40"
          onClose={() => setPreviewing(false)}
        >
        <section className={panel + ' max-h-[90vh] overflow-y-auto'}>
          <div className="mb-2 flex justify-end">
            <Button size="sm" variant="ghost" autoFocus onClick={() => setPreviewing(false)}>
              <X />
              닫기
            </Button>
          </div>
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
        </dialog>
      )}
    </div>
  );
}

function ReportRowEditor({
  row,
  expanded,
  suggestion,
  onToggle,
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
  expanded: boolean;
  /** 완결 제안 대상이면 '최종 완료'로 보고된 확정본 */
  suggestion?: ReportDocument;
  onToggle: () => void;
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
  const close = (closed: boolean) =>
    onChange({
      closed,
      ...(closed ? {} : { reopenedAt: new Date().toISOString() }),
      closeNote:
        closed && !row.closeNote && suggestion
          ? suggestedCloseNote(suggestion)
          : row.closeNote,
    });
  if (!expanded)
    return (
      <div
        className={
          'rounded-xl border bg-white px-3 py-2 ' +
          (suggestion ? 'border-[#efcf94]' : 'border-[#d8ded4]') +
          (row.visible ? '' : ' opacity-70')
        }
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <input
            type="checkbox"
            aria-label={row.title + ' 선택'}
            checked={selected}
            disabled={disabled}
            onChange={(e) => onSelect(e.target.checked)}
          />
          <span className="rounded bg-[#e3eee7] px-1.5 text-xs text-[#245b43]">
            {row.category || '기타'}
          </span>
          <button
            type="button"
            className="min-w-0 flex-1 truncate text-left font-medium"
            onClick={onToggle}
          >
            {row.title || '(제목 없음)'}
          </button>
          <span className="rounded-full bg-[#eef3ef] px-2 py-0.5 text-xs">
            {row.status}
            {highlight ? ' · 실적 기간 완료' : ''}
          </span>
          {row.section === 'after' && <span className="text-xs">{bucket}</span>}
          <span className="text-xs text-[#64776a]">{row.date || '일정 미정'}</span>
          {row.sourceChanged && (
            <span className="text-xs text-amber-700">원본 변경</span>
          )}
          {suggestion && (
            <span className="text-xs font-bold text-[#9a5800]">
              완결 제안 · {suggestion.config.meetingDate} 보고됨
            </span>
          )}
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={row.visible}
              disabled={disabled}
              onChange={(e) => onChange({ visible: e.target.checked })}
            />
            표출
          </label>
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={row.closed}
              disabled={disabled}
              onChange={(e) => close(e.target.checked)}
            />
            완결
          </label>
          <button
            type="button"
            className="text-xs font-bold text-[#2f6b4f]"
            onClick={onToggle}
          >
            펼치기 ▼
          </button>
        </div>
        {row.summary && (
          <p className="mt-1 line-clamp-1 text-xs text-[#64776a]">{row.summary}</p>
        )}
      </div>
    );
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
          {suggestion && (
            <span className="font-bold text-[#9a5800]">
              완결 제안 · {suggestion.config.meetingDate} 확정본에 완료 보고됨
            </span>
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
              onChange={(e) => close(e.target.checked)}
            />
            보고 완결
          </label>
          <button
            type="button"
            className="text-xs font-bold text-[#2f6b4f]"
            onClick={onToggle}
          >
            접기 ▲
          </button>
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
