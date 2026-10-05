import type { Member, Task, WorkspaceState } from './types';
import type { ReportDocument, ReportStore } from './report-types';
import { finalizeReport, reportValidation } from './reports';

export type WorkflowAction =
  | 'submit'
  | 'review'
  | 'return'
  | 'approve'
  | 'finalize'
  | 'withdraw';
export type WorkflowStatus =
  | 'submitted'
  | 'reviewing'
  | 'changes_requested'
  | 'approved'
  | 'finalized'
  | 'withdrawn';
export type ReportWorkflow = {
  status: WorkflowStatus;
  reviewerId: string;
  reviewerName: string;
  finalizerId: string;
  finalizerName: string;
  submittedBy: string;
  submission: number;
  events: {
    id: string;
    action: WorkflowAction;
    at: string;
    actorId: string;
    actorName: string;
    note: string;
  }[];
};
export type ProjectSnapshot = {
  id: string;
  title: string;
  date: string;
  total: number;
  completed: number;
  requested: number;
  overdue: number;
  tasks: Pick<
    Task,
    | 'id'
    | 'title'
    | 'status'
    | 'date'
    | 'endDate'
    | 'parentId'
    | 'links'
    | 'assigneeId'
  >[];
};
export const workflowLabels: Record<WorkflowStatus, string> = {
  submitted: '제출',
  reviewing: '검토 중',
  changes_requested: '보완 요청',
  approved: '검토 완료',
  finalized: '확정',
  withdrawn: '철회',
};
export const workflowActionLabels: Record<WorkflowAction, string> = {
  submit: '제출',
  review: '검토 시작',
  return: '보완 요청',
  approve: '검토 완료',
  finalize: '최종 확정',
  withdraw: '제출 철회',
};
export function reportLocked(report: ReportDocument) {
  return (
    report.status === 'final' ||
    (!!report.workflow &&
      !['changes_requested', 'withdrawn'].includes(report.workflow.status))
  );
}
export function projectSnapshots(
  report: ReportDocument,
  state: WorkspaceState,
): ProjectSnapshot[] {
  const selected = new Set(
    report.rows.map((row) => row.taskId).filter(Boolean),
  );
  const roots = state.tasks.filter(
    (task) =>
      !task.parentId &&
      (selected.has(task.id) ||
        state.tasks.some(
          (child) => child.parentId === task.id && selected.has(child.id),
        )),
  );
  return roots
    .filter((root) => state.tasks.some((task) => task.parentId === root.id))
    .map((root) => {
      const children = state.tasks.filter((task) => task.parentId === root.id);
      return {
        id: root.id,
        title: root.title,
        date: root.date,
        total: children.length,
        completed: children.filter((task) => task.status === 'completed')
          .length,
        requested: children.filter(
          (task) => task.status === 'completion_requested',
        ).length,
        overdue: children.filter(
          (task) =>
            task.status !== 'completed' &&
            (task.endDate ?? task.date) < report.config.cutoff,
        ).length,
        tasks: [root, ...children].map(
          ({
            id,
            title,
            status,
            date,
            endDate,
            parentId,
            links,
            assigneeId,
          }) => ({
            id,
            title,
            status,
            date,
            endDate,
            parentId,
            links,
            assigneeId,
          }),
        ),
      };
    });
}
export class WorkflowError extends Error {
  constructor(
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}
export type WorkflowInput = {
  action: WorkflowAction;
  requestId: string;
  expectedUpdatedAt: string;
  reviewerId?: string;
  finalizerId?: string;
  note?: string;
};

export function transitionReport(
  report: ReportDocument,
  input: WorkflowInput,
  actor: Member,
  state: WorkspaceState,
  store: ReportStore,
  now = new Date().toISOString(),
): ReportDocument {
  if (actor.role === 'commenter' || !actor.active)
    throw new WorkflowError('보고 처리 권한이 없습니다.', 403);
  if (
    typeof input.requestId !== 'string' ||
    !/^[a-zA-Z0-9_-]{8,100}$/.test(input.requestId)
  )
    throw new WorkflowError('요청 번호를 확인해 주세요.', 400);
  if (
    report.workflow?.events.some(
      (event) =>
        event.id === input.requestId &&
        event.actorId === actor.id &&
        event.action === input.action,
    )
  )
    return report;
  if (report.updatedAt !== input.expectedUpdatedAt)
    throw new WorkflowError(
      '보고서가 변경되었습니다. 최신 내용을 다시 불러온 뒤 확인해 주세요.',
    );
  if (report.status === 'final')
    throw new WorkflowError('확정본은 정정본을 작성해 주세요.');
  const note =
    typeof input.note === 'string' ? input.note.trim().slice(0, 4000) : '';
  const old = report.workflow;
  let next = structuredClone(report);
  let workflow: ReportWorkflow;
  if (input.action === 'submit') {
    if (reportLocked(report))
      throw new WorkflowError('이미 제출된 보고서입니다.');
    if (report.config.scope === 'mine' && report.ownerId !== actor.id)
      throw new WorkflowError('본인의 보고서만 제출할 수 있습니다.', 403);
    const issue = reportValidation(report);
    if (issue) throw new WorkflowError(issue, 400);
    if (report.originalId && !note)
      throw new WorkflowError('정정 사유를 입력해 주세요.', 400);
    const reviewer = state.members.find(
      (member) =>
        member.id === input.reviewerId &&
        member.active &&
        member.role !== 'commenter',
    );
    const finalizer = state.members.find(
      (member) =>
        member.id === input.finalizerId &&
        member.active &&
        member.role === 'admin',
    );
    if (!reviewer || !finalizer)
      throw new WorkflowError(
        '활성 검토자와 관리자 확정자를 지정해 주세요.',
        400,
      );
    if (finalizer.id === actor.id && !note)
      throw new WorkflowError(
        '본인이 확정자로 지정된 경우 예외 사유를 입력해 주세요.',
        400,
      );
    next = {
      ...finalizeReport(report, store.statistics, store.jejuArrivals ?? []),
      status: 'draft',
      finalizedAt: undefined,
      projects: projectSnapshots(report, state),
    };
    workflow = {
      status: 'submitted',
      reviewerId: reviewer.id,
      reviewerName: reviewer.name,
      finalizerId: finalizer.id,
      finalizerName: finalizer.name,
      submittedBy: actor.id,
      submission: (old?.submission ?? 0) + 1,
      events: structuredClone(old?.events ?? []),
    };
  } else {
    if (!old) throw new WorkflowError('먼저 보고서를 제출해 주세요.');
    workflow = structuredClone(old);
    const reviewer = actor.id === old.reviewerId;
    if (input.action === 'withdraw') {
      if (actor.id !== old.submittedBy && actor.role !== 'admin')
        throw new WorkflowError(
          '제출자 또는 관리자만 철회할 수 있습니다.',
          403,
        );
      if (!['submitted', 'reviewing', 'approved'].includes(old.status))
        throw new WorkflowError('철회할 수 없는 상태입니다.');
      if (!note) throw new WorkflowError('철회 사유를 입력해 주세요.', 400);
      workflow.status = 'withdrawn';
    } else if (input.action === 'finalize') {
      if (actor.id !== old.finalizerId || actor.role !== 'admin')
        throw new WorkflowError(
          '지정된 관리자 확정자만 확정할 수 있습니다.',
          403,
        );
      if (old.status !== 'approved')
        throw new WorkflowError('검토 완료 후 확정해 주세요.');
      workflow.status = 'finalized';
      next.status = 'final';
      next.finalizedAt = now;
    } else {
      if (!reviewer)
        throw new WorkflowError('지정된 검토자만 처리할 수 있습니다.', 403);
      if (!['submitted', 'reviewing'].includes(old.status))
        throw new WorkflowError('검토할 수 없는 상태입니다.');
      if (input.action === 'review') workflow.status = 'reviewing';
      else if (input.action === 'return') {
        if (!note)
          throw new WorkflowError('보완할 내용과 사유를 입력해 주세요.', 400);
        workflow.status = 'changes_requested';
      } else if (input.action === 'approve') workflow.status = 'approved';
      else throw new WorkflowError('지원하지 않는 처리입니다.', 400);
    }
  }
  workflow.events.push({
    id: input.requestId,
    action: input.action,
    at: now,
    actorId: actor.id,
    actorName: actor.name,
    note,
  });
  return { ...next, workflow, updatedAt: now };
}
