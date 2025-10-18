// main.js
const path = require('path');
const fsSync = require('fs');             // ใช้ตัว sync สำหรับ existsSync
const fs = require('fs').promises;        // ใช้ promises สำหรับ read/write
const {
    app,
    BrowserWindow,
    ipcMain,
    dialog,
    Notification,
    Menu,
    Tray,
    nativeImage,
} = require('electron');

let mainWindow = null;
let tray = null;

function createTray() {
    // สร้าง icon (ใช้ไฟล์ ถ้าไม่มีให้ fallback เป็น empty)
    let trayIcon;
    try {
        trayIcon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png'));
        if (trayIcon.isEmpty()) throw new Error('icon not found');
    } catch {
        trayIcon = nativeImage.createEmpty();
    }

    if (process.platform === 'darwin') {
        trayIcon = trayIcon.resize({ width: 16, height: 16 });
        trayIcon.setTemplateImage(true); // macOS template icon (ปรับตาม Light/Dark)
    }

    tray = new Tray(trayIcon);
    const contextMenu = Menu.buildFromTemplate([
        {
            label: '📊 แสดง Wallboard',
            click: () => {
                if (!mainWindow) return;
                mainWindow.show();
                mainWindow.focus();
            },
        },
        {
            label: '🔄 เปลี่ยนสถานะ',
            submenu: [
                { label: '🟢 Available', click: () => changeAgentStatusFromTray('Available') },
                { label: '🔴 Busy', click: () => changeAgentStatusFromTray('Busy') },
                { label: '🟡 Break', click: () => changeAgentStatusFromTray('Break') },
            ],
        },
        { type: 'separator' },
        { label: '❌ ออกจากโปรแกรม', click: () => app.quit() },
    ]);
    tray.setContextMenu(contextMenu);
    tray.setToolTip('Agent Wallboard - Desktop App');

    tray.on('click', () => {
        if (!mainWindow) return;
        if (mainWindow.isVisible()) mainWindow.hide();
        else { mainWindow.show(); mainWindow.focus(); }
    });
    console.log('✅ [MAIN] System tray พร้อมแล้ว');
}

function changeAgentStatusFromTray(status) {
    console.log('🔄 [TRAY] เปลี่ยนสถานะเป็น:', status);
    if (mainWindow) {
        mainWindow.webContents.send('status-changed-from-tray', {
            newStatus: status,
            timestamp: new Date().toISOString(),
        });
    }
    new Notification({
        title: 'สถานะเปลี่ยนแล้ว',
        body: `เปลี่ยนสถานะเป็น ${status} แล้ว`,
        icon: path.join(__dirname, 'assets', 'notification.png'),
    }).show();
}

function createWindow() {
    console.log('🚀 [MAIN] สร้าง window...');
    const preloadPath = path.join(__dirname, 'preload.js');
    console.log('[MAIN] preload path:', preloadPath, 'exists?', fsSync.existsSync(preloadPath));

    mainWindow = new BrowserWindow({
        width: 1000,
        height: 700,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            // **สำคัญ**: ต้องชี้ไปที่ไฟล์ที่มีอยู่จริง
            preload: preloadPath,
            // ถ้าเคยเปิด sandbox:true แล้วมีปัญหา ให้ปิดไปก่อน
            // sandbox: false,
        },
    });

    mainWindow.loadFile('index.html');
    mainWindow.webContents.openDevTools();

    // กด X → ซ่อนไป tray (ไม่ปิดแอป)
    mainWindow.on('close', (event) => {
        if (!app.isQuiting) {
            event.preventDefault();
            mainWindow.hide();
            if (process.platform === 'win32') {
                new Notification({
                    title: 'Agent Wallboard',
                    body: 'แอปยังทำงานอยู่ใน system tray',
                }).show();
            }
        }
    });

    console.log('✅ [MAIN] Window พร้อมแล้ว');
}

/** ====== APP LIFECYCLE ====== **/
app.setAppUserModelId('com.abgio.agentwallboard'); // Windows: ให้ Notification ทำงานถูก

app.whenReady().then(() => {
    createWindow();
    createTray();

    // macOS: คลิกไอคอน Dock ถ้าไม่มีหน้าต่าง ให้สร้างใหม่
    app.on('activate', () => {
        if (!mainWindow) createWindow();
        else mainWindow.show();
    });
});

