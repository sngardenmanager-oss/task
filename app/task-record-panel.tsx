'use client';
import { useState } from 'react';
import type { Task, WorkspaceState } from '@/lib/types';
import RecordBrowser from './record-browser';
import { Button } from '@/components/ui/button';

export default function TaskRecordPanel({
  task,
  data,
  accessToken,
  canRead,
  openTask,
}: {
  task: Task;
  data: WorkspaceState;
  accessToken: string;
  canRead: boolean;
  openTask: (id: string) => void;
}) {
  const [showRecords, setShowRecords] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const linked = (source: Task) =>
    data.tasks.filter(
      (item) =>
        item.id !== source.id &&
        (item.parentId === source.id ||
          source.parentId === item.id ||
          source.links?.some(
            (link) => !link.removedAt && link.taskId === item.id,
          ) ||
          item.links?.some(
            (link) => !link.removedAt && link.taskId === source.id,
          )),
    );
  const direct = linked(task);
  const seen = new Set([task.id, ...direct.map((t) => t.id)]);
  const indirect: Task[] = [];
  if (expanded)
    for (const source of direct)
      for (const item of linked(source))
        if (!seen.has(item.id) && indirect.length < 50) {
          seen.add(item.id);
          indirect.push(item);
        }
  const label = (item: Task) => {
    if (item.parentId === task.id) return '하위 일정';
    if (task.parentId === item.id) return '메인 일정';
    if (
      task.links?.some(
        (link) =>
          !link.removedAt &&
          link.kind === 'prerequisite' &&
          link.taskId === item.id,
      )
    )
      return '선행 → 현재';
    if (
      item.links?.some(
        (link) =>
          !link.removedAt &&
          link.kind === 'prerequisite' &&
          link.taskId === task.id,
      )
    )
      return '현재 → 후속';
    return '관련 업무';
  };
  const status = {
    scheduled: '예정',
    in_progress: '진행 중',
    completion_requested: '완료 요청',
    completed: '최종 완료',
  };
  return (
    <section className="space-y-3 rounded-xl border border-[#cbd8ce] bg-[#f7f9f4] p-3">
      <h3 className="font-bold">업무 흐름과 기록</h3>
      <div className="rounded-xl bg-[#245b43] p-3 text-sm text-white">
        <strong>현재 · {task.title}</strong>
        <p>
          {status[task.status]} · {task.date}
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {[...direct, ...indirect].map((item) => (
          <button
            key={item.id}
            onClick={() => openTask(item.id)}
            className="rounded-xl border bg-white p-3 text-left"
          >
            <span className="text-xs font-bold text-[#657961]">
              {direct.some((t) => t.id === item.id)
                ? label(item)
                : '연결 업무의 연결'}
            </span>
            <strong className="mt-1 block text-sm">{item.title}</strong>
            <span className="text-xs">
              {status[item.status]} · {item.endDate ?? item.date} ·{' '}
              {data.members.find((m) => m.id === item.assigneeId)?.name ??
                '미배정'}
            </span>
          </button>
        ))}
      </div>
      {!direct.length && (
        <p className="text-sm text-[#64776a]">
          직접 연결된 업무가 없습니다. 위의 연결 업무에서 추가할 수 있습니다.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {!!direct.length && (
          <Button variant="outline" onClick={() => setExpanded(!expanded)}>
            {expanded ? '직접 연결만 보기' : '한 단계 더 보기'}
          </Button>
        )}
        {canRead && (
          <Button
            variant="outline"
            onClick={() => setShowRecords(!showRecords)}
          >
            {showRecords ? '기록 접기' : '보고·변경 기록 보기'}
          </Button>
        )}
      </div>
      {showRecords && canRead && (
        <RecordBrowser
          accessToken={accessToken}
          taskId={task.id}
          openTask={openTask}
        />
      )}
    </section>
  );
}
