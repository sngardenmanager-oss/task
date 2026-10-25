import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';

const load = async (file, replacements = {}) => {
  let source = await fs.readFile(new URL(`../../lib/${file}`, import.meta.url), 'utf8');
  for (const [from, to] of Object.entries(replacements))
    source = source.replace(`from '${from}'`, `from ${JSON.stringify(to)}`);
  const url =
    'data:text/javascript;base64,' +
    Buffer.from(
      ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText,
    ).toString('base64');
  return { url, module: await import(url) };
};
const retention = (await load('retention.ts')).module;
const merge = (await load('workspace-merge.ts')).module;

const now = new Date('2027-05-10T00:00:00Z');
const task = (id, extra = {}) => ({
  id, title: id, description: '', date: '2026-10-01', categoryId: 'c', assigneeId: 'm',
  collaborators: [], priority: 'normal', status: 'completed', type: 'task', checklist: [],
  comments: [], completedAt: '2026-10-02T01:00:00.000Z', createdBy: 'm', createdAt: '2026-09-01T00:00:00Z',
  ...extra,
});
const state = (tasks) => ({ members: [], categories: [], tasks, routines: [], notes: [], deletedIds: [] });
const ids = (tasks, started = now.toISOString()) =>
  retention.archivableTaskIds(state(tasks), now, started).sort();

test('완료 6개월 지난 업무만, 이번 백업에 들어간 것만 보관 대상', () => {
  assert.deepEqual(
    ids([
      task('old'),
      task('recent', { completedAt: '2027-04-01T00:00:00Z' }),
      task('open', { status: 'in_progress', completedAt: undefined }),
      task('requested', { status: 'completion_requested', completedAt: undefined }),
    ]),
    ['old'],
  );
  // 백업을 시작한 뒤에 완료된 업무는 백업 파일에 없으므로 옮기지 않는다.
  assert.deepEqual(ids([task('old')], '2026-10-01T00:00:00Z'), []);
  // 완료 시각 기록이 없는 예전 업무는 상태 이력, 그것도 없으면 업무 날짜로 판단한다.
  assert.deepEqual(
    ids([
      task('history', { completedAt: undefined, statusHistory: [{ at: '2026-10-03T00:00:00Z', actorId: 'm', from: 'in_progress', to: 'completed' }] }),
      task('dated', { completedAt: undefined, date: '2026-09-15' }),
      task('dated-recent', { completedAt: undefined, date: '2027-04-20' }),
    ]),
    ['dated', 'history'],
  );
});

test('메인·하위 일정과 연결 업무는 함께 옮길 수 있을 때만 보관', () => {
  // 진행 중인 메인 일정의 완료된 하위 일정은 남긴다.
  assert.deepEqual(ids([task('main', { status: 'in_progress', completedAt: undefined }), task('child', { parentId: 'main' })]), []);
  // 메인과 하위가 모두 오래 전에 끝났으면 함께 옮긴다.
  assert.deepEqual(ids([task('main'), task('child', { parentId: 'main' })]), ['child', 'main']);
  // 남아 있는 업무가 선행 업무로 걸어 둔 완료 업무는 남긴다(연결 방향과 관계없이).
  const link = (taskId, extra = {}) => ({ id: 'l-' + taskId, taskId, kind: 'prerequisite', createdBy: 'm', createdAt: '2026-09-01T00:00:00Z', ...extra });
  assert.deepEqual(ids([task('done'), task('next', { status: 'scheduled', completedAt: undefined, links: [link('done')] })]), []);
  assert.deepEqual(ids([task('done', { links: [link('next')] }), task('next', { status: 'scheduled', completedAt: undefined })]), []);
  // 해제한 연결이나 이미 없는 업무로의 연결은 막지 않는다.
  assert.deepEqual(ids([task('done'), task('next', { status: 'scheduled', completedAt: undefined, links: [link('done', { removedAt: '2026-11-01T00:00:00Z' })] })]), ['done']);
  assert.deepEqual(ids([task('done', { links: [link('gone')] })]), ['done']);
});

test('보관한 업무는 오래 열어 둔 화면이 저장해도 되살아나지 않는다', () => {
  const before = state([task('old'), task('keep', { status: 'scheduled', completedAt: undefined })]);
  const archived = retention.removeArchivedTasks(before, ['old']);
  assert.deepEqual(archived.tasks.map((t) => t.id), ['keep']);
  assert.ok(archived.deletedIds.includes('old'));
  const stale = { ...before, tasks: [{ ...before.tasks[0], title: '예전 화면에서 고침' }] };
  const merged = merge.mergeIncomingState(archived, stale, new Set(), 'admin');
  assert.deepEqual(merged.tasks.map((t) => t.id), ['keep']);
});
