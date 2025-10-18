// preload.js
const { contextBridge, ipcRenderer } = require('electron');

console.log('🌉 [PRELOAD] ตั้งค่า Real-time APIs...');

const realtimeAPI = {
    // ===== Time / Weather / Agents =====
    getWorldTime: () => ipcRenderer.invoke('get-world-time'),
    getWeather: () => ipcRenderer.invoke('get-weather'),
    getMockAgents: () => ipcRenderer.invoke('get-mock-agents'),

    // ===== Agent Simulator =====
    startSimulator: () => ipcRenderer.invoke('start-agent-simulator'),
    stopSimulator: () => ipcRenderer.invoke('stop-agent-simulator'),
    onAgentStatusChanged: (cb) => {
        const listener = (_event, data) => cb?.(data);
        ipcRenderer.on('agent-status-changed', listener);
        // ฟังก์ชันยกเลิกการฟัง
        return () => ipcRenderer.removeListener('agent-status-changed', listener);
    },

    // ===== Desktop Notifications =====
    notify: (payload) => ipcRenderer.invoke('notify', payload),
    showNotification: (payload) => ipcRenderer.invoke('notify', payload), // compat alias

    // ===== Settings (ต้องมี handler ฝั่ง main: settings-load/save/reset) =====
    loadSettings: () => ipcRenderer.invoke('settings-load'),
    saveSettings: (partial) => ipcRenderer.invoke('settings-save', partial),
    resetSettings: () => ipcRenderer.invoke('settings-reset'),

    // ===== Tray / App control =====
    showApp: () => ipcRenderer.invoke('app-show'),
    hideApp: () => ipcRenderer.invoke('app-hide'),
    onTrayCommand: (callback) => {
        const listener = (_e, data) => callback?.(data);
        ipcRenderer.on('tray-command', listener);
        return () => ipcRenderer.removeListener('tray-command', listener);
    },
};

contextBridge.exposeInMainWorld('realtimeAPI', realtimeAPI);

console.log('✅ [PRELOAD] Real-time APIs พร้อมใช้งาน');
