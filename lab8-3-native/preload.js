// preload.js (CommonJS)
const { contextBridge, ipcRenderer } = require("electron");

console.log("🌉 [PRELOAD] ตั้งค่า Native APIs...");

// รวมฟังก์ชันทั้งหมดไว้ใน object เดียว
const api = {
    // 📁 File Operations
    openFile: () => {
        console.log("📁 [PRELOAD] openFile");
        return ipcRenderer.invoke("open-file");
    },
    saveFile: (content, fileName) => {
        console.log("💾 [PRELOAD] saveFile");
        return ipcRenderer.invoke("save-file", { content, fileName });
    },

    // 🔔 Notifications
    showNotification: (title, body, urgent = false) => {
        console.log("🔔 [PRELOAD] showNotification:", title);
        return ipcRenderer.invoke("show-notification", { title, body, urgent });
    },
    notifyAgentEvent: (agentName, eventType, details = {}) => {
        console.log("📢 [PRELOAD] notifyAgentEvent:", agentName, eventType);
        return ipcRenderer.invoke("notify-agent-event", {
            agentName,
            eventType,
            details,
        });
    },

    // 🖱️ System Tray
    onStatusChangedFromTray: (callback) => {
        console.log("🖱️ [PRELOAD] onStatusChangedFromTray: register listener");
        if (typeof callback !== "function") return;
        const listener = (_event, data) => callback(data);
        ipcRenderer.on("status-changed-from-tray", listener);
        // คืน disposer สำหรับยกเลิกได้
        return () =>
            ipcRenderer.removeListener("status-changed-from-tray", listener);
    },
    hideToTray: () => ipcRenderer.send("hide-to-tray"),
    showApp: () => ipcRenderer.send("show-app"),
};

try {
    // กันการ expose ซ้ำ (เช่นเวลามี HMR หรือมีสคริปต์โหลดซ้ำ)
    if (!("nativeAPI" in window)) {
        contextBridge.exposeInMainWorld("nativeAPI", api);
        console.log("✅ [PRELOAD] Native APIs พร้อมใช้งาน");
    } else {
        console.warn("⚠️ [PRELOAD] window.nativeAPI มีอยู่แล้ว ข้ามการ expose ซ้ำ");
    }
} catch (err) {
    console.error("❌ [PRELOAD] exposeInMainWorld failed:", err);
}
