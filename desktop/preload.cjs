const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('snoopyDesktop', {
  collectNewsOnceDaily: () => ipcRenderer.invoke('news:collect-once-daily'),
  markNewsSynced: (date) => ipcRenderer.invoke('news:mark-synced', date),
});
