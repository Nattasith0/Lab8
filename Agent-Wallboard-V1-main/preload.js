// preload.js
const { contextBridge, ipcRenderer } = require('electron');

// -------------------- Lab 8.2: Agent Management --------------------
contextBridge.exposeInMainWorld('electronAPI', {
  getAgents: () => ipcRenderer.invoke('get-agents'),
  updateAgentStatus: (id, status) => ipcRenderer.invoke('update-agent-status', id, status),

  // -------------------- Lab 8.3: File Export + Notifications --------------------
  exportData: (data) => ipcRenderer.invoke('export-data', data),

  // -------------------- Lab 8.4: API Calls --------------------
  apiCall: (url) => ipcRenderer.invoke('api-call', url),
});

// -------------------- Real-time API --------------------
contextBridge.exposeInMainWorld('realtimeAPI', {
  // Settings
  loadSettings: () => ipcRenderer.invoke('rt-load-settings'),
  saveSettings: (s) => ipcRenderer.invoke('rt-save-settings', s),
  resetSettings: () => ipcRenderer.invoke('rt-reset-settings'),

  // APIs
  getWorldTime: () => ipcRenderer.invoke('rt-world-time'),
  getWeather: () => ipcRenderer.invoke('rt-weather'),
  getMockAgents: () => ipcRenderer.invoke('rt-mock-agents'),

  // Notifications
  notify: (opts) => ipcRenderer.invoke('rt-notify', opts),

  // Simulator control
  startSimulator: () => ipcRenderer.invoke('rt-sim-start'),
  stopSimulator: () => ipcRenderer.invoke('rt-sim-stop'),

  // Events: Agent status change
  onAgentStatusChanged: (cb) => {
    ipcRenderer.removeAllListeners('rt-agent-status');
    ipcRenderer.on('rt-agent-status', (_e, payload) => cb?.(payload));
  },

  // Events: Tray command
  onTrayCommand: (cb) => {
    ipcRenderer.removeAllListeners('rt-tray-cmd');
    ipcRenderer.on('rt-tray-cmd', (_e, payload) => cb?.(payload));
  },
});
