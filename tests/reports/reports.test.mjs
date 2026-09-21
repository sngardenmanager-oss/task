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
const exportSource = (
  await fs.readFile(
    new URL('../../lib/report-export.ts', import.meta.url),
    'utf8',
  )
)
  .replace("from './reports'", 'from ' + JSON.stringify(coreUrl))
  .replace(
    "import('exceljs')",
    'import(' +
      JSON.stringify(
        new URL('../../node_modules/exceljs/excel.js', import.meta.url).href,
      ) +
      ')',
  );
const exporter = await import(
  'data:text/javascript;base64,' +
    Buffer.from(
      ts.transpileModule(exportSource, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
    ).toString('base64')
);
const actor = {
  id: 'me',
  name: '담당자',
  team: '운영',
  email: 'me@test',
  role: 'admin',
  active: true,
};
const config = core.defaultReportConfig(actor, '2026-09-21');
const task = (id, date, extra = {}) => ({
  id,
  title: id,
  description: '내용',
  date,
  categoryId: 'c',
  assigneeId: 'me',
  collaborators: [],
  priority: 'normal',
  status: 'scheduled',
  type: 'task',
  checklist: [],
  comments: [],
  createdBy: 'me',
  createdAt: '2026-01-01',
  ...extra,
});
const data = {
  members: [actor],
  categories: [{ id: 'c', name: '운영' }],
  tasks: [
    task('old', '2020-01-01', { status: 'completed' }),
    task('future', '2028-01-01'),
    task('routine', '2027-01-01', { type: 'routine' }),
    task('derived', '2027-01-01', { sourceRoutineId: 'r' }),
    task('other', '2026-01-01', { assigneeId: 'other' }),
  ],
  routines: [],
  notes: [],
};
await test('initial import includes all past completed tasks and distant nonroutine tasks', () => {
  const r = core.newReport(data, actor, config, core.emptyReportStore());
  assert.deepEqual(
    r.rows.map((r) => r.taskId),
    ['old', 'future'],
  );
  assert.equal(r.rows[0].completedAt, undefined);
});
await test('routine tasks, including past ones, never enter the report', () => {
  const withPast = {
    ...data,
    tasks: [
      ...data.tasks,
      task('pastRoutine', '2020-02-02', { type: 'routine' }),
      task('pastDerived', '2020-02-03', { sourceRoutineId: 'r' }),
    ],
  };
  const r = core.newReport(withPast, actor, config, core.emptyReportStore());
  assert.ok(!r.rows.some((x) => /outine|Derived/.test(x.taskId)));
  const stale = { ...r.rows[0], id: 'stale', taskId: undefined, sourceRoutineId: 'r' };
  const refreshed = core.collectReportRows(withPast, actor, config, [], [stale]);
  assert.ok(!refreshed.some((x) => x.id === 'stale'));
});
await test('hidden unfinished rows reappear next week, closed rows do not', () => {
  let store = core.emptyReportStore();
  const r = core.newReport(data, actor, config, store);
  r.rows[0].visible = false;
  r.rows[1].closed = true;
  store = core.saveReport(store, core.finalizeReport(r, []), actor);
  const next = core.newReport(
    data,
    actor,
    { ...config, meetingDate: '2026-09-28' },
    store,
  );
  assert.equal(next.rows.length, 1);
  assert.equal(next.rows[0].visible, true);
  assert.equal(
    store.tracks.find((t) => t.id === r.rows[1].id).history[0].closed,
    true,
  );
  assert.equal(data.tasks[1].status, 'scheduled');
});
await test('refresh preserves wording, manual rows, visibility and deleted source', () => {
  let store = core.emptyReportStore();
  const r = core.newReport(data, actor, config, store);
  r.rows[0].title = '수정한 보고 문구';
  r.rows[0].visible = false;
  r.rows.push({
    ...core.manualRow('after'),
    title: '수동',
    nextAction: '약속',
  });
  store = core.saveReport(store, r, actor);
  const changed = { ...data, tasks: data.tasks.filter((t) => t.id !== 'old') };
  const rows = core.collectReportRows(
    changed,
    actor,
    config,
    store.tracks,
    r.rows,
  );
  assert.equal(rows.length, 3);
  assert.equal(rows[0].title, '수정한 보고 문구');
  assert.equal(rows[0].visible, false);
  assert.match(rows[0].sourceChanged, /삭제/);
});
await test('linked manual and converted note items keep one tracking ID', () => {
  const row = {
    ...core.manualRow('before'),
    title: '수동 연결',
    taskId: 'old',
  };
  const note = {
    ...core.manualRow('before'),
    id: 'note:n1',
    title: '특이사항',
    noteId: 'n1',
  };
  const tracks = [row, note].map((row) => ({
    id: row.id,
    row,
    scopeKey: 'mine',
    closed: false,
    history: [],
  }));
  const input = {
    ...data,
    tasks: [
      data.tasks[0],
      task('converted', '2026-01-01', { sourceNoteId: 'n1' }),
    ],
  };
  const rows = core.collectReportRows(input, actor, config, tracks);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, row.id);
  assert.equal(rows[1].id, note.id);
  assert.equal(rows[1].taskId, 'converted');
});
await test('past promises include hidden future rows by ID', () => {
  let store = core.emptyReportStore();
  const r = core.newReport(data, actor, config, store);
  r.rows[1].nextAction = '서류 제출';
  r.rows[1].visible = false;
  store = core.saveReport(store, core.finalizeReport(r, []), actor);
  const next = core.newReport(
    data,
    actor,
    { ...config, meetingDate: '2026-09-28' },
    store,
  );
  assert.equal(
    next.rows.find((r) => r.taskId === 'future').previousPromise,
    '서류 제출',
  );
});
await test('final snapshots remain fixed after source and statistics change', () => {
  const stats = core.previewStatistics(
    '날짜,전체입장객,매출액\n2026-09-14,100,5000',
    [],
  ).rows;
  const r = core.finalizeReport(
    core.newReport(data, actor, config, core.emptyReportStore()),
    stats,
  );
  const before = JSON.stringify(r);
  stats[0].revenue = 999;
  const modified = structuredClone(data);
  modified.tasks[0].title = '변경';
  assert.equal(JSON.stringify(r), before);
  const store = core.saveReport(core.emptyReportStore(), r, actor);
  assert.throws(
    () =>
      core.saveReport(
        store,
        { ...r, config: { ...r.config, title: '덮어쓰기' } },
        actor,
      ),
    /확정본/,
  );
});
await test('CSV reupload replaces dates, keeps omitted columns, distinguishes null and zero', () => {
  const a = core.previewStatistics(
    '날짜,전체입장객,매출액,단체입장객\n2026-09-14,0,,0',
    [],
  );
  assert.equal(a.rows[0].visitors, 0);
  assert.equal(a.rows[0].revenue, null);
  assert.equal(
    core.previewStatistics(
      '날짜,전체입장객,매출액,단체입장객\n2026-09-14,0,,0',
      a.rows,
    ).same,
    1,
  );
  const b = core.previewStatistics('날짜,전체입장객\n2026-09-14,4', a.rows);
  assert.equal(b.rows[0].groups, 0);
  const old = [{ ...a.rows[0], revenue: 55 }];
  assert.equal(
    core.previewStatistics('날짜,전체입장객,매출액\n2026-09-14,4,', old).rows[0]
      .revenue,
    55,
  );
  assert.equal(
    core.previewStatistics('날짜,전체입장객,매출액\n2026-09-14,4,', old, true)
      .rows[0].revenue,
    null,
  );
});
await test('CSV catches invalid dates, duplicate dates and impossible subsets', () => {
  const bad = core.previewStatistics(
    '날짜,전체입장객,단체입장객\n2026-02-30,5,10\n2026-02-30,-1,0',
    [],
  );
  assert.ok(bad.errors.some((e) => e.includes('날짜 중복')));
  assert.ok(bad.errors.some((e) => e.includes('잘못된 날짜')));
  assert.ok(bad.errors.some((e) => e.includes('단체가 전체')));
  assert.ok(bad.errors.some((e) => e.includes('0 이상의')));
});
await test('CSV parses quoted commas/newlines and rejects malformed quotes', () => {
  assert.deepEqual(core.parseCsv('a,b\n"한,글","두\n줄"'), [
    ['a', 'b'],
    ['한,글', '두\n줄'],
  ]);
  assert.throws(() => core.parseCsv('a,b\n"끝나지 않음'));
});
await test('ratios use aggregate counts, year-zero is incomparable and missing days are explicit', () => {
  const text =
    '날짜,전체입장객,단체입장객,외국인전체,매출액\n2026-09-14,10,10,2,100\n2026-09-15,90,0,8,200\n2025-09-14,10,5,1,0\n2025-09-15,90,45,9,0';
  const rows = core.previewStatistics(text, []).rows;
  const result = core.calculateMetrics(rows, '2026-09-14', '2026-09-15');
  assert.equal(result[2].current, 10);
  assert.equal(result[2].change, -40);
  assert.equal(result[0].comparison, '비교 불가(전년 0)');
  const missing = core.calculateMetrics(rows, '2026-09-14', '2026-09-16');
  assert.equal(missing[0].current, null);
  assert.equal(missing[0].missing, 1);
});
await test('leap year uses prior February end and exposes differing day counts', () => {
  assert.equal(core.previousYear('2024-02-29'), '2023-02-28');
  assert.equal(core.daysBetween('2024-02-28', '2024-02-29').length, 2);
  assert.equal(core.daysBetween('2023-02-28', '2023-02-28').length, 1);
});
await test('upload undo rejects later edits', () => {
  const row = core.previewStatistics('날짜,전체입장객\n2026-09-14,10', [])
    .rows[0];
  const store = {
    ...core.emptyReportStore(),
    statistics: [row],
    imports: [{ id: 'i', after: [row], before: [null] }],
  };
  assert.deepEqual(core.undoStatisticImport(store, 'i').statistics, []);
  assert.throws(
    () =>
      core.undoStatisticImport(
        { ...store, statistics: [{ ...row, visitors: 20 }] },
        'i',
      ),
    /이후 수정/,
  );
});
await test('every export excludes hidden report rows and HTML escapes user content', () => {
  const r = core.finalizeReport(
    core.newReport(data, actor, config, core.emptyReportStore()),
    [],
  );
  r.rows[0].title = 'SECRET_HIDDEN';
  r.rows[0].visible = false;
  r.rows[0].previousPromise = 'SECRET_PROMISE';
  r.rows[1].title = '<script>alert(1)</script>';
  const tables = JSON.stringify(exporter.reportTables(r));
  assert.ok(!tables.includes('SECRET_HIDDEN'));
  assert.ok(!tables.includes('SECRET_PROMISE'));
  const html = exporter.reportHtml(r);
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('SECRET_HIDDEN'));
});

