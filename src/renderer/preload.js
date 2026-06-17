const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onGameUpdate: (callback) => {
    ipcRenderer.on('game-update', (event, data) => callback(data));
  },
  onNewSession: (callback) => {
    ipcRenderer.on('new-session', (event, path) => callback(path));
  },
  onHearthstoneStatus: (callback) => {
    ipcRenderer.on('hearthstone-status', (event, running) => callback(running));
  },
  onMatchesImported: (callback) => {
    ipcRenderer.on('matches-imported', () => callback());
  },
  onLogSizeStatus: (callback) => {
    ipcRenderer.on('log-size-status', (event, data) => callback(data));
  },
  restartTracking: () => {
    ipcRenderer.send('restart-tracking', true);
  },
  getMatchLibrary: () => ipcRenderer.invoke('get-match-library'),
  deleteMatch: (gameId) => ipcRenderer.invoke('delete-match', gameId)
});
