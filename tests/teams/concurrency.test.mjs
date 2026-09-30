import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';

const transpile = (source) =>
  'data:text/javascript;base64,' +
  Buffer.from(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText,
  ).toString('base64');
const read = (file) => fs.readFile(new URL(`../../lib/${file}`, import.meta.url), 'utf8');

// 가짜 DB: workspace_state 한 행. update는 eq 조건(team_id, updated_at)이 맞을 때만 반영됩니다(실제 DB와 같은 버전 확인).
const db = { row: null, writes: 0 };
globalThis.__fakeDb = db;
const fakeSupabase = `
const db = globalThis.__fakeDb;
export const isSupabaseConfigured = () => true;
export const getSupabaseAdmin = () => ({
  from: () => {
    const filters = {};
    let patch = null;
    const query = {
      select: () => query,
      eq: (key, value) => { filters[key] = value; return query; },
      update: (value) => { patch = value; return query; },
      maybeSingle: async () => {
        await new Promise((r) => setTimeout(r, 5));
        return { data: structuredClone(db.row), error: null };
      },
      then: (resolve) => {
        setTimeout(() => {
          const ok = patch && db.row.team_id === filters.team_id &&
            (filters.updated_at === undefined || db.row.updated_at === filters.updated_at);
          if (ok) { db.row = { ...db.row, ...structuredClone(patch) }; db.writes += 1; }
          resolve({ data: ok ? [{ team_id: db.row.team_id }] : [], error: null });
        }, 5);
      },
    };
    return query;
  },
});`;
const store = await import(
  transpile(
    (await read('workspace-store.ts'))
      .replace("from '@/lib/seed'", `from ${JSON.stringify(transpile('export const seedState = {};'))}`)
      .replace("from '@/lib/supabase-server'", `from ${JSON.stringify(transpile(fakeSupabase))}`)
      .replace("from '@/lib/team-access'", `from ${JSON.stringify(transpile("export const LEGACY_TEAM_ID = 'park';"))}`),
  )
);
const merge = await import(transpile(await read('workspace-merge.ts')));

const task = (id, title, extra = {}) => ({
  id, title, description: '', date: '2026-09-30', categoryId: 'c', assigneeId: 'm',
  collaborators: [], priority: 'normal', status: 'scheduled', type: 'task',
  checklist: [], comments: [], createdBy: 'm', createdAt: '', ...extra,
});
const reset = (tasks) => {
  db.row = {
    team_id: 'park',
    updated_at: '2026-09-30T00:00:00.000Z',
    payload: { members: [], categories: [], tasks, routines: [], notes: [], projectTemplates: [], deletedIds: [] },
  };
  db.writes = 0;
};
const save = (incomingTasks, role = 'member', deleted = []) =>
  store.updateWorkspaceState('park', (before) => {
    const merged = merge.mergeIncomingState(
      before,
      { members: [], categories: [], tasks: incomingTasks, routines: [], notes: [], projectTemplates: [] },
      new Set(deleted),
      role,
    );
    const problem = merge.updateProblem(before, merged, { role });
    if (problem) throw new Error(problem);
    return merged;
  });

await test('동시에 서로 다른 업무를 저장해도 둘 다 남는다', async () => {
  reset([task('a', 'A'), task('b', 'B')]);
  await Promise.all([save([task('a', 'A 수정')]), save([task('b', 'B 수정')])]);
  const titles = db.row.payload.tasks.map((t) => t.title);
  assert.deepEqual(titles, ['A 수정', 'B 수정']);
  assert.equal(db.writes, 2);
});

await test('다섯 명이 동시에 저장해도 모두 반영된다', async () => {
  reset(['a', 'b', 'c', 'd', 'e'].map((id) => task(id, id)));
  await Promise.all(['a', 'b', 'c', 'd', 'e'].map((id) => save([task(id, `${id} 수정`)])));
  assert.deepEqual(
    db.row.payload.tasks.map((t) => t.title),
    ['a 수정', 'b 수정', 'c 수정', 'd 수정', 'e 수정'],
  );
});

await test('댓글 전용 사용자가 두 번째 업무에 댓글을 달 수 있다(순서 유지)', async () => {
  reset([task('a', 'A'), task('b', 'B')]);
  const comment = { id: 'c1', authorId: 'v', body: '확인했습니다', createdAt: '2026-09-30T01:00:00Z' };
  await save([task('b', 'B', { comments: [comment] })], 'commenter');
  assert.deepEqual(db.row.payload.tasks.map((t) => t.id), ['a', 'b']);
  assert.equal(db.row.payload.tasks[1].comments[0].body, '확인했습니다');
});

await test('댓글 전용 사용자의 화면이 예전 값이어도 댓글만 반영되고 다른 내용은 그대로', async () => {
  reset([task('a', 'A (다른 사람이 수정)')]);
  const comment = { id: 'c1', authorId: 'v', body: '의견', createdAt: '2026-09-30T01:00:00Z' };
  await save([task('a', 'A 예전 제목', { comments: [comment] })], 'commenter');
  assert.equal(db.row.payload.tasks[0].title, 'A (다른 사람이 수정)');
  assert.equal(db.row.payload.tasks[0].comments.length, 1);
});

await test('같은 업무에 두 사람이 동시에 댓글을 달아도 둘 다 남고, 관리자가 지운 댓글은 사라진다', async () => {
  reset([task('a', 'A')]);
  const c = (id, at) => ({ id, authorId: 'x', body: id, createdAt: at });
  await Promise.all([
    save([task('a', 'A', { comments: [c('c1', '2026-09-30T01:00:00Z')] })]),
    save([task('a', 'A', { comments: [c('c2', '2026-09-30T01:00:01Z')] })]),
  ]);
  assert.deepEqual(db.row.payload.tasks[0].comments.map((x) => x.id), ['c1', 'c2']);
  await save([task('a', 'A', { comments: [c('c2', '2026-09-30T01:00:01Z')] })], 'admin', ['c1']);
  assert.deepEqual(db.row.payload.tasks[0].comments.map((x) => x.id), ['c2']);
});

await test('권한 오류는 다시 시도하지 않고 그대로 알린다', async () => {
  reset([task('a', 'A')]);
  await assert.rejects(save([task('a', 'A', { status: 'completed' })]), /최종 완료는 관리자만/);
  assert.equal(db.writes, 0);
});
