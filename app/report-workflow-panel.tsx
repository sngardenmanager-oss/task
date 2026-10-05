'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { Member, WorkspaceState } from '@/lib/types';
import type { ReportDocument } from '@/lib/report-types';
import {
  projectSnapshots,
  reportLocked,
  workflowLabels,
  workflowActionLabels,
  type WorkflowAction,
} from '@/lib/report-workflow';

export default function ReportWorkflowPanel({
  report,
  actor,
  data,
  busy,
  dirty,
  onAction,
  openTask,
}: {
  report: ReportDocument;
  actor: Member;
  data: WorkspaceState;
  busy: boolean;
  dirty: boolean;
  onAction: (
    action: WorkflowAction,
    reviewerId: string,
    finalizerId: string,
    note: string,
  ) => Promise<void>;
  openTask: (id: string) => void;
}) {
  const members = data.members.some((m) => m.id === actor.id)
    ? data.members
    : [...data.members, actor];
  const [reviewer, setReviewer] = useState(
    report.workflow?.reviewerId ??
      members.find((m) => m.active && m.role === 'admin')?.id ??
      '',
  );
  const [finalizer, setFinalizer] = useState(
    report.workflow?.finalizerId ??
      members.find((m) => m.active && m.role === 'admin')?.id ??
      '',
  );
  const [note, setNote] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const workflow = report.workflow;
  const frozen = reportLocked(report);
  const snapshots =
    !showCurrent && report.projects
      ? report.projects
      : projectSnapshots(report, data);
  const current = projectSnapshots(report, data);
  const changed =
    report.projects &&
    JSON.stringify(report.projects) !== JSON.stringify(current);
  const actions: WorkflowAction[] = [];
  if (!frozen) actions.push('submit');
  if (
    workflow &&
    ['submitted', 'reviewing'].includes(workflow.status) &&
    actor.id === workflow.reviewerId
  )
    actions.push('review', 'return', 'approve');
  if (
    workflow?.status === 'approved' &&
    actor.id === workflow.finalizerId &&
    actor.role === 'admin'
  )
    actions.push('finalize');
  if (
    workflow &&
    ['submitted', 'reviewing', 'approved'].includes(workflow.status) &&
    (actor.id === workflow.submittedBy || actor.role === 'admin')
  )
    actions.push('withdraw');
  const field =
    'w-full rounded-lg border border-[#cbd8ce] bg-white p-2 text-sm';
  return (
    <section className="space-y-4 rounded-2xl border border-[#cbd8ce] bg-[#f2f7f3] p-4">
      <div className="flex flex-wrap justify-between gap-2">
        <h3 className="font-bold text-[#245b43]">보고 제출과 처리 기록</h3>
        <strong>
          {workflow
            ? workflowLabels[workflow.status]
            : report.status === 'final'
              ? '기존 확정본 · 승인 이력 없음'
              : '작성 중'}
        </strong>
      </div>
      <p className="break-all text-xs text-[#64776a]">
        보고 번호 {report.id} · 수정 {report.revision}{' '}
        {workflow ? `· 제출 ${workflow.submission}회` : ''}
      </p>
      {!frozen && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            검토자
            <select
              aria-label="보고 검토자"
              className={field}
              value={reviewer}
              onChange={(e) => setReviewer(e.target.value)}
            >
              <option value="">선택</option>
              {members
                .filter((m) => m.active && m.role !== 'commenter')
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="text-sm">
            최종 확정자
            <select
              aria-label="보고 확정자"
              className={field}
              value={finalizer}
              onChange={(e) => setFinalizer(e.target.value)}
            >
              <option value="">선택</option>
              {members
                .filter((m) => m.active && m.role === 'admin')
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
      )}
      {workflow && (
        <p className="text-sm">
          검토 {workflow.reviewerName} → 확정 {workflow.finalizerName} · 제출
          후에는 보완 요청 또는 철회 후 수정할 수 있습니다.
        </p>
      )}
      {actions.length > 0 && (
        <>
          <label className="block text-sm">
            처리 의견과 사유
            <textarea
              aria-label="보고 처리 사유"
              className={field}
              value={note}
              maxLength={4000}
              onChange={(e) => setNote(e.target.value)}
              placeholder="보완·철회·정정 또는 본인 확정 예외 사유를 남겨 주세요."
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => (
              <Button
                key={action}
                disabled={busy || (action === 'submit' && dirty)}
                variant={
                  action === 'return' || action === 'withdraw'
                    ? 'outline'
                    : 'default'
                }
                onClick={() => void onAction(action, reviewer, finalizer, note)}
              >
                {action === 'submit'
                  ? '보고 제출'
                  : workflowActionLabels[action]}
              </Button>
            ))}
          </div>
          {dirty && (
            <p className="text-sm text-amber-800">
              초안을 저장한 뒤 제출해 주세요.
            </p>
          )}
        </>
      )}
      {workflow?.events.length ? (
        <details>
          <summary className="cursor-pointer text-sm font-semibold">
            처리 이력 {workflow.events.length}건
          </summary>
          <ol className="mt-2 space-y-2">
            {[...workflow.events].reverse().map((event) => (
              <li className="rounded-lg bg-white p-3 text-sm" key={event.id}>
                <strong>{workflowActionLabels[event.action]}</strong> ·{' '}
                {event.actorName} · {new Date(event.at).toLocaleString('ko-KR')}
                <p className="whitespace-pre-wrap">
                  {event.note || '의견 없음'}
                </p>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      {!!snapshots.length && (
        <div className="space-y-3 border-t border-[#cbd8ce] pt-3">
          <div className="flex flex-wrap justify-between gap-2">
            <h4 className="font-semibold">연결 프로젝트 현황</h4>
            {report.projects && (
              <Button
                variant="outline"
                onClick={() => setShowCurrent(!showCurrent)}
              >
                {showCurrent ? '보고 당시 보기' : '현재 업무와 비교'}
              </Button>
            )}
          </div>
          <p className="text-xs text-[#64776a]">
            {report.projects && !showCurrent
              ? '제출 당시 보존된 내용'
              : '현재 저장된 업무'}{' '}
            · 지연은 보고 기준일 대비 미완료 하위 업무입니다.
            {changed ? ' 보고 이후 원본 변경이 있습니다.' : ''}
          </p>
          {snapshots.map((project) => (
            <article className="rounded-xl bg-white p-3" key={project.id}>
              <button
                className="font-bold underline"
                onClick={() => openTask(project.id)}
              >
                {project.title}
              </button>
              <p className="my-2 text-sm">
                D-day {project.date} · 최종 완료 {project.completed}/
                {project.total} · 완료 요청 {project.requested} · 지연{' '}
                {project.overdue}
              </p>
              <progress
                className="h-2 w-full accent-[#2f6b4f]"
                value={project.completed}
                max={project.total || 1}
                aria-label={`${project.title} 완료율`}
              />
              <details className="mt-2 text-sm">
                <summary>하위 일정과 연결 보기</summary>
                {project.tasks
                  .filter((task) => task.id !== project.id)
                  .map((task) => (
                    <button
                      key={task.id}
                      className="mt-1 block text-left underline"
                      onClick={() => openTask(task.id)}
                    >
                      {task.title} · {task.date} ·{' '}
                      {
                        {
                          scheduled: '예정',
                          in_progress: '진행 중',
                          completion_requested: '완료 요청',
                          completed: '최종 완료',
                        }[task.status]
                      }
                    </button>
                  ))}
              </details>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
