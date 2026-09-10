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

function koreaDate() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(
    new Date(),
  );
}

function newsSyncPath() {
  return path.join(app.getPath('userData'), 'news-sync.json');
}

function readNewsSync() {
  try {
    if (!fs.existsSync(newsSyncPath()))
      return { lastSyncedDate: '', fileHashes: {} };
    const sync = JSON.parse(fs.readFileSync(newsSyncPath(), 'utf8'));
    return {
      lastSyncedDate:
        typeof sync.lastSyncedDate === 'string' ? sync.lastSyncedDate : '',
      fileHashes:
        sync.fileHashes && typeof sync.fileHashes === 'object'
          ? sync.fileHashes
          : {},
    };
  } catch {
    return { lastSyncedDate: '', fileHashes: {} };
  }
}

const NEWS_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;

async function listNewsFiles(directory, depth = 0) {
  if (depth > 4 || !fs.existsSync(directory)) return [];
  const allowed = new Set(['.md', '.txt', '.json', '.csv', '.html']);
  const entries = await fs.promises.readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return listNewsFiles(fullPath, depth + 1);
      if (
        !entry.isFile() ||
        !allowed.has(path.extname(entry.name).toLowerCase())
      ) {
        return [];
      }
      const stat = await fs.promises.stat(fullPath);
      return [
        {
          fullPath,
          modifiedAt: stat.mtime.toISOString(),
          mtimeMs: stat.mtimeMs,
        },
      ];
    }),
  );
  return groups.flat();
}

// 최근 3일 이내에 수정된 파일만 대상으로 삼는다. 이전 동기화 이후 내용이 바뀐
// 파일이 하나도 없으면 hasChanges=false를 돌려줘서, 호출부가 Gemini 요약을
// 다시 돌리지 않고 이전 요약 결과를 그대로 유지하게 한다(요약 낭비 방지).
// 변경이 있을 때는 3일 이내 전체 목록을 돌려줘서, 3일이 지나 빠진 기사가
// 요약 대상에서 자연스럽게 제외되도록 한다.
async function readNewsFiles(directory, previousHashes) {
  const cutoff = Date.now() - NEWS_LOOKBACK_MS;
  const recentFiles = (await listNewsFiles(directory))
    .filter((file) => file.mtimeMs >= cutoff)
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
    .slice(0, 200);

  const fileHashes = {};
  const files = [];
  let hasChanges = false;
  for (const { fullPath, modifiedAt } of recentFiles) {
    const relativePath = path.relative(newsFolder, fullPath);
    const content = (await fs.promises.readFile(fullPath, 'utf8')).slice(
      0,
      30000,
    );
    const contentHash = crypto.createHash('sha1').update(content).digest('hex');
    fileHashes[relativePath] = contentHash;
    if (previousHashes[relativePath] !== contentHash) hasChanges = true;
    files.push({
      id: crypto
        .createHash('sha1')
        .update(`${relativePath}:${contentHash}`)
        .digest('hex'),
      name: relativePath,
      content,
      modifiedAt,
    });
  }
  return { files, fileHashes, hasChanges };
}

ipcMain.handle('news:collect-once-daily', async () => {
  const date = koreaDate();
  try {
    const sync = readNewsSync();
    if (sync.lastSyncedDate === date) {
      return { skipped: true, date, files: [], fileHashes: sync.fileHashes };
    }
    const { files, fileHashes, hasChanges } = await readNewsFiles(
      newsFolder,
      sync.fileHashes,
    );
    return { skipped: false, date, files: hasChanges ? files : [], fileHashes };
  } catch (error) {
    return {
      skipped: false,
      date,
      files: [],
      fileHashes: {},
      error: String(error),
    };
  }
});

ipcMain.handle('news:mark-synced', (_event, payload) => {
  const date = payload && typeof payload === 'object' ? payload.date : payload;
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(String(date))
    ? String(date)
    : koreaDate();
  const fileHashes =
    payload &&
    typeof payload === 'object' &&
    payload.fileHashes &&
    typeof payload.fileHashes === 'object'
      ? payload.fileHashes
      : {};
  fs.writeFileSync(
    newsSyncPath(),
    JSON.stringify({ lastSyncedDate: safeDate, fileHashes }, null, 2),
    'utf8',
  );
  return { ok: true };
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
