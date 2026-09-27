import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';

const transpile = (source) =>
  'data:text/javascript;base64,' +
  Buffer.from(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
  ).toString('base64');
const coreUrl = transpile(
  await fs.readFile(new URL('../../lib/reports.ts', import.meta.url), 'utf8'),
);
const core = await import(coreUrl);
const share = await import(
  transpile(
    (
      await fs.readFile(
        new URL('../../lib/report-share.ts', import.meta.url),
        'utf8',
      )
    ).replace("from './reports'", 'from ' + JSON.stringify(coreUrl)),
  )
);

const member = (id, name) => ({
  id,
  name,
  team: '운영',
  email: id + '@test',
  role: 'member',
  active: true,
});
const alice = member('alice', '앨리스');
const bob = member('bob', '밥');
const data = {
  members: [alice, bob],
  categories: [{ id: 'c', name: '운영' }],
  tasks: ['t1', 't2'].map((id) => ({
    id,
    title: id,
    description: '',
    date: '2026-09-22',
    categoryId: 'c',
    assigneeId: 'alice',
    collaborators: [],
    priority: 'normal',
    status: 'in_progress',
    type: 'task',
    checklist: [],
    comments: [],
    createdBy: 'alice',
    createdAt: '2026-01-01',
  })),
  routines: [],
  notes: [],
};
const teamConfig = {
  ...core.defaultReportConfig(alice, '2026-09-28'),
  scope: 'team',
  team: '운영',
};
const stat = (date, visitors) => ({
  date,
  revenue: null,
  visitors,
  groups: null,
  foreigners: null,
  foreignGroups: null,
  groupGeneral: null,
  groupLocal: null,
  groupWelfare: null,
  memo: '',
});
const importEntry = (id, rows, before = rows.map(() => null)) => ({
  id,
  filename: id + '.csv',
  at: '2026-09-27T00:00:00Z',
  actor: '앨리스',
  before,
  after: rows,
});
const changedBases = (next, seen) => ({
  reports: Object.fromEntries(
    next.reports
      .filter(
        (r) =>
          !core.sameReportValue(
            r,
            seen.reports.find((b) => b.id === r.id),
          ),
      )
      .map((r) => [r.id, seen.reports.find((b) => b.id === r.id) ?? null]),
  ),
  archiveLinks: seen.archiveLinks,
});

await test('legacy per-owner stores merge into one team store', () => {
  const a = core.emptyReportStore();
  a.statistics = [stat('2026-09-01', 10), stat('2026-09-02', 20)];
  a.tracks = [{ id: 'x', scopeKey: 'mine', row: {}, closed: false, history: [] }];
  const b = core.emptyReportStore();
  b.statistics = [stat('2026-09-02', 25)];
  b.tracks = [{ id: 'x', scopeKey: 'mine', row: {}, closed: false, history: [] }];
  const merged = share.migrateOwnerStores([
    { owner_id: 'bob', payload: b, updated_at: '2026-09-20' },
    { owner_id: 'alice', payload: a, updated_at: '2026-09-10' },
  ]);
  assert.deepEqual(
    merged.statistics.map((s) => [s.date, s.visitors]),
    [
      ['2026-09-01', 10],
      ['2026-09-02', 25],
    ],
  );
  assert.deepEqual(merged.tracks.map((t) => t.scopeKey).sort(), [
    'mine:alice',
    'mine:bob',
  ]);
});

await test('metrics uploaded by one person are shared and a stale save keeps them', () => {
  const server = core.emptyReportStore();
  const stale = structuredClone(server);
  const upload = importEntry('u1', [stat('2026-09-01', 100)]);
  const afterUpload = share.mergeSharedStore(
    server,
    { ...server, statistics: upload.after, imports: [upload] },
    { reports: {} },
    alice,
  );
  assert.equal(afterUpload.statistics.length, 1);
  // 밥은 업로드 전 화면으로 보관 링크만 저장해도 통계가 지워지지 않는다.
  const bobSave = share.mergeSharedStore(
    afterUpload,
    { ...stale, archiveLinks: { r1: 'https://example.com' } },
    { reports: {}, archiveLinks: stale.archiveLinks },
    bob,
  );
  assert.equal(bobSave.statistics[0].visitors, 100);
  assert.equal(bobSave.archiveLinks.r1, 'https://example.com');
});

