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

test('다른 범위에서 완결한 항목은 범위를 바꿔도 다시 들어오지 않고, 재개하면 돌아온다', () => {
  const admin = { id: 'boss', name: '관리자', email: 'boss@x', role: 'admin', team: '전체', active: true };
  const member = { id: 'mate', name: '팀원', email: 'mate@x', role: 'member', team: '파크사업팀', active: true };
  const task = (id, assigneeId) => ({
    id, title: id, description: '', categoryId: 'c', type: 'task', assigneeId, collaborators: [],
    date: '2026-10-01', status: 'completed', checklist: [],
  });
  const data = {
    members: [admin, member], categories: [], notes: [],
    tasks: [task('own-done', 'boss'), task('mate-done', 'mate'), task('own-open', 'boss')],
  };
  const mine = { ...core.defaultReportConfig(admin, '2026-10-19'), scope: 'mine' };
  const team = { ...mine, scope: 'team', team: core.ALL_MEMBERS_TEAM };
  // 예전 '내 업무' 보고서에서 own-done을, 팀원 본인 보고서에서 mate-done을 완결했다.
  const closed = (id, scope, at) => ({
    id: 'task:' + id, scopeKey: scope,
    row: { ...core.manualRow('before'), id: 'task:' + id, taskId: id, title: id, closed: true },
    closed: true, history: [{ at, actor: 'x', closed: true, note: '끝' }],
  });
  let tracks = [closed('own-done', 'mine:boss', '2026-10-10T00:00:00Z'), closed('mate-done', 'mine:mate', '2026-10-11T00:00:00Z')];
  const ids = (rows) => rows.filter((r) => r.taskId).map((r) => r.taskId).sort();
  assert.deepEqual(ids(core.collectReportRows(data, admin, team, tracks)), ['own-open']);
  // 범위를 바꾼 뒤 이미 저장해 버린 초안(완결 항목이 다시 들어간 상태)도 '최신 업무 불러오기'로 정리된다.
  const polluted = core.collectReportRows(data, admin, team, []);
  assert.deepEqual(ids(polluted), ['mate-done', 'own-done', 'own-open']);
  const saved = core.saveReport({ ...core.emptyReportStore(), tracks }, { ...core.newReport(data, admin, team, core.emptyReportStore()), rows: polluted }, admin);
  assert.deepEqual(ids(core.collectReportRows(data, admin, team, saved.tracks, polluted)), ['own-open']);
  // 완결 아카이브에는 다른 범위에서 완결한 항목도 보여서 재개할 수 있다.
  const archive = core.closedTracksInScope(saved.tracks, data, admin, team, admin.id);
  assert.deepEqual(archive.map((t) => t.row.taskId).sort(), ['mate-done', 'own-done']);
  // 재개(reopenedAt이 완결보다 뒤)하면 다시 보고에 들어오고, 저장 후 다음 회차에도 이어진다.
  const reopened = [...polluted.filter((r) => r.taskId === 'own-open'), { ...archive.find((t) => t.row.taskId === 'own-done').row, closed: false, reopenedAt: '2026-10-20T00:00:00Z' }];
  assert.deepEqual(ids(core.collectReportRows(data, admin, team, saved.tracks, reopened)), ['own-done', 'own-open']);
  const next = core.saveReport(saved, { ...core.newReport(data, admin, team, saved), rows: reopened }, admin);
  assert.deepEqual(ids(core.collectReportRows(data, admin, team, next.tracks)), ['own-done', 'own-open']);
  // 이번 회차에 완결로 체크한 행은 이번 보고서에는 '이번 회차 완결'로 남는다.
  const thisRound = reopened.map((r) => (r.taskId === 'own-open' ? { ...r, closed: true } : r));
  assert.deepEqual(ids(core.collectReportRows(data, admin, team, next.tracks, thisRound)), ['own-done', 'own-open']);
});

test('아카이브한 행(완결+표출 해제)은 이번 보고서에서 빠지고 다음 회차에도 들어오지 않으며, 업무 자체는 그대로다', () => {
  const admin = { id: 'boss', name: '관리자', email: 'boss@x', role: 'admin', team: '전체', active: true };
  const task = (id, status) => ({
    id, title: id, description: '', categoryId: 'c', type: 'task', assigneeId: 'boss', collaborators: [],
    date: '2026-10-01', status, checklist: [],
  });
  const data = { members: [admin], categories: [], notes: [], tasks: [task('done', 'completed'), task('ongoing', 'in_progress')] };
  const before = structuredClone(data);
  const team = { ...core.defaultReportConfig(admin, '2026-10-26'), scope: 'team', team: core.ALL_MEMBERS_TEAM };
  const report = core.newReport(data, admin, team, core.emptyReportStore());
  const archived = report.rows.map((r) => ({ ...r, closed: true, visible: false, closeNote: '보고서에서 정리(아카이브)' }));
  const store = core.saveReport(core.emptyReportStore(), { ...report, rows: archived }, admin);
  assert.equal(archived.filter((r) => r.visible).length, 0);
  // 다음 회차: 진행 중인 업무도 아카이브했으면 다시 들어오지 않는다.
  const next = core.newReport(data, admin, { ...team, meetingDate: '2026-11-02' }, store);
  assert.deepEqual(next.rows.filter((r) => r.taskId), []);
  // 되돌리기(재개)하면 다시 들어온다.
  const restored = archived.map((r) => (r.taskId === 'ongoing' ? { ...r, closed: false, visible: true, reopenedAt: '2026-10-27T00:00:00Z' } : r));
  const store2 = core.saveReport(store, { ...report, rows: restored }, admin);
  assert.deepEqual(core.newReport(data, admin, { ...team, meetingDate: '2026-11-02' }, store2).rows.map((r) => r.taskId), ['ongoing']);
  // 캘린더 업무 데이터는 바뀌지 않는다.
  assert.deepEqual(data, before);
});
