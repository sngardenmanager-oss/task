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
const read = (path) => fs.readFile(new URL(path, import.meta.url), 'utf8');
const coreUrl = transpile(await read('../../lib/reports.ts'));
const core = await import(coreUrl);
const workflow = await import(
  transpile((await read('../../lib/report-workflow.ts')).replace("from './reports'", 'from ' + JSON.stringify(coreUrl)))
);
const corrections = await import(transpile(await read('../../lib/report-corrections.ts')));
const retention = await import(transpile(await read('../../lib/retention.ts')));

const author = { id: 'author', name: 'Author', role: 'member', active: true, team: 'Team', email: 'a@test' };
const admin = { ...author, id: 'admin', name: 'Admin', role: 'admin' };
const row = (over) => ({
  id: 'r1', section: 'before', category: '운영', title: 'Row', summary: '', nextAction: '', assignee: '',
  date: '2026-09-20', status: '진행 중', visible: true, closed: false, closeNote: '', followup: '',
  delayReason: '', checklist: [], ...over,
});
const doc = (over) => ({
  id: 'd', ownerId: 'author', config: { ...core.defaultReportConfig(author, '2026-10-12'), scope: 'team', team: 'Team' },
  rows: [], agendas: [], news: [], status: 'draft', revision: 1, createdAt: '', updatedAt: '', metrics: [],
  statistics: [], comparisonStart: '', comparisonEnd: '', templateVersion: 1, ...over,
});

await test('completion is suggested only after a final report showed the row as complete', () => {
  const draft = doc({
    rows: [
      row({ id: 'task:a', taskId: 'a', status: '최종 완료' }),
      row({ id: 'task:b', taskId: 'b', status: '최종 완료' }),
      row({ id: 'task:c', taskId: 'c', status: '진행 중' }),
      row({ id: 'task:d', taskId: 'd', status: '최종 완료', closed: true }),
    ],
  });
  const reported = doc({
    id: 'f1', status: 'final', config: { ...draft.config, meetingDate: '2026-10-05' },
    rows: [
      // a: reported complete → suggest. b: reported while still in progress → keep. c/d: not complete or already closed.
      row({ id: 'task:a', taskId: 'a', status: '최종 완료' }),
      row({ id: 'task:b', taskId: 'b', status: '진행 중' }),
      row({ id: 'task:c', taskId: 'c', status: '최종 완료' }),
      row({ id: 'task:d', taskId: 'd', status: '최종 완료' }),
    ],
  });
  const result = core.completionSuggestions(draft, [draft, reported]);
  assert.deepEqual(result.map((item) => item.row.id), ['task:a']);
  assert.equal(core.suggestedCloseNote(result[0].reportedIn), '완료 보고됨 (2026-10-05 확정본)');
});

await test('a sub-task finished before its project is suggested on its own', () => {
  const draft = doc({
    rows: [
      row({ id: 'task:parent', taskId: 'parent', status: '진행 중' }),
      row({ id: 'task:child', taskId: 'child', section: 'after', date: '2026-10-20', status: '최종 완료' }),
    ],
  });
  const final = doc({ id: 'f', status: 'final', rows: [row({ id: 'other-id', taskId: 'child', status: '최종 완료' })] });
  assert.deepEqual(core.completionSuggestions(draft, [final]).map((item) => item.row.id), ['task:child']);
});

await test('project delay follows the calendar rule (only scheduled children are overdue)', () => {
  const report = doc({ rows: [row({ id: 'r', taskId: 'p' })] });
  const tasks = [
    { id: 'p', title: 'P', date: '2026-10-20', createdAt: '2026-09-01' },
    { id: 's', parentId: 'p', status: 'scheduled', date: '2026-10-01' },
    { id: 'i', parentId: 'p', status: 'in_progress', date: '2026-10-01' },
    { id: 'q', parentId: 'p', status: 'completion_requested', date: '2026-10-01' },
    { id: 'f', parentId: 'p', status: 'scheduled', date: '2026-10-30' },
  ];
  const [project] = workflow.projectSnapshots(report, { members: [], tasks });
  assert.equal(project.overdue, 1);
  assert.equal(project.overrun, 1);
  assert.equal(project.requested, 1);
});

