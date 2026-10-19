import type { Member } from './types';
import type { ReportStore } from './report-types';

/** 확정본 정정 제안. 회의 직전에 확정본 오류를 발견하면 누구나(댓글 전용 제외) 제안을 남기고,
 * 관리자가 '정정본으로 반영' 또는 '반려'로 처리합니다. 확정본 자체는 바꾸지 않습니다. */
export type CorrectionProposal = {
  id: string;
  reportId: string;
  note: string;
  proposedBy: string;
  proposedByName: string;
  at: string;
  status: 'open' | 'applied' | 'dismissed';
  resolvedBy?: string;
  resolvedByName?: string;
  resolvedAt?: string;
  resolution?: string;
};
export type CorrectionInput =
  | { kind: 'correction'; requestId: string; reportId: string; note: string }
  | {
      kind: 'correction-resolve';
      requestId: string;
      proposalId: string;
      decision: 'applied' | 'dismissed';
      note?: string;
    };
export class CorrectionError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
const REQUEST_ID = /^[a-zA-Z0-9_-]{8,100}$/;
const text = (value: unknown, limit: number) =>
  typeof value === 'string' ? value.trim().slice(0, limit) : '';

export function openCorrections(store: ReportStore, reportId?: string) {
  return (store.corrections ?? []).filter(
    (item) => item.status === 'open' && (!reportId || item.reportId === reportId),
  );
}

export function applyCorrectionInput(
  store: ReportStore,
  input: CorrectionInput,
  actor: Member,
  now = new Date().toISOString(),
): ReportStore {
  if (actor.role === 'commenter' || !actor.active)
    throw new CorrectionError('정정 제안 권한이 없습니다.', 403);
  if (typeof input.requestId !== 'string' || !REQUEST_ID.test(input.requestId))
    throw new CorrectionError('요청 번호를 확인해 주세요.');
  const list = store.corrections ?? [];
  if (input.kind === 'correction') {
    // 같은 요청을 두 번 보내도 한 번만 남깁니다.
    if (list.some((item) => item.id === input.requestId)) return store;
    const report = store.reports.find((item) => item.id === input.reportId);
    if (!report || report.status !== 'final')
      throw new CorrectionError('확정본에만 정정 제안을 남길 수 있습니다.', 404);
    const note = text(input.note, 2000);
    if (!note) throw new CorrectionError('잘못된 내용과 고칠 내용을 입력해 주세요.');
    return {
      ...store,
      corrections: [
        ...list,
        {
          id: input.requestId,
          reportId: report.id,
          note,
          proposedBy: actor.id,
          proposedByName: actor.name,
          at: now,
          status: 'open',
        },
      ],
    };
  }
  if (input.kind === 'correction-resolve') {
    if (actor.role !== 'admin')
      throw new CorrectionError('정정 제안은 관리자가 처리합니다.', 403);
    const current = list.find((item) => item.id === input.proposalId);
    if (!current) throw new CorrectionError('정정 제안을 찾지 못했습니다.', 404);
    if (current.status !== 'open') {
      if (current.status === input.decision && current.resolvedBy === actor.id)
        return store;
      throw new CorrectionError('이미 처리된 정정 제안입니다.', 409);
    }
    if (input.decision !== 'applied' && input.decision !== 'dismissed')
      throw new CorrectionError('지원하지 않는 처리입니다.');
    const resolution = text(input.note, 2000);
    if (input.decision === 'dismissed' && !resolution)
      throw new CorrectionError('반려 사유를 입력해 주세요.');
    return {
      ...store,
      corrections: list.map((item) =>
        item.id === current.id
          ? {
              ...item,
              status: input.decision,
              resolvedBy: actor.id,
              resolvedByName: actor.name,
              resolvedAt: now,
              resolution: resolution || '정정본 작성으로 반영',
            }
          : item,
      ),
    };
  }
  throw new CorrectionError('지원하지 않는 요청입니다.');
}
