import { expect, test } from '@playwright/test';
import { seedState } from '../../lib/seed';
import {
  defaultReportConfig,
  emptyReportStore,
  newReport,
} from '../../lib/reports';
import type { ReportStore, Statistic } from '../../lib/report-types';

// Only this browser context uses fake auth and an in-memory store. No production writes.
test('입도객 업로드 → 저장 → 재조회 → 출력 → 확정본 보존', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const actor = seedState.members[0];
  const workspace = {
    ...structuredClone(seedState),
    tasks: [],
    routines: [],
    notes: [],
  };
  const config = {
    ...defaultReportConfig(actor, '2026-09-21'),
    statsStart: '2026-09-14',
    statsEnd: '2026-09-14',
  };
  const garden = (
    date: string,
    visitors: number,
    foreigners: number,
  ): Statistic => ({
    date,
    visitors,
    foreigners,
    groups: 1000,
    foreignGroups: 100,
    revenue: 100000,
    groupGeneral: null,
    groupLocal: null,
    groupWelfare: null,
    memo: '',
  });
  let store: ReportStore = {
    ...emptyReportStore(),
    statistics: [
      garden('2026-09-14', 15000, 3000),
      garden('2025-09-14', 13000, 2000),
    ],
  };
  store.reports.push(newReport(workspace, actor, config, store));
  let version = 0;
  await page.route('**/auth/v1/**', async (route) => {
    const user = {
      id: '00000000-0000-4000-8000-000000000001',
      email: actor.email,
      aud: 'authenticated',
      role: 'authenticated',
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-01-01T00:00:00Z',
    };
    const token = [
      Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),
      Buffer.from(
        JSON.stringify({
          sub: user.id,
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      ).toString('base64url'),
      'test-only',
    ].join('.');
    await route.fulfill({
      json: route.request().url().includes('/token')
        ? {
            access_token: token,
            refresh_token: 'test-only',
            expires_in: 3600,
            token_type: 'bearer',
            user,
          }
        : user,
    });
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/reports') {
      if (route.request().method() === 'PUT') {
        const input = route.request().postDataJSON();
        expect(input.version).toBe(version);
        store = structuredClone(input.store);
        version++;
      }
      await route.fulfill({ json: { store, version } });
    } else if (path === '/api/state')
      await route.fulfill({
        json: { state: workspace, actor, pendingRegistrations: [] },
      });
    else if (path === '/api/auth/bootstrap')
      await route.fulfill({ json: { available: false } });
    else
      await route.fulfill({
        json: { items: [], registrations: [], skipped: true },
      });
  });
  await page.goto(process.env.JEJU_TEST_URL ?? 'http://localhost:3012');
  await page.locator('input[type="email"]').fill(actor.email);
  await page
    .locator('input[type="password"]')
    .fill('fake-browser-test-password');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page
    .getByRole('button', { name: '보고서', exact: true })
    .first()
    .click();
  const summary = page.getByRole('region', {
    name: '제주도 입도객 현황 및 스누피가든 입장객 비중',
  });
  await expect(summary).toContainText('자료 없음');
  await page.getByRole('tab', { name: /경영/ }).click();
  const uploader = page.getByRole('region', { name: '제주 입도객 자료 관리' });
  await uploader.getByLabel('자료 출처').fill('브라우저 검증용 가상자료');
  await uploader.getByLabel('자료 기준일').fill('2026-09-27');
  const upload = (text: string) =>
    uploader
      .getByLabel('입도객 CSV 파일')
      .setInputFiles({
        name: '입도객-검증.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('날짜,총입도객,내국인입도객,외국인입도객\n' + text),
      });
  await upload('2026-09-14,1,240000,60000');
  await expect(uploader.getByRole('alert')).toContainText('합계가 다릅니다');
  await expect(
    uploader.getByRole('button', { name: '입도객 자료 반영' }),
  ).toBeDisabled();
  await upload('2026-09-14,,240000,60000\n2025-09-14,280000,230000,50000');
  await uploader.getByRole('button', { name: '입도객 자료 반영' }).click();
  await expect(uploader.getByRole('status')).toContainText('저장했습니다');
  await expect(
    summary.getByRole('row', { name: /당년 입도객 대비/ }),
  ).toContainText('5.00%');
  await expect(summary.getByRole('row', { name: /비중 변화/ })).toContainText(
    '+1.00%p 증가',
  );
  expect(store.jejuArrivals).toHaveLength(2);
  expect(store.jejuImports?.[0].actor).toBe(actor.name);
  await page.getByRole('button', { name: '서버 다시 불러오기' }).click();
  await expect(summary).toContainText('+1.00%p 증가');
  await summary.screenshot({ path: 'test-results/jeju-summary-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await summary.scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: 'test-results/jeju-summary-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole('button', { name: 'PDF / 인쇄', exact: true })
    .last()
    .click();
  const frame = page.frameLocator('iframe[title="인쇄할 보고서"]');
  await expect(
    frame.getByRole('heading', {
      name: '제주도 입도객 현황 및 스누피가든 입장객 비중',
    }),
  ).toBeVisible();
  await expect(frame.locator('body')).toContainText('+1.00%p 증가');
  await page
    .getByRole('dialog')
    .screenshot({ path: 'test-results/jeju-print-preview.png' });
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await uploader
    .getByText('입도객 업로드 이력 · 되돌리기', { exact: true })
    .click();
  await uploader
    .getByRole('button', { name: '입도객 업로드 되돌리기' })
    .click();
  await expect(uploader.getByRole('status')).toContainText('복원했습니다');
  expect(store.jejuArrivals).toHaveLength(0);
  await upload('2026-09-14,,240000,60000\n2025-09-14,280000,230000,50000');
  await uploader.getByRole('button', { name: '입도객 자료 반영' }).click();
  await expect(uploader.getByRole('status')).toContainText('저장했습니다');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '보고본 확정·보관' }).click();
  await expect(page.getByText('보관된 확정본', { exact: true })).toBeVisible();
  expect(store.reports[0].jejuArrivals).toHaveLength(2);
  store.jejuArrivals![0].source = '확정 이후 변경';
  await expect(summary).not.toContainText('확정 이후 변경');
  await expect(uploader.getByLabel('입도객 CSV 파일')).toBeDisabled();
  expect(errors).toEqual([]);
});
