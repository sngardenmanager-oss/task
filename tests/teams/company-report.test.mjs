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
const reports = await load('reports.ts');
const combined = (await load('combined-report.ts', { './reports': reports.url })).module;
const company = (await load('company-events.ts')).module;

await test('전사 일정: 대상 팀 필터와 입력 검사', () => {
  const events = [
    { id: 'a', teamIds: [] },
    { id: 'b', teamIds: ['park'] },
    { id: 'c', teamIds: ['team-a'] },
  ];
  assert.deepEqual(company.eventsForTeam(events, 'park').map((e) => e.id), ['a', 'b']);
  assert.match(company.normalizeCompanyEvent({ title: '', date: '2026-10-01' }), /이름/);
  assert.match(company.normalizeCompanyEvent({ title: '행사', date: '2026-10-05', endDate: '2026-10-01' }), /종료일/);
  const ok = company.normalizeCompanyEvent({
    title: ' 할로윈 ',
    date: '2026-10-24',
    endDate: '2026-10-24',
    endTime: '18:00',
    teamIds: ['park', 'park'],
  });
  assert.equal(ok.title, '할로윈');
  assert.equal(ok.endDate, undefined);
  assert.equal(ok.endTime, undefined);
  assert.deepEqual(ok.teamIds, ['park']);
  const task = company.companyEventAsTask({ ...ok, id: 'x' });
  assert.equal(task.id, 'company:x');
  assert.equal(task.categoryId, company.COMPANY_CATEGORY_ID);
});

await test('통합 보고서: 회의 주 계산', () => {
  assert.deepEqual(combined.combinedWeek('2026-09-30'), {
    meetingDate: '2026-09-30',
    actualStart: '2026-09-21',
    actualEnd: '2026-09-27',
    planStart: '2026-09-28',
    planEnd: '2026-10-04',
  });
  assert.equal(combined.combinedWeek('2026-10-04').planStart, '2026-09-28');
});

await test('통합 보고서: 확정본 우선, 없으면 최근 초안, 다른 주는 제외', () => {
  const week = combined.combinedWeek('2026-09-30');
  const doc = (id, status, meetingDate, updatedAt) => ({
    id,
    status,
    updatedAt,
    config: { meetingDate },
  });
  const store = {
    reports: [
      doc('old', 'final', '2026-09-23', '2026-09-23T01:00:00Z'),
      doc('d1', 'draft', '2026-09-30', '2026-09-30T01:00:00Z'),
      doc('d2', 'draft', '2026-09-29', '2026-09-30T05:00:00Z'),
    ],
  };
  assert.equal(combined.pickWeekReport(store, week).id, 'd2');
  store.reports.push(doc('f', 'final', '2026-09-30', '2026-09-30T02:00:00Z'));
  assert.equal(combined.pickWeekReport(store, week).id, 'f');
  assert.equal(combined.pickWeekReport({ reports: [] }, week), null);
});

await test('통합 보고서: 보고서 없는 팀은 업무 기록으로 실적·계획', () => {
  const week = combined.combinedWeek('2026-09-30');
  const task = (id, date, extra = {}) => ({
    id, title: id, description: '', date, categoryId: 'c', assigneeId: 'm',
    collaborators: [], priority: 'normal', status: 'scheduled', type: 'task',
    checklist: [], comments: [], createdBy: 'm', createdAt: '', ...extra,
  });
  const state = {
    members: [{ id: 'm', name: '김' }],
    categories: [{ id: 'c', name: '운영' }],
    tasks: [
      task('last-week', '2026-09-22'),
      task('done-late', '2026-09-10', { status: 'completed', completedAt: '2026-09-24T03:00:00Z' }),
      task('this-week', '2026-09-29'),
      task('spans', '2026-09-26', { endDate: '2026-09-29' }),
      task('far', '2026-11-01'),
    ],
  };
  const rows = combined.autoTeamRows(state, week);
  assert.deepEqual(rows.before.map((r) => r.title), ['done-late', 'last-week', 'spans']);
  assert.deepEqual(rows.after.map((r) => r.title), ['spans', 'this-week']);
  assert.equal(rows.before[0].assignee, '김');
  assert.equal(combined.countOverdue(state, '2026-09-30'), 3);
});
