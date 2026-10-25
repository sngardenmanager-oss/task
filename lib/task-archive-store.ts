import { getSupabaseAdmin } from '@/lib/supabase-server';
import { taskCompletedAt } from '@/lib/retention';
import type { Task } from '@/lib/types';

/** 보관함 목록 한 줄. 본문(payload)에는 업무 전체(체크리스트·댓글 포함)가 들어 있습니다. */
export type ArchivedTask = {
  task_id: string;
  completed_at: string | null;
  archived_at: string;
  payload: Task;
};

/** 업무를 보관함에 넣고, 실제로 보관함에 들어 있는 업무 id를 돌려줍니다.
 * 이미 들어 있는 업무는 그대로 둡니다(보관함은 추가만 합니다). */
export async function archiveTasks(teamId: string, tasks: Task[]) {
  const stored = new Set<string>();
  const db = getSupabaseAdmin();
  for (let index = 0; index < tasks.length; index += 50) {
    const chunk = tasks.slice(index, index + 50);
    const { error } = await db.from('task_archive').upsert(
      chunk.map((task) => ({
        team_id: teamId,
        task_id: task.id,
        payload: task,
        completed_at: taskCompletedAt(task),
        search_text: `${task.title}\n${task.description}`,
      })),
      { onConflict: 'team_id,task_id', ignoreDuplicates: true },
    );
    if (error) throw new Error(`Supabase task archive failed: ${error.message}`);
    const { data, error: readError } = await db
      .from('task_archive')
      .select('task_id')
      .eq('team_id', teamId)
      .in('task_id', chunk.map((task) => task.id));
    if (readError) throw new Error(`Supabase task archive read failed: ${readError.message}`);
    for (const row of data as { task_id: string }[]) stored.add(row.task_id);
  }
  return stored;
}
