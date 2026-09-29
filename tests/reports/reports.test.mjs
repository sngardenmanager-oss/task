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
const jejuSource = (
  await fs.readFile(
    new URL('../../lib/jeju-arrivals.ts', import.meta.url),
    'utf8',
  )
).replace("from './reports'", 'from ' + JSON.stringify(coreUrl));
const jejuUrl =
  'data:text/javascript;base64,' +
  Buffer.from(
    ts.transpileModule(jejuSource, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
  ).toString('base64');
const jeju = await import(jejuUrl);
const exportSource = (
  await fs.readFile(
    new URL('../../lib/report-export.ts', import.meta.url),
    'utf8',
  )
)
  .replace("from './reports'", 'from ' + JSON.stringify(coreUrl))
  .replace("from './jeju-arrivals'", 'from ' + JSON.stringify(jejuUrl))
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
  const stale = {
    ...r.rows[0],
    id: 'stale',
    taskId: undefined,
    sourceRoutineId: 'r',
  };
  const refreshed = core.collectReportRows(
    withPast,
    actor,
    config,
    [],
    [stale],
  );
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
    scopeKey: 'mine:' + actor.id,
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
    {
      id: 'p',
      title: 'good',
      category: 'k',
      source: 's',
      collectedAt: '2026-09-01',
      tone: 'positive',
    },
    {
      id: 'n',
      title: 'bad',
      category: 'k',
      source: 's',
      collectedAt: '2026-09-01',
      tone: 'negative',
    },
  ];
  const tables = exporter.reportTables(r);
  const before = tables.find((t) => t.name === '이전진행');
  for (const gone of ['다음 행동', '담당자', '보고 상태', '결과 메모'])
    assert.ok(!before.headers.includes(gone), gone);
  const newsTable = tables.find((t) => t.name === '관광동향');
  assert.deepEqual(
    newsTable.rows.map((x) => x[0]),
    ['긍정', '부정'],
  );
  const html = exporter.reportHtml(r);
  assert.ok(html.includes('1,234,567'));
  assert.ok(html.includes('관광동향'));
});
await test('news: positive first then negative, each earliest date first regardless of click order', () => {
  const n = (id, tone, collectedAt) => ({
    id,
    title: id,
    category: 'k',
    source: 's',
    collectedAt,
    tone,
  });
  const sorted = core.sortNews([
    n('neg-late', 'negative', '2026-09-19'),
    n('pos-late', 'positive', '2026-09-18'),
    n('none', undefined, '2026-09-01'),
    n('neg-early', 'negative', '2026-09-02'),
    n('pos-early', 'positive', '2026-09-03'),
  ]);
  assert.deepEqual(
    sorted.map((x) => x.id),
    ['pos-early', 'pos-late', 'neg-early', 'neg-late', 'none'],
  );
});
await test('metrics sheet spells out unit, comparison status and missing days', () => {
  const stats = core.previewStatistics(
    '날짜,전체입장객,매출액,단체입장객,외국인전체\n2026-09-14,1000,1000,285,309\n2025-09-14,1000,2000,255,257',
    [],
  ).rows;
  const r = core.finalizeReport(
    core.newReport(
      data,
      actor,
      { ...config, statsStart: '2026-09-14', statsEnd: '2026-09-14' },
      core.emptyReportStore(),
    ),
    stats,
  );
  const sheet = exporter.reportTables(r).find((t) => t.name === '경영지표');
  const revenue = sheet.rows[0];
  assert.deepEqual(revenue.slice(1, 9), [
    1000,
    2000,
    -1000,
    '-50.0%',
    '원',
    '감소',
    '0일',
    '0일',
  ]);
  const group = sheet.rows[2];
  assert.equal(group[1], 28.5);
  assert.equal(group[4], '+3.0%p');
  assert.equal(group[6], '증가');
});
await test('composition skips only incomplete days instead of blanking the period', () => {
  const row = (date, extra = {}) => ({
    date,
    revenue: null,
    visitors: 100,
    groups: 40,
    foreigners: 30,
    foreignGroups: 10,
    groupGeneral: null,
    groupLocal: null,
    groupWelfare: null,
    memo: '',
    ...extra,
  });
  const parts = core.calculateComposition(
    [
      row('2026-09-01'),
      row('2026-09-02', { foreignGroups: null }),
      row('2025-09-01'),
      row('2025-09-02'),
    ],
    '2026-09-01',
    '2026-09-02',
  );
  assert.deepEqual(
    parts.map((p) => p.current),
    [40, 30, 20, 10],
  );
  assert.equal(parts[0].missing, 1);
  assert.equal(parts[0].previousMissing, 0);
  const daily = core.dailyComposition(
    [row('2026-09-01')],
    '2026-09-01',
    '2026-09-02',
  );
  assert.deepEqual(daily[0].value.parts, [40, 30, 20, 10]);
  assert.equal(daily[1].value, null);
});
await test('progress export groups by category, then earliest due date, undated last', () => {
  const r = core.finalizeReport(
    core.newReport(data, actor, config, core.emptyReportStore()),
    [],
  );
  const row = (title, category, date) => ({
    ...core.manualRow('before'),
    title,
    category,
    date,
  });
  r.rows = [
    row('A-late', '파크운영', '2026-09-20'),
    row('B', '데이터관리', '2026-09-01'),
    row('A-none', '파크운영', ''),
    row('A-early', '파크운영', '2026-09-03'),
  ];
  const before = exporter.reportTables(r).find((t) => t.name === '이전진행');
  assert.deepEqual(
    before.rows.map((x) => x[1]),
    ['A-early', 'A-late', 'A-none', 'B'],
  );
  assert.ok(exporter.reportHtml(r).includes('size:A4 portrait'));
});
await test('category counts rank the most frequent work first', () => {
  assert.deepEqual(
    core.categoryCounts([
      { category: '데이터관리' },
      { category: '파크운영' },
      { category: '파크운영' },
      { category: '' },
    ]),
    [
      ['파크운영', 2],
      ['데이터관리', 1],
      ['기타', 1],
    ],
  );
});
await test('composition splits visitors into four non-overlapping parts', () => {
  const row = (date, extra) => ({
    date,
    revenue: null,
    visitors: 100,
    groups: 40,
    foreigners: 30,
    foreignGroups: 10,
    groupGeneral: null,
    groupLocal: null,
    groupWelfare: null,
    memo: '',
    ...extra,
  });
  const parts = core.calculateComposition(
    [row('2026-09-01', {}), row('2025-09-01', { visitors: 200 })],
    '2026-09-01',
    '2026-09-01',
  );
  assert.deepEqual(
    parts.map((p) => p.current),
    [40, 30, 20, 10],
  );
  assert.equal(
    parts.reduce((n, p) => n + p.currentShare, 0),
    100,
  );
  assert.equal(parts[3].belongsTo, '단체 구성비 + 외국인 구성비');
  assert.equal(parts[0].previous, 200 - 40 - 20);
  const missing = core.calculateComposition(
    [row('2026-09-01', { foreignGroups: null })],
    '2026-09-01',
    '2026-09-01',
  );
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
  requestedTeam: () => null,
  requireTeamAccess: async () => ({ actor: apiActor, team: { id: 'park' } }),
  isSupabaseConfigured: () => true,
  getSupabaseAdmin: () => ({
    from: () => {
      const filters = {};
      let update;
      const query = {
        select: () => query,
        // 예전 작성자별 행 조회(팀 저장소 최초 생성 때만 사용): 테스트에는 없음
        neq: () => query,
        not: async () => ({ data: [], error: null }),
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
routeSource = routeSource.replace(
  "from '@/lib/retention'",
  'from ' +
    JSON.stringify(
      'data:text/javascript;base64,' +
        Buffer.from(
          ts.transpileModule(
            await fs.readFile(
              new URL('../../lib/retention.ts', import.meta.url),
              'utf8',
            ),
            {
              compilerOptions: {
                module: ts.ModuleKind.ESNext,
                target: ts.ScriptTarget.ES2022,
              },
            },
          ).outputText,
        ).toString('base64'),
    ),
);
routeSource = routeSource.replace(
  "from '@/lib/team-access'",
  'from ' +
    JSON.stringify(
      'data:text/javascript;base64,' +
        Buffer.from(
          ts.transpileModule(
            await fs.readFile(
              new URL('../../lib/team-access.ts', import.meta.url),
              'utf8',
            ),
            {
              compilerOptions: {
                module: ts.ModuleKind.ESNext,
                target: ts.ScriptTarget.ES2022,
              },
            },
          ).outputText,
        ).toString('base64'),
    ),
);
routeSource = routeSource.replace(
  "from '@/lib/jeju-arrivals'",
  'from ' + JSON.stringify(jejuUrl),
);
const shareUrl =
  'data:text/javascript;base64,' +
  Buffer.from(
    ts.transpileModule(
      (
        await fs.readFile(
          new URL('../../lib/report-share.ts', import.meta.url),
          'utf8',
        )
      ).replace("from './reports'", 'from ' + JSON.stringify(coreUrl)),
      {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText,
  ).toString('base64');
routeSource = routeSource.replace(
  "from '@/lib/report-share'",
  'from ' + JSON.stringify(shareUrl),
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
await test('API merges saves into the team store and preserves finalized snapshots', async () => {
  stored = null;
  const draft = core.newReport(data, actor, config, core.emptyReportStore());
  let store = core.saveReport(core.emptyReportStore(), draft, actor);
  assert.equal((await put(0, store)).status, 200);
  // 팀 저장소는 버전이 달라도 거절하지 않고 병합한다.
  assert.equal((await put(0, store)).status, 200);
  store = core.saveReport(store, core.finalizeReport(draft, []), actor);
  const finalized = await put(1, store);
  assert.equal(finalized.status, 200);
  // 화면은 서버가 돌려준 저장소를 이어서 쓴다.
  store = (await finalized.json()).store;
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
  // 요청에 빠진 보고서는 지우지 않는다.
  assert.equal((await put(3, { ...store, reports: [] })).status, 200);
  assert.equal(stored.payload.reports[0].status, 'final');
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
    assert.equal(workbook.worksheets.length, 8);
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

const arrival = (date, total = 300000, domestic = 240000, foreign = 60000) => ({
  date,
  total,
  domestic,
  foreign,
  source: '검증용 가상자료',
  asOf: '2026-09-27',
  status: 'provisional',
});
const garden = (date, visitors = 15000, foreigners = 3000) => ({
  date,
  visitors,
  foreigners,
  revenue: null,
  groups: null,
  foreignGroups: null,
  groupGeneral: null,
  groupLocal: null,
  groupWelfare: null,
  memo: '',
});
const defaults = {
  source: '검증용 가상자료',
  asOf: '2026-09-27',
  status: 'provisional',
};
const arrivalCsv = (line) => '날짜,총입도객,내국인입도객,외국인입도객\n' + line;

await test('Jeju CSV derives totals, validates rows and roundtrips provenance', () => {
  const p = jeju.previewJejuCsv(
    arrivalCsv('2026-09-14,,240000,60000'),
    defaults,
  );
  assert.deepEqual(p.errors, []);
  assert.equal(p.rows[0].total, 300000);
  p.rows[0].source = '기관, "원본"\n둘째 줄';
  assert.deepEqual(
    jeju.previewJejuCsv(jeju.jejuCsv(p.rows), defaults).rows,
    p.rows,
  );
  for (const line of [
    '2026-09-14,1,2,3',
    '2026-09-14,-1,0,0',
    '2026-09-14,1.5,,',
    '2026-02-30,10,,',
    '2026-09-14,,,',
    '2026-09-14,9007199254740992,,',
    '2026-09-14,100,101,',
  ]) {
    assert.ok(
      jeju.previewJejuCsv(arrivalCsv(line), defaults).errors.length,
      line,
    );
  }
  assert.ok(
    jeju
      .previewJejuCsv(
        arrivalCsv('2026-09-14,0,0,0\n2026-09-14,1,1,0'),
        defaults,
      )
      .errors.some((e) => e.includes('중복')),
  );
  assert.ok(
    jeju.previewJejuCsv('날짜,전체입장객\n2026-09-14,15', defaults).errors
      .length,
  );
  assert.equal(
    jeju.previewJejuCsv(arrivalCsv('2026-09-14,0,0,0'), defaults).rows[0].total,
    0,
  );
  assert.equal(
    jeju.previewJejuCsv(arrivalCsv('2026-09-14,300000,,'), defaults).rows[0]
      .domestic,
    null,
  );
});

await test('Jeju ratios compare matched nationalities and use percentage points', () => {
  const s = jeju.calculateJeju(
    [arrival('2026-09-14'), arrival('2025-09-14', 280000, 230000, 50000)],
    [garden('2026-09-14'), garden('2025-09-14', 13000, 2000)],
    '2026-09-14',
    '2026-09-14',
  );
  assert.deepEqual(
    s.columns.map((c) => c.current.share),
    [5, 5, 5],
  );
  assert.deepEqual(
    s.columns.map((c) => c.difference),
    [20000, 10000, 10000],
  );
  assert.equal(s.columns[2].growth, 20);
  assert.equal(s.columns[2].shareChange, 1);
  assert.equal(jeju.jejuSummaryRows(s)[8][2], '+0.22%p 증가');
  const weighted = jeju.calculateJeju(
    [arrival('2026-09-14', 100, 100, 0), arrival('2026-09-15', 900, 900, 0)],
    [garden('2026-09-14', 10, 0), garden('2026-09-15', 0, 0)],
    '2026-09-14',
    '2026-09-15',
  );
  assert.equal(weighted.columns[0].current.share, 1); // Not mean(10%, 0%).
});

await test('Jeju missing dates never produce mismatched ratios or official growth', () => {
  const s = jeju.calculateJeju(
    [arrival('2026-09-14'), arrival('2025-09-14'), arrival('2025-09-15')],
    [garden('2026-09-15'), garden('2025-09-14'), garden('2025-09-15')],
    '2026-09-14',
    '2026-09-15',
  );
  assert.equal(s.columns[0].current.arrivals.value, 300000);
  assert.equal(s.columns[0].current.arrivals.entered, 1);
  assert.equal(s.columns[0].current.share, null);
  assert.equal(s.columns[0].difference, null);
  assert.equal(s.columns[0].growth, null);
  assert.ok(jeju.jejuSummaryRows(s)[0][1].includes('부분 집계'));
  const totalOnly = jeju.calculateJeju(
    [arrival('2026-09-14', 300000, null, null)],
    [garden('2026-09-14')],
    '2026-09-14',
    '2026-09-14',
  );
  assert.equal(totalOnly.columns[0].current.share, 5);
  assert.equal(totalOnly.columns[1].current.share, null);
  assert.equal(totalOnly.columns[0].growth, null);
});

await test('Jeju handles zero denominators, decreases, invalid ranges and leap periods', () => {
  const s = jeju.calculateJeju(
    [arrival('2026-09-14', 0, 0, 0), arrival('2025-09-14', 0, 0, 0)],
    [garden('2026-09-14', 0, 0), garden('2025-09-14', 0, 0)],
    '2026-09-14',
    '2026-09-14',
  );
  assert.equal(s.columns[0].difference, 0);
  assert.equal(s.columns[0].growthReason, '비교 불가(전년 0)');
  assert.equal(s.columns[0].current.shareReason, '계산 불가(입도객 0)');
  const down = jeju.calculateJeju(
    [arrival('2026-09-14', 0, 0, 0), arrival('2025-09-14')],
    [],
    '2026-09-14',
    '2026-09-14',
  );
  assert.equal(down.columns[0].growth, -100);
  const leap = jeju.calculateJeju([], [], '2024-02-28', '2024-02-29');
  assert.equal(leap.currentDays, 2);
  assert.equal(leap.previousDays, 1);
  assert.ok(jeju.jejuPeriodNote(leap).includes('비교 일수가 다릅니다'));
  assert.equal(jeju.calculateJeju([], [], '', '').currentDays, 0);
});

await test('Jeju import undo is independent, guards newer edits and preserves final snapshots', () => {
  const original = arrival('2026-09-14');
  let store = {
    ...core.emptyReportStore(),
    statistics: [garden('2026-09-14')],
  };
  store = jeju.applyJejuImport(store, [original], '원본.csv', actor.name);
  const firstId = store.jejuImports[0].id;
  const report = core.finalizeReport(
    core.newReport(data, actor, config, store),
    store.statistics,
    store.jejuArrivals,
  );
  const corrected = { ...original, total: 310000, domestic: 250000 };
  store = jeju.applyJejuImport(store, [corrected], '정정.csv', actor.name);
  assert.throws(() => jeju.undoJejuImport(store, firstId), /이후 수정/);
  assert.equal(report.jejuArrivals[0].total, 300000);
  store = jeju.undoJejuImport(store, store.jejuImports[1].id);
  assert.deepEqual(store.jejuArrivals, [original]);
  store = jeju.undoJejuImport(store, firstId);
  assert.deepEqual(store.jejuArrivals, []);
  assert.deepEqual(store.statistics, [garden('2026-09-14')]);
  assert.equal(report.jejuArrivals[0].total, 300000);
  assert.throws(() => jeju.undoJejuImport(store, firstId), /되돌릴/);
  assert.equal(jeju.validateJejuStore(store), null);
});

await test('Jeju exports retain three columns, source and placement before composition', async () => {
  const r = core.finalizeReport(
    core.newReport(
      data,
      actor,
      { ...config, statsStart: '2026-09-14', statsEnd: '2026-09-14' },
      core.emptyReportStore(),
    ),
    [garden('2026-09-14'), garden('2025-09-14', 13000, 2000)],
    [arrival('2026-09-14'), arrival('2025-09-14', 280000, 230000, 50000)],
  );
  const tables = exporter.reportTables(r);
  assert.deepEqual(tables.find((t) => t.name === '제주입도객').headers, [
    '항목',
    '총 입도객',
    '내국인 입도객',
    '외국인 입도객',
  ]);
  assert.equal(
    tables.find((t) => t.name === '제주입도객').rows[8][3],
    '+1.00%p 증가',
  );
  assert.equal(tables.find((t) => t.name === '입도객원본').rows.length, 2);
  const html = exporter.reportHtml(r);
  assert.ok(html.indexOf(jeju.jejuTitle) < html.indexOf('입장객구성'));
  assert.ok(html.includes('+1.00%p 증가'));
  assert.ok(html.includes('검증용 가상자료'));
  r.jejuArrivals[0].source = '<script>unsafe()</script>';
  assert.ok(!exporter.reportHtml(r).includes('<script>unsafe()'));
  let download;
  const previousDocument = globalThis.document;
  const documentMock = {
    createElement: () => ({
      click() {
        download = this.href;
      },
    }),
  };
  globalThis.document = documentMock;
  try {
    await exporter.exportReportExcel(r);
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await (await fetch(download)).arrayBuffer());
    assert.equal(workbook.worksheets.length, 10);
    assert.equal(
      workbook.getWorksheet('제주입도객').getCell('D10').value,
      '+1.00%p 증가',
    );
    assert.equal(
      workbook.getWorksheet('입도객원본').getCell('B2').value,
      300000,
    );
  } finally {
    globalThis.document = previousDocument;
  }
  const legacy = core.finalizeReport(
    core.newReport(data, actor, config, core.emptyReportStore()),
    [],
  );
  assert.ok(
    !exporter.reportTables(legacy).some((t) => t.name === '제주입도객'),
  );
  assert.ok(exporter.reportHtml(legacy).includes('입도객 자료 미포함'));
});

await test('API persists Jeju data, validates history, rejects old-client loss and final edits', async () => {
  stored = null;
  let store = jeju.applyJejuImport(
    core.emptyReportStore(),
    [arrival('2026-09-14')],
    '입도객.csv',
    actor.name,
  );
  assert.equal((await put(0, store)).status, 200);
  const loaded = await (await route.GET(new Request('http://local'))).json();
  assert.equal(loaded.store.jejuArrivals[0].total, 300000);
  // 예전 화면(빈 저장소)으로 저장해도 팀이 공유하는 입도객 자료는 지워지지 않는다.
  assert.equal((await put(1, core.emptyReportStore())).status, 200);
  assert.equal(stored.payload.jejuArrivals[0].total, 300000);
  // 서버는 업로드 기록으로 들어온 값만 반영하고, 잘못된 업로드는 거절한다.
  const invalid = jeju.applyJejuImport(store, [arrival('2026-09-15')], 'x.csv', actor.name);
  invalid.jejuImports.at(-1).after[0].total = 1;
  assert.equal((await put(1, invalid)).status, 400);
  const invalidHistory = jeju.applyJejuImport(store, [arrival('2026-09-15')], 'x.csv', actor.name);
  invalidHistory.jejuImports.at(-1).before = [];
  assert.equal((await put(1, invalidHistory)).status, 400);
  const duplicate = jeju.applyJejuImport(store, [arrival('2026-09-15')], 'x.csv', actor.name);
  duplicate.jejuImports.at(-1).after.push(arrival('2026-09-15'));
  assert.equal((await put(1, duplicate)).status, 400);
  assert.equal(stored.payload.jejuArrivals.length, 1);
  const r = core.finalizeReport(
    core.newReport(data, actor, config, store),
    [],
    store.jejuArrivals,
  );
  store = core.saveReport(store, r, actor);
  assert.equal((await put(1, store)).status, 200);
  const altered = structuredClone(store);
  altered.reports[0].jejuArrivals[0].source = '변경';
  assert.equal((await put(2, altered)).status, 409);
});
