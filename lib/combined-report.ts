import { completedDay, shiftDay, validDay } from './reports';
import type { ReportDocument, ReportStore } from './report-types';
import type { Task, WorkspaceState } from './types';

/** 마스터 통합 보고서: 팀마다 그 주의 주간회의 보고서(확정본 우선)를 모으고,
 * 보고서가 없는 팀은 업무 기록에서 전주 실적·금주 계획을 자동으로 정리합니다. */

export type CombinedRow = {
  title: string;
  category: string;
  assignee: string;
  date: string;
  status: string;
  summary: string;
};

export type CombinedWeek = {
  meetingDate: string;
  actualStart: string;
  actualEnd: string;
  planStart: string;
  planEnd: string;
};

export type CombinedTeamReport = {
  teamId: string;
  source: 'final' | 'draft' | 'auto';
  reportTitle?: string;
  author?: string;
  updatedAt?: string;
  before: CombinedRow[];
  after: CombinedRow[];
  overdue: number;
};

const statusNames: Record<Task['status'], string> = {
  scheduled: '예정',
  in_progress: '진행 중',
  completion_requested: '완료 승인 대기',
  completed: '최종 완료',
};

/** 주간회의 날짜가 속한 주의 월요일을 기준으로 전주(실적)와 금주(계획) 기간을 정합니다. */
export function combinedWeek(meetingDate: string): CombinedWeek {
  if (!validDay(meetingDate)) throw new Error('회의 날짜를 확인해 주세요.');
  const weekday = new Date(`${meetingDate}T12:00:00Z`).getUTCDay();
  const monday = shiftDay(meetingDate, -(weekday === 0 ? 6 : weekday - 1));
  return {
    meetingDate,
    actualStart: shiftDay(monday, -7),
    actualEnd: shiftDay(monday, -1),
    planStart: monday,
    planEnd: shiftDay(monday, 6),
  };
}

/** 회의 날짜가 이번 주(월~일)에 드는 보고서 중 확정본을, 없으면 가장 최근 초안을 고릅니다. */
export function pickWeekReport(
  store: ReportStore | null,
  week: CombinedWeek,
): ReportDocument | null {
  const inWeek = (store?.reports ?? []).filter(
    (report) =>
      report.config.meetingDate >= week.planStart &&
      report.config.meetingDate <= week.planEnd,
  );
  const latest = (items: ReportDocument[]) =>
    [...items].sort((a, b) =>
      (b.finalizedAt ?? b.updatedAt).localeCompare(a.finalizedAt ?? a.updatedAt),
    )[0] ?? null;
  return (
    latest(inWeek.filter((report) => report.status === 'final')) ??
    latest(inWeek.filter((report) => report.status === 'draft'))
  );
}

function overlaps(task: Task, start: string, end: string) {
  return task.date <= end && (task.endDate ?? task.date) >= start;
}

/** 업무 기록만으로 만든 실적·계획. 실적은 전주에 완료됐거나 전주에 걸친 업무, 계획은 금주에 걸친 업무입니다. */
export function autoTeamRows(state: WorkspaceState, week: CombinedWeek) {
  const name = (id: string) => state.members.find((m) => m.id === id)?.name ?? '';
  const row = (task: Task): CombinedRow => ({
    title: task.title,
    category: state.categories.find((c) => c.id === task.categoryId)?.name ?? '기타',
    assignee: [task.assigneeId, ...task.collaborators].map(name).filter(Boolean).join(', '),
    date: task.date,
    status:
      task.status === 'completed'
        ? `최종 완료${task.completedAt ? ` (${completedDay(task.completedAt).slice(5)})` : ''}`
        : statusNames[task.status],
    summary: task.description,
  });
  const byDate = (a: Task, b: Task) => a.date.localeCompare(b.date);
  const before = state.tasks
    .filter((task) => {
      const done = completedDay(task.completedAt);
      return (
        (task.status === 'completed' && done >= week.actualStart && done <= week.actualEnd) ||
        overlaps(task, week.actualStart, week.actualEnd)
      );
    })
    .sort(byDate)
    .map(row);
  const after = state.tasks
    .filter((task) => overlaps(task, week.planStart, week.planEnd))
    .sort(byDate)
    .map(row);
  return { before, after };
}

export function reportRows(report: ReportDocument) {
  const toRow = (row: ReportDocument['rows'][number]): CombinedRow => ({
    title: row.title,
    category: row.category,
    assignee: row.assignee,
    date: row.date,
    status: row.status,
    summary: [row.summary, row.nextAction].filter(Boolean).join(' / '),
  });
  const visible = report.rows.filter((row) => row.visible);
  return {
    before: visible.filter((row) => row.section === 'before').map(toRow),
    after: visible.filter((row) => row.section === 'after').map(toRow),
  };
}

export function countOverdue(state: WorkspaceState, today: string) {
  return state.tasks.filter(
    (task) => task.status !== 'completed' && (task.endDate ?? task.date) < today,
  ).length;
}
