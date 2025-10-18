// main.js
const { app, BrowserWindow, ipcMain, Notification, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const https = require('https');
const fs = require('fs').promises;
const config = require('./api-config');

let mainWindow;
let tray = null;
let isQuiting = false;

// ---------- Window ----------
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        title: 'Agent Wallboard - Real-time Dashboard',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
        },
    });

    mainWindow.loadFile('index.html');
    mainWindow.webContents.openDevTools();

    // Close → hide to tray (Windows/Linux). macOS ใช้แถบเมนูแทน
    mainWindow.on('close', (e) => {
        if (isQuiting) return;
        e.preventDefault();
        mainWindow.hide();
    });
}

// ---------- Tray ----------
function getTrayIcon() {
    const candidate = ['trayTemplate.png', 'tray.png', 'icon.png'].map((n) => path.join(__dirname, n));
    for (const p of candidate) {
        try {
            const img = nativeImage.createFromPath(p);
            if (!img.isEmpty()) return img;
        } catch { }
    }
    return nativeImage.createEmpty();
}

function createTray() {
    if (tray) return tray;
    const icon = getTrayIcon();
    tray = new Tray(icon);
    tray.setToolTip('Agent Wallboard');

    const ctx = Menu.buildFromTemplate([
        { label: 'Show', click: () => mainWindow.show() },
        { label: 'Hide', click: () => mainWindow.hide() },
        { type: 'separator' },
        { label: 'Connect WebSocket', click: () => mainWindow.webContents.send('tray-command', { cmd: 'connect-ws' }) },
        { label: 'Toggle Auto Refresh', click: () => mainWindow.webContents.send('tray-command', { cmd: 'toggle-auto' }) },
        { label: 'Start Simulator', click: () => mainWindow.webContents.send('tray-command', { cmd: 'sim-start' }) },
        { label: 'Stop Simulator', click: () => mainWindow.webContents.send('tray-command', { cmd: 'sim-stop' }) },
        { type: 'separator' },
        { label: 'Toggle Theme', click: () => mainWindow.webContents.send('tray-command', { cmd: 'toggle-theme' }) },
        { type: 'separator' },
        { label: 'Open DevTools', click: () => mainWindow.webContents.openDevTools() },
        { label: 'Quit', click: () => { isQuiting = true; app.quit(); } },
    ]);
    tray.setContextMenu(ctx);

    tray.on('double-click', () => {
        if (mainWindow.isVisible()) mainWindow.hide();
        else mainWindow.show();
    });

    return tray;
}

// ---------- Helpers ----------
function callAPI(url) {
    return new Promise((resolve, reject) => {
        https
            .get(url, (res) => {
                let data = '';
                res.on('data', (ch) => (data += ch));
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(e);
                    }
                });
            })
            .on('error', reject);
    });
}

function getSettingsFile() {
    return path.join(app.getPath('userData'), 'settings.json');
}

// ---------- IPC: Time/Users/Weather ----------
ipcMain.handle('get-world-time', async () => {
    const localNow = new Date();
    const localTZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local';
    try {
        const t = await callAPI(config.timeAPI);
        // รองรับหลายชื่อฟิลด์จาก API ต่าง ๆ
        const iso = t.datetime || t.utc_datetime || t.currentDateTime || t.dateTime || null;
        const tz = t.timezone || t.timeZone || t.zone || t.abbreviation || localTZ;

        const dt = iso ? new Date(iso) : localNow;
        const valid = !isNaN(dt.getTime());
        const finalDate = valid ? dt : localNow;

        let formatted;
        try {
            formatted = finalDate.toLocaleString('th-TH', { timeZone: tz || localTZ });
        } catch {
            formatted = finalDate.toLocaleString('th-TH');
        }

        return {
            success: true,
            datetime: finalDate.toISOString(),
            timezone: tz || localTZ,
            formatted,
            source: valid ? 'api' : 'local-fallback',
        };
    } catch (error) {
        return {
            success: true,
            datetime: localNow.toISOString(),
            timezone: localTZ,
            formatted: localNow.toLocaleString('th-TH'),
            source: 'local-fallback',
            note: error.message,
        };
    }
});

