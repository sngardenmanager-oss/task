const { app, BrowserWindow, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const configPath = path.join(__dirname, 'site-url.json');
const configuredUrl = JSON.parse(fs.readFileSync(configPath, 'utf8')).url;
const appUrl = process.env.SNOOPY_CALENDAR_URL || configuredUrl;
const smokeTest = process.argv.includes('--smoke-test');
const outputArgument = process.argv.find((value) => value.startsWith('--smoke-output='));
const smokeOutput = outputArgument?.slice('--smoke-output='.length);

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
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  window.webContents.once('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
    if (!smokeTest) return;
    writeSmokeResult({ ok: false, errorCode, errorDescription, url: validatedUrl });
    app.exit(1);
  });

  window.webContents.once('did-finish-load', async () => {
    if (!smokeTest) return;
    try {
      const result = await window.webContents.executeJavaScript(`({
        title: document.title,
        heading: document.querySelector('h1')?.textContent?.trim() || '',
        buttonCount: document.querySelectorAll('button').length,
        bodyLength: document.body.innerText.length,
        url: location.href
      })`);
      writeSmokeResult({ ok: result.buttonCount > 0 && result.bodyLength > 100, ...result });
      app.exit(result.buttonCount > 0 && result.bodyLength > 100 ? 0 : 1);
    } catch (error) {
      writeSmokeResult({ ok: false, error: String(error) });
      app.exit(1);
    }
  });

  window.loadURL(appUrl);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

