const { app, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const configPath = path.join(__dirname, 'site-url.json');
const configuredUrl = JSON.parse(fs.readFileSync(configPath, 'utf8')).url;
const appUrl = process.env.SNOOPY_CALENDAR_URL || configuredUrl;
const smokeTest = process.argv.includes('--smoke-test');
const outputArgument = process.argv.find((value) =>
  value.startsWith('--smoke-output='),
);
const smokeOutput = outputArgument?.slice('--smoke-output='.length);
const defaultProfile = process.env.USERPROFILE || 'C:\\Users\\hanji';
const newsFolder =
  process.env.SNOOPY_NEWS_FOLDER ||
  path.join(
    defaultProfile,
    'Documents',
    '한지원 저장소',
    '뉴스크롤링',
    '뉴스모음',
  );

const DAY_MS = 24 * 60 * 60 * 1000;
const KOREA_UTC_OFFSET_MS = 9 * 60 * 60 * 1000;
const dashboardDataPath = path.join(newsFolder, '_dashboard_data.json');

function getNewsSyncStatePath() {
  return path.join(app.getPath('userData'), 'news-source-sync.json');
}

function recentKoreaDates(count = 3) {
  const koreaNow = Date.now() + KOREA_UTC_OFFSET_MS;
  return new Set(
    Array.from({ length: count }, (_, index) =>
      new Date(koreaNow - index * DAY_MS).toISOString().slice(0, 10),
    ),
  );
}

async function readLastNewsSnapshot() {
  try {
    const raw = await fs.promises.readFile(getNewsSyncStatePath(), 'utf8');
    const state = JSON.parse(raw);
    return typeof state.snapshotId === 'string' ? state.snapshotId : '';
  } catch {
    return '';
  }
}

// 뉴스 크롤러(별도 프로그램)가 관리하는 카테고리별 기사 아카이브를 그대로
// 읽는다. 카테고리, 실제 기사 URL, 발행일이 이미 정확히 들어있어서 문서를
// 직접 파싱해 제목/링크를 추측할 필요가 없다.
async function collectRecentNewsItems() {
  if (!fs.existsSync(dashboardDataPath)) {
    return { items: [], snapshotId: '', skipped: false };
  }
  const stat = await fs.promises.stat(dashboardDataPath);
  const snapshotId = `${appUrl}:${stat.size}:${stat.mtimeMs}`;
  if ((await readLastNewsSnapshot()) === snapshotId) {
    return { items: [], snapshotId, skipped: true };
  }
  const raw = await fs.promises.readFile(dashboardDataPath, 'utf8');
  const data = JSON.parse(raw);
  const includedDates = recentKoreaDates();
  const items = [];
  for (const [category, articles] of Object.entries(data)) {
    if (!Array.isArray(articles)) continue;
    for (const article of articles) {
      const pubDate =
        typeof article.pub_date === 'string'
          ? article.pub_date.slice(0, 10)
          : '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(pubDate)) continue;
      if (!includedDates.has(pubDate)) continue;
      const title =
        typeof article.title === 'string' ? article.title.trim() : '';
      if (!title) continue;
      const url = typeof article.url === 'string' ? article.url.trim() : '';
      items.push({
        id: crypto
          .createHash('sha1')
          .update(`${category}:${url || title}`)
          .digest('hex'),
        title,
        category,
        source: article.press || article.source || '',
        url: url || undefined,
        pubDate,
      });
    }
  }
  return { items, snapshotId, skipped: false };
}

ipcMain.handle('news:collect-recent', async () => {
  try {
    return await collectRecentNewsItems();
  } catch (error) {
    return { items: [], snapshotId: '', skipped: false, error: String(error) };
  }
});

ipcMain.handle('news:mark-synced', async (_event, snapshotId) => {
  if (typeof snapshotId !== 'string' || !snapshotId) return false;
  await fs.promises.mkdir(path.dirname(getNewsSyncStatePath()), {
    recursive: true,
  });
  await fs.promises.writeFile(
    getNewsSyncStatePath(),
    JSON.stringify({ snapshotId, syncedAt: new Date().toISOString() }),
    'utf8',
  );
  return true;
});

function writeSmokeResult(result) {
  if (smokeOutput) {
    fs.writeFileSync(smokeOutput, JSON.stringify(result, null, 2), 'utf8');
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 390,
    minHeight: 700,
    show: !smokeTest,
    autoHideMenuBar: true,
    backgroundColor: '#f5f3ec',
    title: '스누피가든 업무캘린더',
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  window.webContents.once(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedUrl) => {
      if (!smokeTest) return;
      writeSmokeResult({
        ok: false,
        errorCode,
        errorDescription,
        url: validatedUrl,
      });
      app.exit(1);
    },
  );

  window.webContents.once('did-finish-load', async () => {
    if (!smokeTest) return;
    try {
      const result = await window.webContents.executeJavaScript(`
        new Promise((resolve) => {
          const deadline = Date.now() + 15000;
          const inspect = () => {
            const result = {
              title: document.title,
              heading: document.querySelector('h1')?.textContent?.trim() || '',
              buttonCount: document.querySelectorAll('button').length,
              bodyLength: document.body.innerText.length,
              url: location.href
            };
            if ((result.buttonCount > 0 && result.bodyLength > 100) || Date.now() >= deadline) {
              resolve(result);
              return;
            }
            setTimeout(inspect, 250);
          };
          inspect();
        })
      `);
      writeSmokeResult({
        ok: result.buttonCount > 0 && result.bodyLength > 100,
        ...result,
      });
      app.exit(result.buttonCount > 0 && result.bodyLength > 100 ? 0 : 1);
    } catch (error) {
      writeSmokeResult({ ok: false, error: String(error) });
      app.exit(1);
    }
  });

  void window.loadURL(appUrl);
}

void app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
