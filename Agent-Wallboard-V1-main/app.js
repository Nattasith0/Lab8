// app.js (final updated, fixed braces)

let agents = [];
let simRunning = false; // ใช้กันไม่ให้ auto-refresh ทับ simulator

// ---------- Utils ----------
const toLowerStatus = (s) => (s || '').toString().trim().toLowerCase();
const displayStatus = (s) => {
    const m = toLowerStatus(s);
    if (m === 'break') return 'break';
    if (m === 'busy') return 'busy';
    if (m === 'offline') return 'offline';
    return 'available';
};

// ค้นหา agent ด้วย id ที่อาจเป็นตัวเลขหรือสตริง (เช่น "AG001")
function findAgentByFlexibleId(id) {
    let ag = agents.find(a => a.id === id);
    if (ag) return ag;
    if (typeof id === 'string' && agents.length > 0) {
        const idx = parseInt(id.replace(/\D/g, ''), 10);
        if (!Number.isNaN(idx)) {
            ag = agents.find(a => a.id === idx);
            if (ag) return ag;
        }
    }
    return null;
}

// ถ้าไม่เจอ agent ให้สร้าง placeholder เพื่อให้เห็นการอัปเดตแบบ real-time
function upsertRuntimeAgent(id, status) {
    let ag = findAgentByFlexibleId(id);
    if (!ag) {
        ag = { id, name: `Agent (${id})`, status: displayStatus(status) };
        agents.push(ag);
    } else {
        ag.status = displayStatus(status);
    }
}

// ---------- Load & Render ----------
async function loadAgents() {
    try {
        const res = await window.realtimeAPI.getMockAgents(); // ใช้ mock ให้ตรงกับหน้าจอ
        agents = Array.isArray(res?.agents)
            ? res.agents.map(a => ({ ...a, status: displayStatus(a.status) }))
            : [];
        renderAgents();
        updateStats();
    } catch (error) {
        console.error('Failed to load agents:', error);
    }
}

function renderAgents() {
    const grid = document.getElementById('agents-grid');
    if (!grid) return;
    grid.innerHTML = '';

    agents.forEach(agent => {
        const card = document.createElement('div');
        card.className = 'agent-card';
        card.innerHTML = `
      <div class="agent-name">${agent.name}</div>
      <div>Status: <strong class="agent-status">${displayStatus(agent.status)}</strong></div>
      <div class="status-buttons" style="margin-top:10px; display:flex; gap:6px; flex-wrap:wrap;">
        <button class="status-btn available">Available</button>
        <button class="status-btn busy">Busy</button>
        <button class="status-btn offline">Offline</button>
        <button class="status-btn break">Break</button>
      </div>
    `;

        const setStatus = async (st) => {
            try {
                await window.electronAPI.updateAgentStatus(agent.id, st);
                agent.status = displayStatus(st);
                renderAgents();
                updateStats();
            } catch {
                alert('Failed to update status');
            }
        };

        card.querySelector('.status-btn.available')?.addEventListener('click', () => setStatus('available'));
        card.querySelector('.status-btn.busy')?.addEventListener('click', () => setStatus('busy'));
        card.querySelector('.status-btn.offline')?.addEventListener('click', () => setStatus('offline'));
        card.querySelector('.status-btn.break')?.addEventListener('click', () => setStatus('break'));

        grid.appendChild(card);
    });
}

// ---------- Stats ----------
function updateStats() {
    const counts = { available: 0, busy: 0, offline: 0, break: 0 };
    for (const a of agents) {
        const k = displayStatus(a.status);
        counts[k] = (counts[k] || 0) + 1;
    }

    document.getElementById('available-count')?.textContent = counts.available ?? 0;
    document.getElementById('busy-count')?.textContent = counts.busy ?? 0;
    document.getElementById('offline-count')?.textContent = counts.offline ?? 0;
    document.getElementById('break-count')?.textContent = counts.break ?? 0;

    // อัปเดตกราฟ
    if (typeof window.updateStatusChart === 'function') {
        window.updateStatusChart(counts);
    } else if (window.statusChart) {
        // fallback: อัปเดตตรง ๆ ถ้ามีตัวแปร statusChart
        window.statusChart.data.datasets[0].data = [
            counts.available, counts.busy, counts.offline, counts.break
        ];
        window.statusChart.update();
    }
}

