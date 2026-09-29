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
const sync = (await load('workspace-sync.ts')).module;
const retention = (await load('retention.ts')).module;
const reports = await load('reports.ts');
const share = (await load('report-share.ts', { './reports': reports.url })).module;

const task = (id, title, extra = {}) => ({
  id, title, description: '', date: '2026-09-29', categoryId: 'c', assigneeId: 'm',
  collaborators: [], priority: 'normal', status: 'scheduled', type: 'task',
  checklist: [], comments: [], createdBy: 'm', createdAt: '', ...extra,
});
const state = (tasks) => ({
  members: [], categories: [], tasks, routines: [], notes: [], projectTemplates: [], deletedIds: [],
});
// 서버 /api/state의 병합 규칙과 같은 방식: 받은 항목이 이기고, 받지 않은 항목은 서버 값을 유지.
const serverMerge = (before, incoming) => {
  const ids = new Set(incoming.map((i) => i.id));
  return [...incoming, ...before.filter((i) => !ids.has(i.id))];
};

await test('오래 열어 둔 화면이 다른 사람의 수정을 되돌리지 않는다', () => {
  const base = state([task('x', '원래 X'), task('y', '원래 Y')]);
  // 그 사이 다른 사람이 서버에서 X를 완료 요청으로 바꿈
  const server = state([task('x', '원래 X', { status: 'completion_requested' }), task('y', '원래 Y')]);
  // 이 화면(예전 기준)에서는 Y만 고침
  const mine = state([task('x', '원래 X'), task('y', 'Y 수정')]);
  const delta = sync.diffWorkspace(base, mine);
  assert.deepEqual(delta.tasks.map((t) => t.id), ['y']);
  const merged = serverMerge(server.tasks, delta.tasks);
  assert.equal(merged.find((t) => t.id === 'x').status, 'completion_requested');
  assert.equal(merged.find((t) => t.id === 'y').title, 'Y 수정');
});

await test('바뀐 것이 없으면 빈 변경분, 새 항목·삭제도 반영', () => {
  const base = state([task('a', 'A')]);
  assert.equal(sync.isEmptyDelta(sync.diffWorkspace(base, structuredClone(base))), true);
  const next = state([task('a', 'A'), task('b', '새 업무')]);
  const delta = sync.diffWorkspace(base, next);
  assert.deepEqual(delta.tasks.map((t) => t.id), ['b']);
  const server = state([task('a', 'A (다른 사람 수정)'), task('c', 'C')]);
  const applied = sync.applyDelta(server, delta, ['c']);
  assert.deepEqual(applied.tasks.map((t) => [t.id, t.title]), [
    ['a', 'A (다른 사람 수정)'],
    ['b', '새 업무'],
  ]);
});

await test('CSV 되돌리기 기록은 최근 1건만 남기고 이름표만 둔다', () => {
  const entry = (id, at) => ({ id, filename: 'f.csv', at, actor: 'a', before: [null], after: [{ date: '2026-09-01' }] });
  const store = {
    reports: [], tracks: [], statistics: [], archiveLinks: {},
    imports: [entry('old', '2026-09-01T00:00:00Z'), entry('new', '2026-09-20T00:00:00Z')],
    jejuImports: [entry('j1', '2026-09-02T00:00:00Z')],
  };
  const pruned = retention.pruneImportHistory(store);
  assert.deepEqual(pruned.imports.find((e) => e.id === 'old'), {
    ...entry('old', '2026-09-01T00:00:00Z'), before: [], after: [], pruned: true,
  });
  assert.equal(pruned.imports.find((e) => e.id === 'new').after.length, 1);
  assert.equal(pruned.jejuImports[0].pruned, undefined);
});

await test('정리된 기록은 오래된 화면이 보내도 다시 적용되지 않는다', () => {
  const stale = { id: 'old', filename: 'f', at: '2026-09-01T00:00:00Z', actor: 'a', before: [null], after: [{ date: '2026-09-01', revenue: 1 }] };
  const server = {
    reports: [], tracks: [], archiveLinks: {},
    statistics: [{ date: '2026-09-01', revenue: 999 }],
    imports: [{ ...stale, before: [], after: [], pruned: true }],
  };
  const incoming = { ...server, statistics: [], imports: [stale, { ...stale, undoneAt: '2026-09-02T00:00:00Z' }].slice(0, 1) };
  const merged = share.mergeSharedStore(server, incoming, {}, { id: 'm', name: 'm' });
  assert.equal(merged.statistics[0].revenue, 999);
  const undo = share.mergeSharedStore(server, { ...incoming, imports: [{ ...stale, undoneAt: '2026-09-02T00:00:00Z' }] }, {}, { id: 'm', name: 'm' });
  assert.equal(undo.statistics[0].revenue, 999);
});

await test('주간보고서 정리: 확정 1개월 지나고 백업에 들어간 것만, 초안은 제외', () => {
  const now = new Date('2026-11-02T01:00:00Z');
  const doc = (id, status, finalizedAt) => ({ id, status, finalizedAt, updatedAt: finalizedAt ?? '2026-09-01T00:00:00Z', config: {} });
  const store = {
    reports: [
      doc('old-final', 'final', '2026-09-20T00:00:00Z'),
      doc('recent-final', 'final', '2026-10-20T00:00:00Z'),
      doc('old-draft', 'draft'),
    ],
  };
  assert.deepEqual(retention.prunableReportIds(store, now, now.toISOString()), ['old-final']);
  // 백업 시작 전에 확정된 것만(백업에 포함된 것만)
  assert.deepEqual(retention.prunableReportIds(store, now, '2026-09-10T00:00:00Z'), []);
  const removed = retention.removeReports(store, ['old-final']);
  assert.deepEqual(removed.reports.map((r) => r.id), ['recent-final', 'old-draft']);
  assert.deepEqual(removed.deletedReportIds, ['old-final']);
});

await test('정리된 보고서는 오래된 화면이 보내도 다시 살아나지 않는다', () => {
  const server = { reports: [], tracks: [], statistics: [], imports: [], archiveLinks: {}, deletedReportIds: ['gone'] };
  const incoming = { ...server, reports: [{ id: 'gone', ownerId: 'm', status: 'final', config: { scope: 'team' } }] };
  const merged = share.mergeSharedStore(server, incoming, {}, { id: 'm', name: 'm' });
  assert.equal(merged.reports.length, 0);
});

await test('매월 백업 알림은 한국 시간 1~3일, 이번 달 백업 전까지만', () => {
  const kst = (s) => new Date(`${s}+09:00`);
  assert.equal(retention.isBackupDue(kst('2026-10-01T09:00:00'), null), true);
  assert.equal(retention.isBackupDue(kst('2026-10-03T23:00:00'), '2026-09-01T00:00:00Z'), true);
  assert.equal(retention.isBackupDue(kst('2026-10-04T00:30:00'), null), false);
  assert.equal(retention.isBackupDue(kst('2026-10-02T09:00:00'), kst('2026-10-01T10:00:00').toISOString()), false);
  // 9/30 23시(한국) 백업은 10월 백업이 아님
  assert.equal(retention.isBackupDue(kst('2026-10-01T09:00:00'), kst('2026-09-30T23:00:00').toISOString()), true);
});
