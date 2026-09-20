import { _electron } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'outputs');
await fs.mkdir(output, { recursive: true });
const app = await _electron.launch({
  executablePath: path.join(
    root,
    'desktop-dist/win-unpacked/스누피가든 업무캘린더.exe',
  ),
  timeout: 30000,
});
const result = { ok: false, checkedAt: new Date().toISOString(), errors: [] };
try {
  const page = await app.firstWindow();
  page.on('pageerror', (error) => result.errors.push(error.message));
  await page.waitForURL('https://snoopy-work-calendar-pig15.vercel.app/**', {
    timeout: 30000,
  });
  const reports = page.getByRole('button', { name: '보고서', exact: true });
  await reports.waitFor({ state: 'visible', timeout: 30000 });
  const responsePromise = page.waitForResponse(
    (response) => response.url().endsWith('/api/reports'),
    { timeout: 30000 },
  );
  await reports.click();
  const response = await responsePromise;
  result.reportsApiStatus = response.status();
  await page
    .getByRole('button', { name: '초안 저장', exact: true })
    .waitFor({ state: 'visible', timeout: 30000 });
  result.url = page.url();
  result.title = await page.title();
  result.reportEditorVisible = true;
  result.reportTabs = await page.getByRole('tab').allTextContents();

  await page.getByRole('button', { name: 'PDF / 인쇄', exact: true }).click();
  const dialog = page.getByRole('dialog', {
    name: '보고서 출력 미리보기',
    exact: true,
  });
  await dialog.waitFor();
  const frame = page.frameLocator('iframe[title="인쇄할 보고서"]');
  await frame
    .getByRole('button', { name: 'PDF로 저장 / 인쇄', exact: true })
    .waitFor();
  result.printTableCount = await frame.locator('table').count();
  assert.equal(result.printTableCount, 6);
  // Check the native-print handoff without sending a job to a physical printer.
  await page.locator('iframe[title="인쇄할 보고서"]').evaluate((el) => {
    el.contentWindow.print = () => {
      el.dataset.printCalled = 'true';
    };
  });
  await frame
    .getByRole('button', { name: 'PDF로 저장 / 인쇄', exact: true })
    .click();
  result.printInvoked =
    (await page
      .locator('iframe[title="인쇄할 보고서"]')
      .getAttribute('data-print-called')) === 'true';
  assert.equal(result.printInvoked, true);
  const html = await page
    .locator('iframe[title="인쇄할 보고서"]')
    .getAttribute('srcdoc');
  // Also exercise Electron's PDF renderer with exactly the preview document.
  const pdfPath = path.join(output, 'desktop-report-verification.pdf');
  const pdfBytes = await app.evaluate(async ({ BrowserWindow }, html) => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });
    try {
      await win.loadURL(
        'data:text/html;charset=utf-8,' + encodeURIComponent(html),
      );
      const pdf = await win.webContents.printToPDF({
        landscape: true,
        printBackground: true,
        preferCSSPageSize: true,
      });
      return Array.from(pdf);
    } finally {
      win.destroy();
    }
  }, html);
  const pdfBuffer = Buffer.from(pdfBytes);
  await fs.writeFile(pdfPath, pdfBuffer);
  result.pdf = {
    bytes: pdfBuffer.length,
    validHeader: pdfBuffer.subarray(0, 5).toString() === '%PDF-',
  };
  assert.equal(result.pdf.validHeader, true);
  assert.ok(result.pdf.bytes > 1000);
  await page.screenshot({
    path: path.join(output, 'deployed-reports-print-preview.png'),
  });
  await dialog.getByRole('button', { name: '닫기', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });

  const excelPath = path.join(output, 'desktop-report-verification.xlsx');
  await app.evaluate(({ BrowserWindow }, filename) => {
    const session = BrowserWindow.getAllWindows()[0].webContents.session;
    globalThis.__reportDownload = new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Excel download timed out')),
        30000,
      );
      session.once('will-download', (_event, item) => {
        item.setSavePath(filename);
        item.once('done', (_e, state) => {
          clearTimeout(timeout);
          if (state === 'completed')
            resolve({ state, filename: item.getFilename() });
          else reject(new Error(state));
        });
      });
    });
  }, excelPath);
  await page
    .getByRole('button', { name: 'Excel 다운로드', exact: true })
    .click();
  result.excel = await app.evaluate(() => globalThis.__reportDownload);
  const ExcelModule = await import('exceljs');
  const ExcelJS = ExcelModule.default ?? ExcelModule;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(excelPath);
  result.excel.sheetNames = workbook.worksheets.map((sheet) => sheet.name);
  assert.equal(result.excel.sheetNames.length, 6);
  assert.equal(result.errors.length, 0);
  assert.equal(response.ok(), true);
  result.ok = true;
  await page.screenshot({
    path: path.join(output, 'deployed-reports-desktop.png'),
  });
} catch (error) {
  result.error = error.message;
} finally {
  await fs.writeFile(
    path.join(output, 'deployed-desktop-verification.json'),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
  await app.close();
}
if (!result.ok) process.exitCode = 1;
