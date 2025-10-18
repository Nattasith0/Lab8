// ===== Core =====
const { app, BrowserWindow, ipcMain, Tray, Menu, Notification, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ===== Updater =====
const { autoUpdater } = require('electron-updater');
const isDev = !app.isPackaged;

// ===== HTTP (CommonJS) =====
// ใช้ node-fetch v2 สำหรับ CommonJS (แนะนำให้ล็อกเวอร์ชัน ^2.6.7)
const fetch = require('node-fetch');

let mainWindow, tray;

// ---------- config & paths ----------
let apiConfig = {};
try {
  apiConfig = require('./api-config'); // ถ้าไม่มีไฟล์นี้ จะใช้ fallback
} catch { }

const appPath = app.isPackaged ? process.resourcesPath : __dirname;
const MOCK_JSON = path.join(appPath, 'mock-data.json');
const SETTINGS_FILE = path.join(app.getPath('userData'), 'realtime-settings.json');

// ---------- Single instance lock (กันเปิดซ้อน) ----------
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ---------- window ----------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, 'assets/icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  global.mainWindow = mainWindow;

  mainWindow.loadFile('index.html');

  // intercept close → hide to tray
  mainWindow.on('close', (e) => {
    if (!app.isQuiting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  createTray();
  augmentTrayMenu();
}

// ---------- tray ----------
function createTray() {
  tray = new Tray(path.join(__dirname, 'assets/icon.ico'));
  tray.setToolTip('Agent Wallboard');
  tray.on('double-click', () => mainWindow.show());
}

function sendTrayCmd(cmd) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('rt-tray-cmd', { cmd });
  }
}

function augmentTrayMenu(updateState = {}) {
  if (!tray) return;
  const { canInstall = false } = updateState;
  const ctx = Menu.buildFromTemplate([
    { label: 'Show', click: () => mainWindow.show() },
    { label: 'Hide', click: () => mainWindow.hide() },
    { type: 'separator' },
    { label: 'Connect WS', click: () => sendTrayCmd('connect-ws') },
    { label: 'Toggle Auto Refresh', click: () => sendTrayCmd('toggle-auto') },
    { label: 'Simulator Start', click: () => sendTrayCmd('sim-start') },
    { label: 'Simulator Stop', click: () => sendTrayCmd('sim-stop') },
    { label: 'Toggle Theme', click: () => sendTrayCmd('toggle-theme') },
    { type: 'separator' },
    // ===== Updater actions =====
    { label: 'Check for Updates', click: () => checkForUpdatesManual() },
    { label: 'Install Update (if ready)', enabled: !!canInstall, click: () => autoUpdater.quitAndInstall() },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuiting = true; app.quit(); } }
  ]);
  tray.setContextMenu(ctx);
}

// ---------- Small JSON utils ----------
const defaultSettings = { theme: 'light', autoRefresh: true };
function readJSONSafe(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJSONSafe(file, obj) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
  } catch { }
}

// ---------- Lab8 base IPC ----------
ipcMain.handle('get-agents', async () => ([
  { id: 1, name: 'John Smith', status: 'available' },
  { id: 2, name: 'Jane Doe', status: 'busy' },
  { id: 3, name: 'Mike Johnson', status: 'offline' }
]));

ipcMain.handle('update-agent-status', async (_e, agentId, status) => {
  new Notification({ title: 'Status Updated', body: `Agent ${agentId} is now ${status}` }).show();
  return { success: true };
});

ipcMain.handle('export-data', async (_e, data) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: 'agents-export.csv',
    filters: [{ name: 'CSV Files', extensions: ['csv'] }]
  });
  if (!result.canceled && result.filePath) {
    const csv = (data || []).map(a => `${a.name},${a.status}`).join('\n');
    fs.writeFileSync(result.filePath, `Name,Status\n${csv}`);
    return { success: true, path: result.filePath };
  }
  return { success: false };
});

