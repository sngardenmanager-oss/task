export type Role = 'admin' | 'member' | 'commenter';
export type TaskStatus =
  | 'scheduled'
  | 'in_progress'
  | 'completion_requested'
  | 'completed';

export type Member = {
  id: string;
  name: string;
  email: string;
  role: Role;
  team: string;
  active: boolean;
};

/** 팀마다 작업공간(WorkspaceState)이 하나씩 있습니다. */
export type Team = {
  id: string;
  name: string;
  color: string;
  active: boolean;
  sortOrder: number;
};

/** 누가 어느 팀에 들어갈 수 있는지의 기준입니다. 역할의 기준은 팀 작업공간의 members입니다. */
export type TeamMembership = {
  teamId: string;
  email: string;
  memberId: string;
  role: Role;
  active: boolean;
};

/** 마스터 '전체 팀' 통합 관제에 쓰는 팀 하나의 요약입니다. 업무에는 댓글 본문 대신 댓글 수만 있습니다. */
export type OverviewTeam = {
  team: Team;
  members: Member[];
  categories: Category[];
  tasks: (Task & { commentCount: number })[];
  openNotes: number;
};

/** 마스터 팀 관리 화면에 보이는 소속 한 줄입니다. */
export type TeamDirectoryEntry = TeamMembership & { name: string };

export type RegistrationRequest = {
  id: string;
  name: string;
  email: string;
  requestedAt: string;
  emailConfirmed: boolean;
};

export type Category = {
  id: string;
  name: string;
  color: string;
  active: boolean;
};

export type Comment = {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
};

export type ReferenceLink = {
  id: string;
  title: string;
  url: string;
  /** 0이면 첫 체크 항목 앞, 1이면 첫 항목 뒤에 표시합니다. */
  afterChecklistIndex: number;
};

export type TaskLink = {
  id: string;
  /** 연결 대상 업무 id */
  taskId: string;
  /** prerequisite: 대상 업무가 먼저 끝나야 이 업무를 할 수 있음, related: 참고할 관련 업무 */
  kind: 'prerequisite' | 'related';
  createdBy: string;
  createdAt: string;
  /** 연결을 해제한 시각. 서버 병합 때 해제한 연결이 되살아나지 않도록 기록만 남깁니다. */
  removedAt?: string;
};

export type Task = {
  id: string;
  title: string;
  description: string;
  date: string;
  endDate?: string;
  /** HH:mm, 24시간제. 비어 있으면 종일 업무입니다. */
  time?: string;
  /** HH:mm, 24시간제. time이 있을 때만 의미가 있습니다. */
  endTime?: string;
  categoryId: string;
  assigneeId: string;
  collaborators: string[];
  priority: 'urgent' | 'normal' | 'low';
  status: TaskStatus;
  type: 'task' | 'issue' | 'event' | 'routine';
  checklist: { id: string; text: string; done: boolean }[];
  comments: Comment[];
  sourceNoteId?: string;
  sourceRoutineId?: string;
  completedAt?: string;
  statusHistory?: { at: string; actorId: string; from: TaskStatus; to: TaskStatus }[];
  /** 메인 일정 id. 있으면 이 업무는 하위 일정입니다. 하위의 하위는 두지 않습니다. */
  parentId?: string;
  /** 메인 일정 시작일(D-day) 기준 일수(-40 = 40일 전). 없으면 날짜를 직접 지정한 것입니다. */
  offsetDays?: number;
  /** 이 업무에서 건 연결. 한쪽에만 저장하고 반대쪽은 계산해 보여줍니다. */
  links?: TaskLink[];
  createdBy: string;
  createdAt: string;
};

export type ProjectTemplateItem = {
  title: string;
  offsetDays: number;
  categoryId: string;
  checklist: string[];
};

export type ProjectTemplate = {
  id: string;
  name: string;
  items: ProjectTemplateItem[];
  createdBy: string;
  createdAt: string;
};

export type Routine = {
  id: string;
  title: string;
  categoryId: string;
  assigneeId: string;
  cadence: string;
  checklist: string[];
  checklistDone?: boolean[];
  referenceLinks?: ReferenceLink[];
  /** 예전 데이터 호환용입니다. 새 데이터는 referenceLinks를 사용합니다. */
  referenceUrl?: string;
  active: boolean;
  nextDate: string;
};

export type SpecialNote = {
  id: string;
  label: string;
  date: string;
  categoryId: string;
  location: string;
  body: string;
  urgent: boolean;
  createdBy: string;
  createdAt: string;
  convertedTaskId?: string;
  completed?: boolean;
  completedAt?: string;
  comments?: Comment[];
};

export type NewsItem = {
  id: string;
  title: string;
  category: string;
  source: string;
  collectedAt: string;
  url?: string;
};

export type WorkspaceState = {
  members: Member[];
  categories: Category[];
  tasks: Task[];
  routines: Routine[];
  notes: SpecialNote[];
  projectTemplates?: ProjectTemplate[];
  deletedIds?: string[];
};

declare global {
  interface Window {
    snoopyDesktop?: {
      collectRecentNews: () => Promise<{
        items: {
          id: string;
          title: string;
          category: string;
          source: string;
          url?: string;
          pubDate: string;
        }[];
        snapshotId: string;
        skipped: boolean;
        error?: string;
      }>;
      markNewsSynced: (snapshotId: string) => Promise<boolean>;
    };
  }

  interface Document {
    modelContext?: {
      registerTool: (
        tool: {
          name: string;
          title?: string;
          description: string;
          inputSchema: Record<string, unknown>;
          annotations?: {
            readOnlyHint?: boolean;
            untrustedContentHint?: boolean;
          };
          execute: (
            input: unknown,
          ) =>
            | Promise<unknown>
            | Record<string, unknown>
            | unknown[]
            | string
            | number
            | boolean
            | null;
        },
        options?: { signal?: AbortSignal },
      ) => void | Promise<void>;
    };
  }
}
