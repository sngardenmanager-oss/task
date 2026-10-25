import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
const source = await fs.readFile(
  new URL('../../lib/reports.ts', import.meta.url),
  'utf8',
);
const coreUrl =
  'data:text/javascript;base64,' +
  Buffer.from(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
  ).toString('base64');
const core = await import(coreUrl);

test('관리자 보고서는 기본으로 전체 팀원 업무를 불러온다', () => {
  const admin = { id: 'boss', name: '관리자', email: 'boss@x', role: 'admin', team: '전체', active: true };
  const member = { id: 'mate', name: '팀원', email: 'mate@x', role: 'member', team: '파크사업팀', active: true };
  const task = (id, assigneeId) => ({
    id, title: id, description: '', categoryId: 'c', type: 'task', assigneeId, collaborators: [],
    date: '2026-10-20', status: 'in_progress', checklist: [],
  });
  const data = {
    members: [admin, member], categories: [], notes: [],
    tasks: [task('own', 'boss'), task('mate-work', 'mate')],
  };
  const adminConfig = core.defaultReportConfig(admin, '2026-10-26');
  assert.equal(adminConfig.scope, 'team');
  assert.equal(core.scopeLabel(adminConfig), '전체 팀원');
  assert.deepEqual(
    core.newReport(data, admin, adminConfig, core.emptyReportStore()).rows.map((r) => r.taskId).sort(),
    ['mate-work', 'own'],
  );
  // 팀원은 그대로 본인 담당·협업 업무로 시작한다.
  const memberConfig = core.defaultReportConfig(member, '2026-10-26');
  assert.equal(memberConfig.scope, 'mine');
  assert.deepEqual(
    core.newReport(data, member, memberConfig, core.emptyReportStore()).rows.map((r) => r.taskId),
    ['mate-work'],
  );
});

test('보고 범위를 바꿔도 새 범위에 드는 행은 써 둔 내용을 유지한다', () => {
  const admin = { id: 'boss', name: '관리자', email: 'boss@x', role: 'admin', team: '전체', active: true };
  const member = { id: 'mate', name: '팀원', email: 'mate@x', role: 'member', team: '파크사업팀', active: true };
  const task = (id, assigneeId) => ({
    id, title: id, description: '', categoryId: 'c', type: 'task', assigneeId, collaborators: [],
    date: '2026-10-20', status: 'in_progress', checklist: [],
  });
  const data = {
    members: [admin, member], categories: [],
    notes: [{ id: 'n-mate', createdBy: 'mate' }],
    tasks: [task('own', 'boss'), task('mate-work', 'mate')],
  };
  const mine = { ...core.defaultReportConfig(admin, '2026-10-26'), scope: 'mine' };
  const draft = core.newReport(data, admin, mine, core.emptyReportStore());
  draft.rows[0].summary = '관리자가 써 둔 진행 내용';
  const manual = { ...core.manualRow('after'), title: '직접 추가' };
  const team = { ...mine, scope: 'team', team: core.ALL_MEMBERS_TEAM };
  const kept = core.rowsKeptOnScopeChange([...draft.rows, manual], data, admin, team);
  const rows = core.collectReportRows(data, admin, team, [], kept);
  assert.deepEqual(rows.filter((r) => r.taskId).map((r) => r.taskId).sort(), ['mate-work', 'own']);
  assert.equal(rows.find((r) => r.taskId === 'own').summary, '관리자가 써 둔 진행 내용');
  assert.ok(rows.some((r) => r.title === '직접 추가'));
  // 범위를 좁히면 새 범위 밖의 업무·특이사항 행은 빠진다.
  const back = core.rowsKeptOnScopeChange(
    [...rows, { ...core.manualRow('before'), id: 'note:n-mate', noteId: 'n-mate' }],
    data, admin, mine,
  );
  assert.deepEqual(back.filter((r) => r.taskId).map((r) => r.taskId), ['own']);
  assert.ok(!back.some((r) => r.noteId === 'n-mate'));
});