await test('concurrent checks on the same team draft are both kept', () => {
  let server = core.emptyReportStore();
  const draft = core.newReport(data, alice, teamConfig, server);
  server = share.mergeSharedStore(
    server,
    core.saveReport(server, draft, alice),
    { reports: { [draft.id]: null } },
    alice,
  );
  const seen = structuredClone(server);
  const [row1, row2] = server.reports[0].rows;

  const aliceDoc = {
    ...seen.reports[0],
    rows: seen.reports[0].rows.map((r) =>
      r.id === row1.id ? { ...r, visible: false } : r,
    ),
  };
  const aliceNext = core.saveReport(seen, aliceDoc, alice);
  server = share.mergeSharedStore(server, aliceNext, changedBases(aliceNext, seen), alice);

  const bobDoc = {
    ...seen.reports[0],
    rows: seen.reports[0].rows.map((r) =>
      r.id === row2.id ? { ...r, closed: true, summary: '밥 작성' } : r,
    ),
  };
  const bobNext = core.saveReport(seen, bobDoc, bob);
  server = share.mergeSharedStore(server, bobNext, changedBases(bobNext, seen), bob);

  const rows = server.reports[0].rows;
  assert.equal(rows.find((r) => r.id === row1.id).visible, false);
  assert.equal(rows.find((r) => r.id === row2.id).closed, true);
  assert.equal(rows.find((r) => r.id === row2.id).summary, '밥 작성');
  assert.equal(server.reports[0].ownerId, 'alice');
  assert.ok(
    server.tracks.find((t) => t.id === row2.id && t.scopeKey === 'team:운영')
      .closed,
  );
});

await test('finals are immutable and personal drafts stay with their owner', () => {
  let server = core.emptyReportStore();
  const draft = core.newReport(data, alice, teamConfig, server);
  const final = { ...draft, status: 'final' };
  server = share.mergeSharedStore(
    server,
    core.saveReport(server, final, alice),
    { reports: { [final.id]: null } },
    alice,
  );
  const edited = {
    ...server,
    reports: [{ ...server.reports[0], status: 'draft', rows: [] }],
  };
  assert.throws(
    () =>
      share.mergeSharedStore(
        server,
        edited,
        { reports: { [final.id]: server.reports[0] } },
        bob,
      ),
    /확정된 보고서/,
  );
  const mine = core.newReport(data, alice, core.defaultReportConfig(alice, '2026-09-28'), server);
  const withMine = share.mergeSharedStore(
    server,
    core.saveReport(server, mine, alice),
    { reports: { [mine.id]: null } },
    alice,
  );
  const bobEdit = {
    ...withMine,
    reports: withMine.reports.map((r) =>
      r.id === mine.id ? { ...r, agendas: [] , config: { ...r.config, attendees: '밥' } } : r,
    ),
  };
  assert.throws(
    () =>
      share.mergeSharedStore(
        withMine,
        bobEdit,
        { reports: { [mine.id]: withMine.reports.find((r) => r.id === mine.id) } },
        bob,
      ),
    /작성자만/,
  );
});

await test('undoing an upload after someone changed the same date is refused', () => {
  const upload = importEntry('u1', [stat('2026-09-01', 100)]);
  const server = {
    ...core.emptyReportStore(),
    statistics: [stat('2026-09-01', 120)],
    imports: [upload],
  };
  assert.throws(
    () =>
      share.mergeSharedStore(
        server,
        { ...server, imports: [{ ...upload, undoneAt: '2026-09-27T01:00:00Z' }] },
        { reports: {} },
        alice,
      ),
    /자동 복원할 수 없습니다/,
  );
});