// อย่าปิดแอปเมื่อปิดหน้าต่างสุดท้าย (ให้คง tray)
app.on('window-all-closed', () => {
    // no-op เพื่อให้ tray อยู่ต่อ (ทั้ง Win/macOS)
});

app.on('before-quit', () => {
    app.isQuiting = true;
});

/** ====== IPC HANDLERS (ต้องตรงสัญญากับ preload/renderer) ====== **/

// 📂 เปิดไฟล์
ipcMain.handle('open-file', async () => {
    console.log('📂 [MAIN] เปิด file dialog...');
    try {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openFile'],
            filters: [
                { name: 'Text Files', extensions: ['txt', 'json', 'csv'] },
                { name: 'All Files', extensions: ['*'] },
            ],
        });

        if (!result.canceled && result.filePaths[0]) {
            const filePath = result.filePaths[0];
            const content = await fs.readFile(filePath, 'utf8');
            console.log('✅ [MAIN] อ่านไฟล์สำเร็จ:', path.basename(filePath));
            return {
                success: true,
                fileName: path.basename(filePath),
                filePath,
                content,
                size: content.length,
            };
        }
        return { success: false, cancelled: true };
    } catch (error) {
        console.error('❌ [MAIN] Error:', error);
        return { success: false, error: error.message };
    }
});

// 💾 บันทึกไฟล์
ipcMain.handle('save-file', async (_event, { content, fileName = 'export.txt' }) => {
    console.log('💾 [MAIN] บันทึกไฟล์...');
    try {
        const result = await dialog.showSaveDialog(mainWindow, {
            defaultPath: fileName,
            filters: [
                { name: 'Text Files', extensions: ['txt'] },
                { name: 'CSV Files', extensions: ['csv'] },
                { name: 'JSON Files', extensions: ['json'] },
            ],
        });
        if (!result.canceled && result.filePath) {
            await fs.writeFile(result.filePath, content, 'utf8');
            console.log('✅ [MAIN] บันทึกสำเร็จ:', path.basename(result.filePath));
            return { success: true, fileName: path.basename(result.filePath), filePath: result.filePath };
        }
        return { success: false, cancelled: true };
    } catch (error) {
        console.error('❌ [MAIN] Error:', error);
        return { success: false, error: error.message };
    }
});

// 🔔 Notification พื้นฐาน
ipcMain.handle('show-notification', (_event, { title, body, urgent = false }) => {
    console.log('🔔 [MAIN] แสดง notification:', title);
    try {
        const notification = new Notification({
            title,
            body,
            icon: path.join(__dirname, 'assets', 'notification.png'),
            urgency: urgent ? 'critical' : 'normal',
            timeoutType: urgent ? 'never' : 'default',
        });
        notification.show();
        notification.on('click', () => {
            if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
        });
        return { success: true };
    } catch (error) {
        console.error('❌ [MAIN] Error notification:', error);
        return { success: false, error: error.message };
    }
});

// 📢 Agent Events → notification แบบกำหนดข้อความ
ipcMain.handle('notify-agent-event', (_event, { agentName, eventType, details = {} }) => {
    console.log('📢 [MAIN] Agent event notification:', agentName, eventType);
    const eventMessages = {
        login: `🟢 ${agentName} เข้าสู่ระบบแล้ว`,
        logout: `🔴 ${agentName} ออกจากระบบแล้ว`,
        status_change: `🔄 ${agentName} เปลี่ยนสถานะเป็น ${details.newStatus}`,
        call_received: `📞 ${agentName} รับสายใหม่`,
        call_ended: `📞 ${agentName} จบการโทร (${details.duration} วินาที)`,
    };
    const notification = new Notification({
        title: 'Agent Wallboard Update',
        body: eventMessages[eventType] || `📊 ${agentName}: ${eventType}`,
        icon: path.join(__dirname, 'assets', 'notification.png'),
    });
    notification.show();
    notification.on('click', () => {
        if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
    });
    return { success: true };
});

// 🧰 ซ่อนไป tray / แสดงกลับ
ipcMain.on('hide-to-tray', () => {
    if (mainWindow) {
        mainWindow.hide();
        if (process.platform === 'win32') {
            new Notification({ title: 'Agent Wallboard', body: 'App is running in the system tray' }).show();
        }
    }
});
ipcMain.on('show-app', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
});