await test('report output: slim 이전진행 columns, news tone and comma numbers', () => {
  const r = core.finalizeReport(
    core.newReport(data, actor, config, core.emptyReportStore()),
    [
      {
        date: config.statsStart,
        revenue: 1234567,
        visitors: 1000,
        groups: null,
        foreigners: null,
        foreignGroups: null,
        groupGeneral: null,
        groupLocal: null,
        groupWelfare: null,
        memo: '',
      },
    ],
  );
  r.news = [
    { id: 'p', title: 'good', category: 'k', source: 's', collectedAt: '2026-09-01', tone: 'positive' },
    { id: 'n', title: 'bad', category: 'k', source: 's', collectedAt: '2026-09-01', tone: 'negative' },
  ];
  const tables = exporter.reportTables(r);
  const before = tables.find((t) => t.name === '이전진행');
  for (const gone of ['다음 행동', '담당자', '보고 상태', '결과 메모'])
    assert.ok(!before.headers.includes(gone), gone);
  const labels = tables[0].rows.map((x) => x[0]);
  assert.ok(labels.includes('관광 동향 · 긍정') && labels.includes('관광 동향 · 부정'));
  const html = exporter.reportHtml(r);
  assert.ok(html.includes('1,234,567'));
  assert.ok(html.includes('관광 동향 · 부정'));
});
await test('composition splits visitors into four non-overlapping parts', () => {
  const row = (date, extra) => ({
    date, revenue: null, visitors: 100, groups: 40, foreigners: 30,
    foreignGroups: 10, groupGeneral: null, groupLocal: null,
    groupWelfare: null, memo: '', ...extra,
  });
  const parts = core.calculateComposition(
    [row('2026-09-01', {}), row('2025-09-01', { visitors: 200 })],
    '2026-09-01',
    '2026-09-01',
  );
  assert.deepEqual(parts.map((p) => p.current), [40, 30, 20, 10]);
  assert.equal(parts.reduce((n, p) => n + p.currentShare, 0), 100);
  assert.equal(parts[3].belongsTo, '단체 구성비 + 외국인 구성비');
  assert.equal(parts[0].previous, 200 - 40 - 20);
  const missing = core.calculateComposition([row('2026-09-01', { foreignGroups: null })], '2026-09-01', '2026-09-01');
  assert.ok(missing.every((p) => p.current === null));
});
await test('JSONB object ordering never invalidates immutable snapshots or undo', () => {
  const a = { id: 'a', rows: [{ title: '보고', visible: true }] };
  const b = { rows: [{ visible: true, title: '보고' }], id: 'a' };
  assert.equal(core.sameReportValue(a, b), true);
  assert.equal(core.sameReportValue(a, { ...b, rows: [] }), false);
});
await test('completion dates use Korean calendar day', () => {
  assert.equal(core.completedDay('2026-09-20T16:30:00Z'), '2026-09-21');
  assert.equal(core.completedDay('2026-09-20'), '2026-09-20');
  assert.equal(core.completedDay(undefined), '');
});

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}
let stored = null;
let apiActor = actor;
let unauthorized = false;
const harness = {
  ApiError,
  apiErrorResponse: (e) =>
    Response.json({ error: e.message }, { status: e.status ?? 500 }),
  authenticateRequest: async () => {
    if (unauthorized) throw new ApiError('로그인 필요', 401);
    return { email: actor.email };
  },
  requireWorkspaceMember: () => apiActor,
  readWorkspaceState: async () => data,
  isSupabaseConfigured: () => true,
  getSupabaseAdmin: () => ({
    from: () => {
      const filters = {};
      let update;
      const query = {
        select: () => query,
        eq: (k, v) => {
          filters[k] = v;
          return query;
        },
        update: (value) => {
          update = value;
          return query;
        },
        maybeSingle: async () => {
          if (update) {
            if (stored?.version !== filters.version)
              return { data: null, error: null };
            stored = structuredClone(update);
            return { data: { version: stored.version }, error: null };
          }
          return { data: stored, error: null };
        },
        insert: async (value) => {
          if (stored) return { error: { code: '23505' } };
          stored = structuredClone(value);
          return { error: null };
        },
      };
      return query;
    },
  }),
};
globalThis.__reportApiTests = harness;
let routeSource = await fs.readFile(
  new URL('../../app/api/reports/route.ts', import.meta.url),
  'utf8',
);
routeSource = routeSource.replace(
  /import \{([\s\S]*?)\} from '@\/lib\/auth-server';/,
  (_, names) => 'const {' + names + '} = globalThis.__reportApiTests;',
);
routeSource = routeSource.replace(
  /import \{([\s\S]*?)\} from '@\/lib\/supabase-server';/,
  (_, names) => 'const {' + names + '} = globalThis.__reportApiTests;',
);
routeSource = routeSource.replace(
  /import \{([\s\S]*?)\} from '@\/lib\/workspace-store';/,
  (_, names) => 'const {' + names + '} = globalThis.__reportApiTests;',
);
routeSource = routeSource.replace(
  "from '@/lib/reports'",
  'from ' + JSON.stringify(coreUrl),
);
const route = await import(
  'data:text/javascript;base64,' +
    Buffer.from(
      ts.transpileModule(routeSource, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
    ).toString('base64')
);
const put = (version, store) =>
  route.PUT(
    new Request('http://local/api/reports', {
      method: 'PUT',
      body: JSON.stringify({ version, store }),
    }),
  );
await test('API rejects unauthenticated and commenter reads and writes', async () => {
  unauthorized = true;
  assert.equal((await route.GET(new Request('http://local'))).status, 401);
  unauthorized = false;
  apiActor = { ...actor, role: 'commenter' };
  assert.equal((await route.GET(new Request('http://local'))).status, 403);
  assert.equal((await put(0, core.emptyReportStore())).status, 403);
  apiActor = actor;
});
await test('API persists drafts, detects conflict and preserves finalized snapshots', async () => {
  stored = null;
  const draft = core.newReport(data, actor, config, core.emptyReportStore());
  let store = core.saveReport(core.emptyReportStore(), draft, actor);
  assert.equal((await put(0, store)).status, 200);
  assert.equal((await put(0, store)).status, 409);
  store = core.saveReport(store, core.finalizeReport(draft, []), actor);
  assert.equal((await put(1, store)).status, 200);
  stored.payload = JSON.parse(
    JSON.stringify(stored.payload, (_k, v) =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v).reverse())
        : v,
    ),
  );
  assert.equal((await put(2, store)).status, 200);
  const tampered = structuredClone(store);
  tampered.reports[0].config.title = '변조';
  assert.equal((await put(3, tampered)).status, 409);
  assert.equal((await put(3, { ...store, reports: [] })).status, 409);
});
await test('API prevents cross-author writes and unsafe archive links', async () => {
  stored = null;
  const draft = core.newReport(data, actor, config, core.emptyReportStore());
  draft.ownerId = 'another';
  assert.equal(
    (await put(0, { ...core.emptyReportStore(), reports: [draft] })).status,
    403,
  );
  assert.equal(
    (
      await put(0, {
        ...core.emptyReportStore(),
        archiveLinks: { x: 'javascript:alert(1)' },
      })
    ).status,
    400,
  );
});