ipcMain.handle('get-mock-agents', async () => {
    try {
        const users = await callAPI(config.usersAPI);
        const agents = users.slice(0, 5).map((user, idx) => {
            const statuses = ['Available', 'Busy', 'Break', 'Offline'];
            const s = statuses[Math.floor(Math.random() * statuses.length)];
            return {
                id: `AG${String(idx + 1).padStart(3, '0')}`,
                name: user.name,
                email: user.email,
                phone: user.phone,
                status: s,
                extension: `100${idx + 1}`,
                company: user.company.name,
                lastUpdate: new Date().toISOString(),
            };
        });
        return { success: true, agents, count: agents.length, timestamp: new Date().toISOString() };
    } catch (error) {
        const mockData = await fs.readFile('mock-data.json', 'utf8').catch(() => null);
        if (mockData) {
            const fallback = JSON.parse(mockData);
            return { success: true, agents: fallback.agents, fallback: true, error: error.message };
        }
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-weather', async () => {
    if (config.weatherKey === 'YOUR_API_KEY_HERE') {
        return {
            success: false,
            error: 'ไม่ได้ตั้งค่า Weather API key',
            fallback: { location: 'Bangkok', temperature: '32°C', description: 'Sunny', humidity: '65%' },
        };
    }
    try {
        const weatherURL = `${config.weatherAPI}?q=Bangkok&appid=${config.weatherKey}&units=metric`;
        const w = await callAPI(weatherURL);
        return {
            success: true,
            location: w.name,
            temperature: Math.round(w.main.temp) + '°C',
            description: w.weather[0].description,
            humidity: w.main.humidity + '%',
            icon: w.weather[0].icon,
        };
    } catch (error) {
        return {
            success: false,
            error: error.message,
            fallback: { location: 'Bangkok', temperature: '32°C', description: 'Data unavailable', humidity: 'N/A' },
        };
    }
});

// ---------- Simulator ----------
let agentStatusInterval = null;

ipcMain.handle('start-agent-simulator', () => {
    if (agentStatusInterval) clearInterval(agentStatusInterval);
    const statuses = ['Available', 'Busy', 'Break'];
    const agentIds = ['AG001', 'AG002', 'AG003'];
    agentStatusInterval = setInterval(() => {
        const id = agentIds[Math.floor(Math.random() * agentIds.length)];
        const st = statuses[Math.floor(Math.random() * statuses.length)];
        mainWindow.webContents.send('agent-status-changed', {
            agentId: id,
            newStatus: st,
            timestamp: new Date().toISOString(),
            simulated: true,
        });
    }, 10000);
    return { success: true, message: 'Agent Simulator เริ่มทำงานแล้ว' };
});

ipcMain.handle('stop-agent-simulator', () => {
    if (agentStatusInterval) clearInterval(agentStatusInterval);
    agentStatusInterval = null;
    return { success: true, message: 'Agent Simulator หยุดแล้ว' };
});

// ---------- Notifications ----------
ipcMain.handle('notify', (_e, payload) => {
    const n = new Notification({
        title: payload?.title || 'Agent Wallboard',
        body: payload?.body || '',
        silent: !!payload?.silent,
    });
    n.show();
    return { success: true };
});

// ---------- Settings (load/save/reset) ----------
ipcMain.handle('settings-load', async () => {
    try {
        const file = getSettingsFile();
        const data = await fs.readFile(file, 'utf8');
        return { success: true, settings: JSON.parse(data) };
    } catch {
        // ค่าเริ่มต้น
        return {
            success: true,
            settings: { theme: 'dark', autoRefresh: false, autoRefreshMs: 30000, wsAutoConnect: false },
        };
    }
});

ipcMain.handle('settings-save', async (_e, newSettings) => {
    try {
        const file = getSettingsFile();
        await fs.writeFile(file, JSON.stringify(newSettings, null, 2), 'utf8');
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('settings-reset', async () => {
    try {
        const file = getSettingsFile();
        await fs.unlink(file);
    } catch {
        // no-op
    }
    return { success: true };
});

// ---------- App show/hide from renderer ----------
ipcMain.handle('app-show', () => {
    mainWindow.show();
    return { success: true };
});
ipcMain.handle('app-hide', () => {
    mainWindow.hide();
    return { success: true };
});

// ---------- App lifecycle ----------
app.whenReady().then(() => {
    createWindow();
    createTray();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow.show();
});

app.on('before-quit', () => {
    isQuiting = true;
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