ipcMain.handle('api-call', async (_e, url) => {
  try {
    const r = await fetch(url);
    const data = await r.json();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ---------- Lab4: settings ----------
ipcMain.handle('rt-load-settings', async () => ({ success: true, settings: readJSONSafe(SETTINGS_FILE, defaultSettings) }));
ipcMain.handle('rt-save-settings', async (_e, s) => { writeJSONSafe(SETTINGS_FILE, s || defaultSettings); return { success: true }; });
ipcMain.handle('rt-reset-settings', async () => { writeJSONSafe(SETTINGS_FILE, defaultSettings); return { success: true }; });

// ---------- Lab4: world time ----------
ipcMain.handle('rt-world-time', async () => {
  try {
    const res = await fetch(apiConfig.timeAPI);
    const data = await res.json();
    return { success: true, formatted: data.datetime, timezone: data.timezone };
  } catch (e) {
    return { success: false, error: e.message, fallback: new Date().toISOString() };
  }
});

// ---------- Lab4: weather ----------
ipcMain.handle('rt-weather', async () => {
  const hasOWM = apiConfig?.weatherAPI && apiConfig?.weatherKey;
  try {
    if (!hasOWM) {
      return { success: true, location: os.hostname(), temperature: '29°C', description: 'Partly Cloudy', humidity: '65%' };
    }
    const params = new URLSearchParams({
      q: apiConfig.weatherCity || 'Bangkok',
      appid: apiConfig.weatherKey,
      units: apiConfig.weatherUnits || 'metric',
      lang: apiConfig.weatherLang || 'th'
    });
    const r = await fetch(`${apiConfig.weatherAPI}?${params.toString()}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data?.message || 'Weather API failed');
    return {
      success: true,
      location: data.name,
      temperature: `${data.main.temp}°C`,
      description: data.weather?.[0]?.description || '—',
      humidity: `${data.main.humidity}%`
    };
  } catch (e) {
    return { success: false, error: e.message, fallback: { location: 'Bangkok', temperature: '30°C', description: 'Cloudy' } };
  }
});

// ====== Agent IDs cache (ใช้กับ Simulator) ======
let agentIds = [];  // eg. ["AG001","AG002",...]
function updateAgentIdsFrom(agents = []) {
  agentIds = (agents || []).map(a => a.id).filter(Boolean);
}
// โหลดรอบแรกจากไฟล์ (ถ้ามี)
try {
  const rawInit = fs.readFileSync(MOCK_JSON, 'utf8');
  const initData = JSON.parse(rawInit);
  updateAgentIdsFrom(initData.agents || []);
} catch { }
// auto-refresh ids เมื่อแก้ mock-data.json
fs.watchFile(MOCK_JSON, { interval: 1500 }, () => {
  try {
    const raw = fs.readFileSync(MOCK_JSON, 'utf8');
    const d = JSON.parse(raw);
    updateAgentIdsFrom(d.agents || []);
    console.log('♻️ refreshed agentIds from mock-data.json:', agentIds);
  } catch { }
});

// ---------- Lab4: mock agents ----------
ipcMain.handle('rt-mock-agents', async () => {
  try {
    if (apiConfig?.mockAgentAPI?.status) {
      const r = await fetch(apiConfig.mockAgentAPI.status, { timeout: 3000 });
      if (r.ok) {
        const data = await r.json();
        const agents = Array.isArray(data) ? data : (data.agents || []);
        const count = data.count || agents.length;
        const systemStats = data.systemStats || {};
        return { success: true, agents, count, systemStats, fallback: false };
      }
    }
  } catch { }
  try {
    const raw = fs.readFileSync(MOCK_JSON, 'utf8');
    const data = JSON.parse(raw);
    const agents = data.agents || [];
    const count = agents.length;
    const systemStats = data.systemStats || {};
    updateAgentIdsFrom(agents);             // ✅ sync รายชื่อให้ simulator
    return { success: true, agents, count, systemStats, fallback: true };
  } catch (e) {
    return { success: false, error: e.message, agents: [], count: 0, fallback: true };
  }
});

// ---------- update agent ----------
ipcMain.handle('rt-update-agent', async (_e, payload) => {
  try {
    if (!apiConfig?.mockAgentAPI?.update) throw new Error('No update endpoint configured');
    const r = await fetch(apiConfig.mockAgentAPI.update, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
    const data = await r.json().catch(() => ({}));
    return { success: r.ok, data, status: r.status };
  } catch (e) { return { success: false, error: e.message }; }
});

// ---------- Lab4: notifications ----------
ipcMain.handle('rt-notify', async (_e, opts) => {
  new Notification({
    title: (opts && opts.title) || 'Agent Wallboard',
    body: (opts && opts.body) || ''
  }).show();
  return { success: true };
});

// ---------- Lab4: simulator ----------
let simInterval = null;
ipcMain.handle('rt-sim-start', async () => {
  if (simInterval) clearInterval(simInterval);
  const pool = ['Available', 'Busy', 'Break', 'Offline'];
  simInterval = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const ids = (agentIds && agentIds.length) ? agentIds : ['AG001', 'AG002', 'AG003'];
    const agentId = ids[Math.floor(Math.random() * ids.length)];
    const newStatus = pool[Math.floor(Math.random() * pool.length)];

    mainWindow.webContents.send('rt-agent-status', {
      agentId, newStatus, timestamp: Date.now()
    });
  }, 5000);
  return { success: true, running: true };
});

ipcMain.handle('rt-sim-stop', async () => {
  if (simInterval) { clearInterval(simInterval); simInterval = null; }
  return { success: true, running: false };
});

// ---------- Auto Updater ----------
function wireAutoUpdaterEvents() {
  if (isDev) return;

  // สามารถเปิด pre-release ได้ถ้าต้องการทดสอบ: autoUpdater.allowPrerelease = true;
  autoUpdater.autoDownload = true; // ดาวน์โหลดอัตโนมัติ

  autoUpdater.on('checking-for-update', () => {
    mainWindow?.webContents.send('update:status', 'กำลังตรวจสอบอัปเดต…');
  });

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update:status', `พบอัปเดต ${info.version} กำลังดาวน์โหลด…`);
  });

  autoUpdater.on('download-progress', (p) => {
    mainWindow?.webContents.send('update:progress', Math.round(p.percent));
  });

  autoUpdater.on('update-not-available', () => {
    mainWindow?.webContents.send('update:status', 'ยังไม่มีอัปเดตใหม่');
  });

  autoUpdater.on('update-downloaded', async (info) => {
    mainWindow?.webContents.send('update:status', `ดาวน์โหลด ${info.version} แล้ว พร้อมติดตั้ง`);
    augmentTrayMenu({ canInstall: true }); // เปิดเมนู Install
    const res = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['ติดตั้งและรีสตาร์ท', 'ภายหลัง'],
      defaultId: 0, cancelId: 1,
      title: 'มีอัปเดตพร้อมติดตั้ง',
      message: `เวอร์ชัน ${info.version} ดาวน์โหลดเสร็จแล้ว ต้องการติดตั้งเลยหรือไม่?`
    });
    if (res.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.on('error', (err) => {
    mainWindow?.webContents.send('update:status', `อัปเดตผิดพลาด: ${err.message}`);
  });
}

function checkForUpdatesAtStartup() {
  if (isDev) return;
  // รอให้ window พร้อมก่อน
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch((e) => {
      mainWindow?.webContents.send('update:status', `ตรวจสอบอัปเดตล้มเหลว: ${e.message}`);
    });
  }, 2000);
}

function checkForUpdatesManual() {
  if (isDev) {
    dialog.showMessageBox({ type: 'info', message: 'Dev mode: ไม่เช็คอัปเดต' });
    return;
  }
  mainWindow?.webContents.send('update:status', 'กำลังเช็คอัปเดตแบบแมนนวล…');
  autoUpdater.checkForUpdates().catch((e) => {
    mainWindow?.webContents.send('update:status', `ตรวจสอบอัปเดตล้มเหลว: ${e.message}`);
  });
}

// ---------- lifecycle ----------
app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.yourcompany.agent-wallboard');
  createWindow();
  wireAutoUpdaterEvents();
  checkForUpdatesAtStartup();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