await test('Excel roundtrip preserves Korean text, frozen headers and hidden-row exclusion', async () => {
  const ExcelModule = await import('exceljs');
  const ExcelJS = ExcelModule.default ?? ExcelModule;
  const report = core.finalizeReport(
    core.newReport(data, actor, config, core.emptyReportStore()),
    [],
  );
  report.rows[0].visible = false;
  report.rows[0].title = 'SECRET_EXCEL';
  report.rows[1].title = '한글 업무 \n 여러 줄';
  let download;
  const previousDocument = globalThis.document;
  const documentMock = {
    createElement: () => ({
      click() {
        download = { href: this.href, name: this.download };
      },
    }),
  };
  globalThis.document = documentMock;
  try {
    await exporter.exportReportExcel(report);
    const bytes = await (await fetch(download.href)).arrayBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes);
    assert.equal(workbook.worksheets.length, 7);
    assert.equal(
      workbook.getWorksheet('이후진행').getCell('B2').value,
      '한글 업무 \n 여러 줄',
    );
    assert.equal(workbook.getWorksheet('이전진행').rowCount, 1);
    assert.equal(workbook.getWorksheet('이후진행').views[0].state, 'frozen');
    assert.ok(download.name.endsWith('.xlsx'));
  } finally {
    globalThis.document = previousDocument;
  }
});
