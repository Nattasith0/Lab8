// main.js - Main Process (เสมือน backend)
const { app, BrowserWindow } = require('electron');

// ตัวแปรเก็บ window
let mainWindow;

// ฟังก์ชันสร้าง window
function createWindow() {
    console.log('🚀 กำลังสร้าง window...');

    // สร้าง browser window
    mainWindow = new BrowserWindow({
        width: 800,           // ความกว้าง
        height: 600,          // ความสูง
        webPreferences: {
            nodeIntegration: false,    // ปิดเพื่อความปลอดภัย
            contextIsolation: true     // เปิดเพื่อความปลอดภัย
        }
    });

    // โหลดไฟล์ HTML
    mainWindow.loadFile('index.html');

    // แสดงข้อความเมื่อ window ถูกปิด
    mainWindow.on('closed', () => {
        console.log('❌ Window ถูกปิดแล้ว');
        mainWindow = null;
    });

    console.log('✅ สร้าง window สำเร็จ!');
}

// เมื่อ Electron พร้อมทำงาน
app.whenReady().then(() => {
    console.log('⚡ Electron พร้อมทำงาน');
    createWindow();
});

// เมื่อปิด window ทั้งหมด
app.on('window-all-closed', () => {
    console.log('🔴 ปิด window ทั้งหมดแล้ว');

    // ใน macOS, app จะไม่ปิดทันที
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// ใน macOS, เมื่อคลิก dock icon
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});