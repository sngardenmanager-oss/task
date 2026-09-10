const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('snoopyDesktop', {
  collectNewsOnceDaily: () => ipcRenderer.invoke('news:collect-once-daily'),
  markNewsSynced: (payload) => ipcRenderer.invoke('news:mark-synced', payload),
});
