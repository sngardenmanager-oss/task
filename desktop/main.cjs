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

// 최근 3일 이내에 수정된 파일 전체를 매번 다시 스캔해서 돌려준다. 동기화
// 상태를 저장하지 않으므로 프로그램을 열 때마다 최신 목록을 그대로 얻는다.
async function readNewsFiles(directory) {
  const cutoff = Date.now() - NEWS_LOOKBACK_MS;
  const recentFiles = (await listNewsFiles(directory))
    .filter((file) => file.mtimeMs >= cutoff)
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));

  return Promise.all(
    recentFiles.map(async ({ fullPath, modifiedAt, mtimeMs }) => {
      const relativePath = path.relative(newsFolder, fullPath);
      const content = (await fs.promises.readFile(fullPath, 'utf8')).slice(
        0,
        30000,
      );
      return {
        id: crypto
          .createHash('sha1')
          .update(`${relativePath}:${mtimeMs}`)
          .digest('hex'),
        name: relativePath,
        content,
        modifiedAt,
      };
    }),
  );
}

ipcMain.handle('news:collect-recent', async () => {
  try {
    const files = await readNewsFiles(newsFolder);
    return { files };
  } catch (error) {
    return { files: [], error: String(error) };
  }
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
