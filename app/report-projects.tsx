'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { WorkspaceState } from '@/lib/types';
import type { ReportDocument } from '@/lib/report-types';
import {
  childDelay,
  projectSnapshots,
  sortProjects,
  type ProjectSnapshot,
} from '@/lib/report-workflow';

const SHOWN = 3;
const statusNames = {
  scheduled: '예정',
  in_progress: '진행 중',
  completion_requested: '완료 요청',
  completed: '최종 완료',
} as const;
const levelBadge: Record<number, [string, string] | undefined> = {
  3: ['지연 있음', 'bg-[#fdecec] text-[#b42318]'],
  2: ['D-day 임박', 'bg-[#fff3dc] text-[#9a5800]'],
  1: ['승인 대기', 'bg-[#e8eefc] text-[#1d4ed8]'],
  [-1]: ['모두 완료', 'bg-[#e3eee7] text-[#245b43]'],
};

function ProjectRow({
  project,
  level,
  cutoff,
  openTask,
}: {
  project: ProjectSnapshot;
  level: number;
  cutoff: string;
  openTask: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const children = project.tasks.filter((task) => task.id !== project.id);
  // 먼저 끝난 하위 일정은 숨기고 남은 일정만 보여 줍니다.
  const done = children.filter((task) => task.status === 'completed');
  const remaining = children.filter((task) => task.status !== 'completed');
  const badge = levelBadge[level];
  const percent = project.total
    ? Math.round((project.completed / project.total) * 100)
    : 0;
  return (
    <li className="rounded-xl border border-[#e3e8e0] bg-white p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left font-bold underline-offset-2 hover:underline"
          onClick={() => openTask(project.id)}
        >
          {project.title}
        </button>
        {badge && (
          <span className={'rounded-full px-2 py-0.5 text-xs font-bold ' + badge[1]}>
            {badge[0]}
          </span>
        )}
        <span className="text-sm text-[#64776a]">D-day {project.date}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <progress
          className="h-2 w-32 accent-[#2f6b4f]"
          value={project.completed}
          max={project.total || 1}
          aria-label={`${project.title} 완료율 ${percent}%`}
        />
        <span>
          완료 {project.completed}/{project.total}
        </span>
        {project.overdue > 0 && (
          <span className="font-bold text-[#b42318]">지연 {project.overdue}</span>
        )}
        {!!project.overrun && (
          <span className="text-[#b45309]">기간 초과 {project.overrun}</span>
        )}
        {project.requested > 0 && (
          <span className="text-[#1d4ed8]">승인 대기 {project.requested}</span>
        )}
        <button
          type="button"
          aria-expanded={open}
          className="ml-auto text-xs font-bold text-[#2f6b4f]"
          onClick={() => setOpen(!open)}
        >
          {open ? '하위 일정 접기 ▲' : `남은 하위 일정 ${remaining.length}건 ▼`}
        </button>
      </div>
      {open && (
        <div className="mt-2 space-y-1 border-t border-dashed pt-2 text-sm">
          {!remaining.length && (
            <p className="text-[#64776a]">남은 하위 일정이 없습니다.</p>
          )}
          {remaining.map((task) => {
            const delay = childDelay(task, cutoff);
            return (
              <button
                key={task.id}
                type="button"
                className="block text-left underline-offset-2 hover:underline"
                onClick={() => openTask(task.id)}
              >
                {task.title} · {task.date} · {statusNames[task.status]}
                {delay === 'overdue' && <b className="text-[#b42318]"> · 지연</b>}
                {delay === 'overrun' && <span className="text-[#b45309]"> · 기간 초과</span>}
              </button>
            );
          })}
          {done.length > 0 && (
            <button
              type="button"
              className="text-xs text-[#64776a] underline"
              onClick={() => setShowDone(!showDone)}
            >
              {showDone ? '완료한 하위 일정 숨기기' : `완료한 하위 일정 ${done.length}건 보기`}
            </button>
          )}
          {showDone &&
            done.map((task) => (
              <button
                key={task.id}
                type="button"
                className="block text-left text-[#64776a] line-through"
                onClick={() => openTask(task.id)}
              >
                {task.title} · {task.date}
              </button>
            ))}
        </div>
      )}
    </li>
  );
}

/** 연결 프로젝트 현황. 주의가 필요한 순서(지연 → D-day 7일 이내 → 승인 대기)로 3건만 먼저 보이고,
 * 나머지는 펼친 상자 안에서 스크롤해 봅니다. 주의 표시가 없으면 최근 등록 순입니다. */
export default function ReportProjects({
  report,
  data,
  openTask,
}: {
  report: ReportDocument;
  data: WorkspaceState;
  openTask: (id: string) => void;
}) {
  const [showCurrent, setShowCurrent] = useState(false);
  const [showRest, setShowRest] = useState(false);
  const current = projectSnapshots(report, data);
  const frozen = !showCurrent && !!report.projects;
  const list = sortProjects(frozen ? report.projects! : current, report.config.cutoff);
  const changed =
    report.projects && JSON.stringify(report.projects) !== JSON.stringify(current);
  const attention = list.filter((item) => item.level > 0).length;
  if (!list.length) return null;
  const top = list.slice(0, SHOWN);
  const rest = list.slice(SHOWN);
  const row = (item: (typeof list)[number]) => (
    <ProjectRow
      key={item.project.id}
      project={item.project}
      level={item.level}
      cutoff={report.config.cutoff}
      openTask={openTask}
    />
  );
  return (
    <section
      id="report-projects"
      className="scroll-mt-44 space-y-3 rounded-2xl border border-[#d8ded4] bg-[#f6faf7] p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-bold text-[#245b43]">
            연결 프로젝트 {list.length}건
            {attention > 0 && <span className="text-[#b42318]"> · 주의 {attention}</span>}
          </h3>
          <p className="text-xs text-[#64776a]">
            {frozen ? '제출 당시 보존된 내용' : '현재 저장된 업무'} · 지연은 기준일(
            {report.config.cutoff}) 전에 끝나야 했던 예정 상태 하위 일정입니다.
            {changed ? ' 보고 이후 원본 변경이 있습니다.' : ''}
          </p>
        </div>
        {report.projects && (
          <Button size="sm" variant="outline" onClick={() => setShowCurrent(!showCurrent)}>
            {showCurrent ? '보고 당시 보기' : '현재 업무와 비교'}
          </Button>
        )}
      </div>
      <ul className="space-y-2">{top.map(row)}</ul>
      {rest.length > 0 && (
        <>
          <button
            type="button"
            aria-expanded={showRest}
            className="w-full rounded-lg border border-dashed border-[#b9c8bd] bg-white py-2 text-sm font-bold text-[#2f6b4f]"
            onClick={() => setShowRest(!showRest)}
          >
            {showRest ? '나머지 프로젝트 접기 ▲' : `나머지 ${rest.length}건 보기 ▼`}
          </button>
          {showRest && (
            <ul className="max-h-96 space-y-2 overflow-y-auto pr-1">{rest.map(row)}</ul>
          )}
        </>
      )}
    </section>
  );
}
