import { expect, test } from '@playwright/test';
import { seedState } from '../../lib/seed';
import {
  collectReportRows,
  defaultReportConfig,
  emptyReportStore,
  newReport,
} from '../../lib/reports';
import { applyCorrectionInput } from '../../lib/report-corrections';
import { mergeSharedStore } from '../../lib/report-share';
import type { ReportStore } from '../../lib/report-types';
import type { Task } from '../../lib/types';

const OUT = 'test-results';
// Fake auth and an in-memory store only. Nothing is sent to production.
test('보고서 탭 개선 화면 확인', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => { errors.push(e.message); console.log('PAGEERROR', e.message, e.stack?.slice(0, 600)); });
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 400)); });
  const actor = seedState.members[0];
  const task = (id: string, over: Partial<Task>): Task => ({
    id, title: id, description: '', date: '2026-10-01', categoryId: 'park', assigneeId: actor.id,
    collaborators: [], priority: 'normal', status: 'scheduled', type: 'task', checklist: [], comments: [],
    createdBy: actor.id, createdAt: '2026-09-01T00:00:00Z', ...over,
  });
  const tasks: Task[] = [];
  const projects = [
    ['할로윈 페스티벌', '2026-10-31', '2026-09-20'],
    ['가을 포토존', '2026-10-15', '2026-09-10'],
    ['겨울 시즌 준비', '2026-12-01', '2026-09-25'],
    ['단체 영업 캠페인', '2026-11-20', '2026-09-28'],
    ['안전 점검', '2026-11-30', '2026-08-01'],
  ] as const;
  projects.forEach(([title, date, created], p) => {
    tasks.push(task('p' + p, { title, date, createdAt: created + 'T00:00:00Z' }));
    for (let c = 0; c < 4; c++)
      tasks.push(task(`p${p}c${c}`, {
        title: `${title} 하위 ${c + 1}`, parentId: 'p' + p, date: c < 2 ? '2026-10-03' : '2026-10-25',
        status: p === 0 && c === 0 ? 'scheduled' : c === 0 ? 'completed' : c === 1 ? 'in_progress' : 'scheduled',
        completedAt: c === 0 ? '2026-10-02T00:00:00Z' : undefined,
      }));
  });
  for (let i = 0; i < 8; i++)
    tasks.push(task('done' + i, { title: `지난주 완료 업무 ${i + 1}`, date: '2026-09-28', status: 'completed', completedAt: '2026-09-30T00:00:00Z', categoryId: i % 2 ? 'sales' : 'park' }));
  for (let i = 0; i < 6; i++)
    tasks.push(task('open' + i, { title: `진행 중 업무 ${i + 1}`, date: '2026-10-02', status: 'in_progress' }));
  const workspace = { ...structuredClone(seedState), tasks, routines: [], notes: [] };
  const team = { ...defaultReportConfig(actor, '2026-10-05'), scope: 'team' as const, team: actor.team };
  let store: ReportStore = emptyReportStore();
  const previous = newReport(workspace, actor, team, store);
  previous.status = 'final';
  previous.finalizedAt = '2026-10-05T09:00:00Z';
  store.reports.push(previous);
  const config = { ...defaultReportConfig(actor, '2026-10-12'), scope: 'team' as const, team: actor.team };
  const draft = newReport(workspace, actor, config, store);
  draft.rows = collectReportRows(workspace, actor, config, store.tracks, draft.rows, previous);
  store.reports.push(draft);
  store = applyCorrectionInput(store, { kind: 'correction', requestId: 'proposal-test-1', reportId: previous.id, note: '입장객 9/30 수치 단위 오류' }, actor);
  let version = 1;
  await page.route('**/auth/v1/**', async (route) => {
    const user = { id: '00000000-0000-4000-8000-000000000001', email: actor.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
    const token = [Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'), Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'), 'test-only'].join('.');
    await route.fulfill({ json: route.request().url().includes('/token') ? { access_token: token, refresh_token: 'test-only', expires_in: 3600, token_type: 'bearer', user } : user });
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/reports') {
      const method = route.request().method();
      if (method === 'PUT') { const input = route.request().postDataJSON(); store = mergeSharedStore(store, input.store, input.bases ?? {}, actor); version++; }
      if (method === 'POST') { const body = route.request().postDataJSON(); store = applyCorrectionInput(store, body, actor); version++; }
      await route.fulfill({ json: { store, version } });
    } else if (path === '/api/state') await route.fulfill({ json: { state: workspace, actor, team: { id: 'park', name: '파크사업팀', active: true }, teams: [{ id: 'park', name: '파크사업팀', active: true }], isMaster: false, companyEvents: [], pendingRegistrations: [] } });
    else if (path === '/api/auth/bootstrap') await route.fulfill({ json: { available: false } });
    else await route.fulfill({ json: { items: [], registrations: [], skipped: true } });
  });
  await page.goto(process.env.REPORT_TEST_URL ?? 'http://localhost:3012');
  await page.locator('input[type="email"]').fill(actor.email);
  await page.locator('input[type="password"]').fill('fake-browser-test-password');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.getByRole('button', { name: '보고서', exact: true }).first().click();
  await expect(page.getByText('연결 프로젝트 5건')).toBeVisible();
  await page.screenshot({ path: OUT + '/01-top.png' });
  await expect(page.getByRole('button', { name: /제안 \d+건 모두 완결/ })).toBeVisible();
  await page.getByRole('button', { name: '나머지 2건 보기 ▼' }).click();
  await page.locator('#report-projects').screenshot({ path: OUT + '/02-projects.png' });
  await page.getByRole('button', { name: /^완결 제안 \d+/ }).click();
  await page.locator('#report-before').screenshot({ path: OUT + '/03-suggested.png' });
  await page.getByRole('button', { name: /제안 \d+건 모두 완결/ }).click();
  await expect(page.getByText('● 저장 안 됨')).toBeVisible();
  await page.getByRole('button', { name: /^보고 대상 \d+/ }).click();
  await page.getByRole('button', { name: '이후 진행', exact: true }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: OUT + '/04-scrolled-sticky.png' });
  await page.getByRole('button', { name: '초안 저장' }).first().click();
  await expect(page.getByText('초안을 저장했습니다.')).toBeVisible();
  expect(store.tracks.filter(t => t.closed).length).toBeGreaterThan(0);
  await page.getByRole('button', { name: '미리보기' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.screenshot({ path: OUT + '/05-preview.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('button', { name: '제출·확정' }).first().click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: OUT + '/06-submit.png' });
  await page.getByRole('button', { name: '완결 아카이브', exact: true }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: OUT + '/07-archive.png' });
  // 정정 제안: 관리자 배지 → 확정본 열기 → 반영
  await page.getByRole('button', { name: /정정 제안 1/ }).click();
  await page.waitForTimeout(600);
  await page.locator('#report-submit').screenshot({ path: OUT + '/08-correction.png' });
  await page.getByRole('button', { name: '대기 제안 반영해 정정본 작성' }).click();
  await expect(page.getByLabel('보고 처리 사유')).toHaveValue(/입장객 9\/30/);
  expect(store.corrections?.[0].status).toBe('applied');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: OUT + '/09-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
