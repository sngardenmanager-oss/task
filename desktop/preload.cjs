const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('snoopyDesktop', {
  collectRecentNews: () => ipcRenderer.invoke('news:collect-recent'),
  markNewsSynced: (snapshotId) =>
    ipcRenderer.invoke('news:mark-synced', snapshotId),
  refocusWindow: () => ipcRenderer.send('window:refocus'),
});

// Windows에서 confirm/alert/prompt 창이 닫힌 뒤 화면이 키보드·마우스 입력을
// 받지 못하는 Electron 버그가 있어, 대화상자가 닫히면 창 포커스를 다시 잡는다.
void webFrame.executeJavaScript(`
  (() => {
    for (const name of ['alert', 'confirm', 'prompt']) {
      const original = window[name];
      if (typeof original !== 'function') continue;
      window[name] = function (...args) {
        try {
          return original.apply(window, args);
        } finally {
          window.snoopyDesktop?.refocusWindow();
        }
      };
    }
  })();
`);
