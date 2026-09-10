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

export type Task = {
  id: string;
  title: string;
  description: string;
  date: string;
  endDate?: string;
  categoryId: string;
  assigneeId: string;
  collaborators: string[];
  priority: 'urgent' | 'normal' | 'low';
  status: TaskStatus;
  type: 'task' | 'issue' | 'event' | 'routine';
  checklist: { id: string; text: string; done: boolean }[];
  comments: Comment[];
  sourceNoteId?: string;
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
