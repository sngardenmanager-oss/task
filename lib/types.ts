export type Role = 'admin' | 'member' | 'commenter';
export type TaskStatus = 'scheduled' | 'in_progress' | 'completion_requested' | 'completed';

export type Member = {
  id: string;
  name: string;
  email: string;
  role: Role;
  team: string;
  active: boolean;
};

export type Category = { id: string; name: string; color: string; active: boolean };

export type Comment = { id: string; authorId: string; body: string; createdAt: string };

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
};

export type NewsItem = {
  id: string;
  title: string;
  summary: string;
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
  news: NewsItem[];
};

declare global {
  interface Document {
    modelContext?: {
      registerTool: (
        tool: {
          name: string;
          title?: string;
          description: string;
          inputSchema: Record<string, unknown>;
          annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
          execute: (input: unknown) => Promise<unknown> | Record<string, unknown> | unknown[] | string | number | boolean | null;
        },
        options?: { signal?: AbortSignal },
      ) => void | Promise<void>;
    };
  }
}