// ---------- Export ----------
async function exportData() {
    try {
        const result = await window.electronAPI.exportData(agents);
        if (result?.success) {
            alert(`Data exported to: ${result.path}`);
        }
    } catch {
        alert('Export failed');
    }
}

// ---------- Clock ----------
function updateTime() {
    const now = new Date();
    document.getElementById('current-time')?.textContent = now.toLocaleTimeString();
}

// ---------- Realtime (Simulator + Tray) ----------
function setMockRowStatus(agentId, status) {
    // รองรับทั้ง "AG001" และเลขล้วน (เช่น 1 → AG001)
    const id = typeof agentId === 'number'
        ? `AG${String(agentId).padStart(3, '0')}`
        : String(agentId);

    const row = document.querySelector(`#agent-${id} .agent-status-text`);
    if (row) row.textContent = status;
}

function wireRealtime() {
    // Event จาก simulator
    window.realtimeAPI?.onAgentStatusChanged?.((payload) => {
        const newSt = displayStatus(payload.newStatus);

        // อัปเดตใน memory + UI หลัก
        upsertRuntimeAgent(payload.agentId, newSt);
        renderAgents();
        updateStats();

        // อัปเดต UI ของ mock data (แถวรายชื่อ)
        setMockRowStatus(payload.agentId, newSt);

        // last change + แจ้งเตือน
        const last = document.getElementById('lastStatusChange');
        if (last) {
            last.innerHTML = `🔄 <strong>${payload.agentId}</strong> → ${newSt}<br>
        <small>⏰ ${new Date(payload.timestamp).toLocaleTimeString('th-TH')}</small>`;
        }
        window.realtimeAPI?.notify?.({ title: 'Realtime Update', body: `${payload.agentId} → ${newSt}` });
    });

    // คำสั่งจาก System Tray
    window.realtimeAPI?.onTrayCommand?.(({ cmd }) => {
        if (cmd === 'sim-start') startSimulator();
        if (cmd === 'sim-stop') stopSimulator();
        if (cmd === 'toggle-auto') refreshData();
        if (cmd === 'toggle-theme') document.documentElement.classList.toggle('dark');
        if (cmd === 'connect-ws') {
            // ต่อ WebSocket จริงในอนาคต
        }
    });
}

// ---------- Simulator controls ----------
async function startSimulator() {
    try {
        await window.realtimeAPI?.startSimulator?.();
        markSimRunning(true);
    } catch (e) { console.error(e); }
}
async function stopSimulator() {
    try {
        await window.realtimeAPI?.stopSimulator?.();
        markSimRunning(false);
    } catch (e) { console.error(e); }
}
function markSimRunning(isRun) {
    simRunning = !!isRun;
    const btnStart = document.getElementById('btnSimStart');
    const btnStop = document.getElementById('btnSimStop');
    if (btnStart) btnStart.disabled = !!isRun;
    if (btnStop) btnStop.disabled = !isRun;
    const led = document.getElementById('simLed');
    if (led) led.style.background = isRun ? '#22c55e' : '#9ca3af';
}

// ---------- Refresh ----------
function refreshData() {
    if (!simRunning) {   // กัน simulator ถูกทับ
        loadAgents();
    }
    updateTime();
}

// ---------- Init ----------
window.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btnSimStart')?.addEventListener('click', startSimulator);
    document.getElementById('btnSimStop')?.addEventListener('click', stopSimulator);

    wireRealtime();
    loadAgents();
    updateTime();

    setInterval(updateTime, 1000);
    setInterval(loadAgents, 30000);
});

window.refreshData = refreshData;
window.exportData = exportData;
