import type { NewsItem, TaskStatus } from './types';

export type NewsTone = 'positive' | 'negative';
export type ReportNewsItem = NewsItem & { tone?: NewsTone };
export type ReportRow = {
  id: string;
  taskId?: string;
  noteId?: string;
  sourceRoutineId?: string;
  section: 'before' | 'after';
  category: string;
  title: string;
  summary: string;
  nextAction: string;
  assignee: string;
  date: string;
  status: string;
  completedAt?: string;
  sourceChanged?: string;
  sourceFingerprint?: string;
  visible: boolean;
  closed: boolean;
  closeNote: string;
  previousPromise?: string;
  followup: string;
  delayReason: string;
  checklist: { id: string; text: string; done: boolean }[];
};
export type ReportAgenda = {
  id: string;
  kind: '단순 보고' | '결정 요청' | '지시 후속';
  title: string;
  situation: string;
  options: string;
  opinion: string;
  dueDate: string;
  decision: string;
  assigneeId: string;
  taskId?: string;
  visible: boolean;
};
export type ReportConfig = {
  title: string;
  meetingDate: string;
  cutoff: string;
  actualStart: string;
  actualEnd: string;
  planStart: string;
  planEnd: string;
  statsStart: string;
  statsEnd: string;
  scope: 'mine' | 'team';
  team: string;
  author: string;
  attendees: string;
  metricNote: string;
};
export type ReportMetric = {
  label: string;
  current: number | null;
  previous: number | null;
  change: number | null;
  unit: string;
  comparison: string;
  missing: number;
  previousMissing: number;
};
export type Statistic = {
  date: string;
  revenue: number | null;
  visitors: number | null;
  groups: number | null;
  foreigners: number | null;
  foreignGroups: number | null;
  groupGeneral: number | null;
  groupLocal: number | null;
  groupWelfare: number | null;
  memo: string;
};
export type JejuArrival = {
  date: string;
  total: number | null;
  domestic: number | null;
  foreign: number | null;
  source: string;
  asOf: string;
  status: 'provisional' | 'final';
};
export type JejuArrivalImport = {
  id: string;
  filename: string;
  at: string;
  actor: string;
  before: (JejuArrival | null)[];
  after: JejuArrival[];
  undoneAt?: string;
  /** 새 업로드가 들어와 되돌리기용 복사본을 비운 기록입니다(이름표만 남김). */
  pruned?: boolean;
};
export type ReportDocument = {
  workflow?: import('./report-workflow').ReportWorkflow;
  projects?: import('./report-workflow').ProjectSnapshot[];
  id: string;
  ownerId: string;
  config: ReportConfig;
  rows: ReportRow[];
  agendas: ReportAgenda[];
  news: ReportNewsItem[];
  status: 'draft' | 'final';
  revision: number;
  originalId?: string;
  previousId?: string;
  createdAt: string;
  updatedAt: string;
  finalizedAt?: string;
  metrics: ReportMetric[];
  statistics: Statistic[];
  jejuArrivals?: JejuArrival[];
  jejuCalculationVersion?: 1;
  comparisonStart: string;
  comparisonEnd: string;
  templateVersion: 1;
};
export type ReportTrack = {
  id: string;
  row: ReportRow;
  scopeKey: string;
  closed: boolean;
  history: { at: string; actor: string; closed: boolean; note: string }[];
};
export type StatisticImport = {
  id: string;
  filename: string;
  at: string;
  actor: string;
  before: (Statistic | null)[];
  after: Statistic[];
  undoneAt?: string;
  /** 새 업로드가 들어와 되돌리기용 복사본을 비운 기록입니다(이름표만 남김). */
  pruned?: boolean;
};
export type ReportStore = {
  reports: ReportDocument[];
  tracks: ReportTrack[];
  statistics: Statistic[];
  imports: StatisticImport[];
  jejuArrivals?: JejuArrival[];
  jejuImports?: JejuArrivalImport[];
  archiveLinks: Record<string, string>;
  /** 백업 후 자동 정리한 확정 보고서 id. 오래 열어 둔 화면이 다시 살려내지 못하게 기록합니다. */
  deletedReportIds?: string[];
};
export type TaskStatusHistory = {
  at: string;
  actorId: string;
  from: TaskStatus;
  to: TaskStatus;
};