await test('projects sort by attention, then newest first when nothing needs attention', () => {
  const base = { total: 2, completed: 0, requested: 0, overdue: 0, tasks: [] };
  const list = [
    { ...base, id: 'old', date: '2026-12-01', createdAt: '2026-01-01' },
    { ...base, id: 'done', date: '2026-12-01', createdAt: '2026-09-30', completed: 2 },
    { ...base, id: 'new', date: '2026-12-01', createdAt: '2026-09-01' },
    { ...base, id: 'late', date: '2026-12-01', createdAt: '2025-01-01', overdue: 1 },
    { ...base, id: 'soon', date: '2026-10-15', createdAt: '2025-01-01' },
    { ...base, id: 'wait', date: '2026-12-01', createdAt: '2025-01-01', requested: 1 },
  ];
  assert.deepEqual(
    workflow.sortProjects(list, '2026-10-12').map((item) => item.project.id),
    ['late', 'soon', 'wait', 'new', 'old', 'done'],
  );
});

await test('correction proposals leave the final report untouched and need an admin to resolve', () => {
  const final = doc({ id: 'f', status: 'final' });
  const store = { ...core.emptyReportStore(), reports: [final, doc({ id: 'draft' })] };
  const input = { kind: 'correction', requestId: 'proposal-0001', reportId: 'f', note: '입장객 단위 오류' };
  assert.throws(() => corrections.applyCorrectionInput(store, { ...input, reportId: 'draft' }, author), /확정본/);
  assert.throws(() => corrections.applyCorrectionInput(store, { ...input, note: ' ' }, author), /입력/);
  const proposed = corrections.applyCorrectionInput(store, input, author, '2026-10-12T00:00:00Z');
  assert.equal(corrections.applyCorrectionInput(proposed, input, author), proposed);
  assert.deepEqual(proposed.reports, store.reports);
  assert.equal(corrections.openCorrections(proposed, 'f').length, 1);
  const resolve = { kind: 'correction-resolve', requestId: 'resolve-0001', proposalId: 'proposal-0001', decision: 'dismissed' };
  assert.throws(() => corrections.applyCorrectionInput(proposed, resolve, author), /관리자/);
  assert.throws(() => corrections.applyCorrectionInput(proposed, resolve, admin), /반려 사유/);
  const applied = corrections.applyCorrectionInput(proposed, { ...resolve, decision: 'applied' }, admin);
  assert.equal(applied.corrections[0].status, 'applied');
  assert.equal(corrections.openCorrections(applied).length, 0);
  assert.throws(() => corrections.applyCorrectionInput(applied, { ...resolve, note: 'x' }, admin), /이미 처리/);
});

await test('monthly cleanup removes only old final reports and keeps drafts, tracks and corrections', () => {
  const now = new Date('2026-12-02T00:00:00Z');
  const store = {
    ...core.emptyReportStore(),
    reports: [
      doc({ id: 'old-final', status: 'final', finalizedAt: '2026-10-01T00:00:00Z' }),
      doc({ id: 'recent-final', status: 'final', finalizedAt: '2026-11-25T00:00:00Z' }),
      doc({ id: 'old-draft', updatedAt: '2026-01-01T00:00:00Z' }),
    ],
    tracks: [{ id: 'r1', scopeKey: 'team:Team', row: row({ closed: true }), closed: true, history: [] }],
    corrections: [{ id: 'c', reportId: 'old-final', status: 'open' }],
  };
  const ids = retention.prunableReportIds(store, now, now.toISOString());
  assert.deepEqual(ids, ['old-final']);
  const after = retention.removeReports(store, ids);
  assert.deepEqual(after.reports.map((r) => r.id), ['recent-final', 'old-draft']);
  assert.deepEqual(after.tracks, store.tracks);
  assert.deepEqual(after.corrections, store.corrections);
});
