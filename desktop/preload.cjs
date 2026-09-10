const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('snoopyDesktop', {
  collectRecentNews: () => ipcRenderer.invoke('news:collect-recent'),
  markNewsSynced: (snapshotId) =>
    ipcRenderer.invoke('news:mark-synced', snapshotId),
});
