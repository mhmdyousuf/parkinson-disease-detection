/* ─────────────────────────────────────────────────────────
   NeuroTrack v3.0 — app_v2.js
   Full session-based QR phone sync + PDF download
   ───────────────────────────────────────────────────────── */

const PROTOVAL    = window.location.protocol;
const WS_PROTO    = (PROTOVAL === 'https:') ? 'wss' : 'ws';
const BASE_HOST   = window.location.host;
const BASE_ORIGIN = window.location.origin;
const WEBSOCKET_URL = `${WS_PROTO}://${BASE_HOST}/ws/sensor`;

let ws;
let testInterval;
let timeLeft   = 30;
let isRecording = false;
let patientProfile = JSON.parse(localStorage.getItem('patientProfile')) || {};
let chartInstance  = null;
let currentSessionId = null;  // For QR session
let pollInterval = null;       // Desktop polling
let desktopResult = null;      // Stores the result received from phone

// ─── Detect mobile/desktop ───────────────────────────────
const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

// ────────────────────────────────────────────────────────────────
// UI & Navigation
// ────────────────────────────────────────────────────────────────
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    let icon = type === 'success' ? 'fa-circle-check' : type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-info';
    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.add('fade-out'); setTimeout(() => toast.remove(), 300); }, 4000);
}

function switchTab(tabId) {
    document.querySelectorAll('.tab-pane').forEach(tab => tab.classList.add('hidden'));
    document.querySelectorAll('.nav-links li').forEach(link => link.classList.remove('active'));
    const target = document.getElementById(tabId);
    if (target) target.classList.remove('hidden');
    const navId = tabId === 'test-tab' ? 'nav-test' : 'nav-history';
    const navLink = document.getElementById(navId);
    if (navLink) navLink.classList.add('active');
    if (tabId === 'history-tab') fetchHistory();
    toggleSidebar();
}

function toggleSidebar() {
    const sidebar  = document.getElementById('main-sidebar');
    const overlay  = document.getElementById('sidebar-overlay');
    if (!sidebar || !overlay) return;
    // Only meaningful on mobile
    if (window.innerWidth <= 768) {
        sidebar.classList.toggle('active');
        overlay.classList.toggle('active');
    }
}

// ────────────────────────────────────────────────────────────────
// Auth / Session
// ────────────────────────────────────────────────────────────────
function handleAuth() {
    const name  = document.getElementById('auth-name').value.trim();
    const age   = document.getElementById('auth-age').value.trim();
    const blood = document.getElementById('auth-blood').value;
    const phone = document.getElementById('auth-phone').value.trim();

    if (!name || !age || !blood || !phone) {
        showToast('Please fill all details to begin.', 'error');
        return;
    }
    if (!/^\d{10}$/.test(phone.replace(/\s/g, ''))) {
        showToast('Enter a valid 10-digit phone number.', 'error');
        return;
    }

    patientProfile = { name, age, blood, phone };
    localStorage.setItem('patientProfile', JSON.stringify(patientProfile));
    localStorage.setItem('neuroToken', 'active');

    document.getElementById('saas-portal').classList.add('hidden');
    updateSidebarProfile();
    showToast(`Welcome, ${name}! 👋`, 'success');
    initTestPage();
}

function updateSidebarProfile() {
    const info = document.getElementById('sidebar-patient-info');
    if (!info || !patientProfile.name) return;
    document.getElementById('sidebar-name').textContent = patientProfile.name;
    document.getElementById('sidebar-details').textContent = `Age: ${patientProfile.age} | ${patientProfile.blood} | ${patientProfile.phone}`;
    info.style.display = 'block';
}

function logoutPortal() {
    if (pollInterval) clearInterval(pollInterval);
    localStorage.clear();
    window.location.reload();
}

// ────────────────────────────────────────────────────────────────
// Init test page — decide mobile vs desktop
// ────────────────────────────────────────────────────────────────
function initTestPage() {
    // Check if this is a mobile session redirect (URL has ?session=xxx)
    const urlParams    = new URLSearchParams(window.location.search);
    const sessionParam = urlParams.get('session');

    if (sessionParam) {
        // ── MOBILE PATH: phone opened via QR code with session ID ──
        loadMobileSession(sessionParam);
    } else if (isMobile) {
        // Normal mobile (no QR session) — show live sensor UI
        document.getElementById('sensor-active-content').classList.remove('hidden');
        setupSensorListeners();
    } else {
        // Desktop — show Phone QR Sync UI directly (no laptop test)
        document.getElementById('no-sensor-warning').classList.remove('hidden');
    }
}

// ────────────────────────────────────────────────────────────────
// MOBILE SESSION FLOW (phone opened QR link)
// ────────────────────────────────────────────────────────────────
async function loadMobileSession(sessionId) {
    try {
        const res = await fetch(`${BASE_ORIGIN}/api/session/${sessionId}`);
        if (!res.ok) throw new Error('Session not found');
        const data = await res.json();

        // Auto-fill patient profile from session
        patientProfile = data.patient;
        currentSessionId = sessionId;
        localStorage.setItem('patientProfile', JSON.stringify(patientProfile));

        // Show the sensor test UI
        document.getElementById('sensor-active-content').classList.remove('hidden');
        updateSidebarProfile();
        showToast(`Session loaded for ${patientProfile.name}`, 'success');
        setupSensorListeners();
    } catch (e) {
        showToast('Session expired or invalid. Please scan the QR code again.', 'error');
        // Show the login form again
        document.getElementById('saas-portal').classList.remove('hidden');
    }
}

// ────────────────────────────────────────────────────────────────
// Sensor / Test Logic
// ────────────────────────────────────────────────────────────────
function setupSensorListeners() {
    const startBtn = document.getElementById('start-btn');
    if (!startBtn) return;
    startBtn.addEventListener('click', async () => {
        // iOS requires explicit permission for DeviceMotion
        if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
            try {
                const state = await DeviceMotionEvent.requestPermission();
                if (state === 'granted') startTest();
                else showToast('Sensor permission denied.', 'error');
            } catch (e) {
                showToast('Open this page in Safari for sensor access.', 'error');
            }
        } else {
            startTest();
        }
    });

    // Show iOS permission button if needed
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        const permBtn = document.getElementById('permission-btn');
        if (permBtn) permBtn.classList.remove('hidden');
    }

    // Activate sensor indicator
    const dot   = document.getElementById('sensor-dot');
    const label = document.getElementById('sensor-status-label');
    window.addEventListener('devicemotion', (e) => {
        if (e.accelerationIncludingGravity) {
            if (dot)   dot.style.background   = '#10b981';
            if (label) label.textContent = 'Sensors Active';
        }
    }, { once: true });
}

async function requestIOSPermission() {
    try {
        const state = await DeviceMotionEvent.requestPermission();
        if (state === 'granted') showToast('Sensors enabled!', 'success');
    } catch (e) {}
}

function startTest() {
    const statusText      = document.getElementById('test-status');
    const instructionText = document.getElementById('test-instructions');
    const resultsPanel    = document.getElementById('test-results');
    const startBtn        = document.getElementById('start-btn');
    const timeText        = document.getElementById('time-text');

    if (isRecording) return;
    isRecording = true;
    timeLeft    = 30;

    statusText.innerText      = "Recording...";
    instructionText.innerText = "Keep your phone steady. Don't move!";
    startBtn.disabled         = true;
    startBtn.innerHTML        = '<i class="fa-solid fa-spinner fa-spin"></i> Recording...';
    resultsPanel.classList.add('hidden');

    try {
        ws = new WebSocket(WEBSOCKET_URL);
        ws.onopen = () => {
            const initMsg = { patient_name: patientProfile.name };
            if (currentSessionId) initMsg.session_id = currentSessionId;
            ws.send(JSON.stringify(initMsg));
            window.addEventListener('devicemotion', handleMotion);
            startTimer(() => {
                if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ command: "analyze" }));
            });
        };
        ws.onmessage = (e) => {
            const res = JSON.parse(e.data);
            if (res.status === "completed") {
                showResults(res);
                stopTest();
            }
        };
        ws.onerror = () => { showToast('Backend connection failed. Try reconnecting.', 'error'); stopTest(); };
        ws.onclose = () => { if (isRecording) stopTest(); };
    } catch (e) { stopTest(); }
}

function handleMotion(e) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const x = e.accelerationIncludingGravity?.x || 0;
    const y = e.accelerationIncludingGravity?.y || 0;
    const z = e.accelerationIncludingGravity?.z || 0;
    document.getElementById('sens-x').innerText = x.toFixed(2);
    document.getElementById('sens-y').innerText = y.toFixed(2);
    document.getElementById('sens-z').innerText = z.toFixed(2);
    ws.send(JSON.stringify({
        ax: x, ay: y, az: z,
        gx: e.rotationRate?.alpha || 0,
        gy: e.rotationRate?.beta  || 0,
        gz: e.rotationRate?.gamma || 0,
        ts: Date.now()
    }));
}

function startTimer(onComplete) {
    const timeText = document.getElementById('time-text');
    testInterval = setInterval(() => {
        timeLeft--;
        if (timeText) timeText.innerText = timeLeft;
        if (timeLeft <= 0) {
            clearInterval(testInterval);
            onComplete();
        }
    }, 1000);
}

function stopTest() {
    const startBtn = document.getElementById('start-btn');
    const timeText = document.getElementById('time-text');
    isRecording = false;
    clearInterval(testInterval);
    window.removeEventListener('devicemotion', handleMotion);
    if (ws) ws.close();
    if (startBtn) {
        startBtn.disabled = false;
        startBtn.innerHTML = '<i class="fa-solid fa-redo"></i> Re-run Test';
    }
    if (timeText) timeText.innerText = "30";
}

function showResults(data) {
    const now = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

    // ── QR Session Flow: Phone opened via QR from laptop ──────────────
    // Result already stored in backend session by WebSocket handler.
    // Show simple "done" card on phone; full result appears on LAPTOP.
    if (currentSessionId) {
        document.getElementById('qr-session-done').classList.remove('hidden');
        showToast('Test complete! Results sent to laptop. ✅', 'success');
        return;
    }

    // ── Direct Phone Flow: Phone logged in directly (no QR) ───────────
    // Show full result card on the phone.
    document.getElementById('res-patient-name').innerText  = patientProfile.name  || '--';
    document.getElementById('res-patient-age').innerText   = patientProfile.age   || '--';
    document.getElementById('res-patient-blood').innerText = patientProfile.blood  || '--';
    document.getElementById('res-patient-phone').innerText = patientProfile.phone  || '--';
    document.getElementById('res-prediction').innerText    = data.prediction;
    document.getElementById('res-frequency').innerText     = `${data.frequency_hz} Hz`;
    document.getElementById('res-amplitude').innerText     = data.amplitude !== undefined ? `${data.amplitude} m/s²` : '--';
    document.getElementById('res-datetime').innerText      = now;

    const sev = document.getElementById('res-severity');
    sev.innerText   = data.severity;
    sev.className   = `badge ${data.severity}`;

    // Show instruction box
    if (data.instruction) {
        const instrBox = document.getElementById('res-instruction-box');
        document.getElementById('res-instruction').innerText = data.instruction;
        instrBox.style.display = 'block';
        // Color the box based on severity
        if (data.severity === 'High') {
            instrBox.style.background = '#fef2f2'; instrBox.style.borderColor = '#fca5a5'; instrBox.style.color = '#991b1b';
        } else if (data.severity === 'Medium') {
            instrBox.style.background = '#fffbeb'; instrBox.style.borderColor = '#fde68a'; instrBox.style.color = '#92400e';
        } else {
            instrBox.style.background = '#f0fdf4'; instrBox.style.borderColor = '#bbf7d0'; instrBox.style.color = '#166534';
        }
    }

    document.getElementById('test-results').classList.remove('hidden');
    showToast('Test complete! ✅', 'success');
    setTimeout(fetchHistory, 1000);
}

// ────────────────────────────────────────────────────────────────
// DESKTOP: QR Code (Phone Sensor) Only — Laptop test removed
// ────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────
// DESKTOP: QR Code Generation & Polling
// ────────────────────────────────────────────────────────────────
async function generateQRSession() {
    const btn = document.getElementById('gen-qr-btn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating...';

    try {
        // ── Step 1: Get the public tunnel URL from backend ──────────────────
        const urlRes  = await fetch(`${BASE_ORIGIN}/api/public-url`);
        const urlData = await urlRes.json();

        let publicBase = BASE_ORIGIN; // fallback to localhost (same WiFi only)

        if (!urlData.available) {
            // Show warning but still allow WiFi-only QR
            document.getElementById('tunnel-warning').classList.remove('hidden');
        } else {
            publicBase = urlData.url;
            document.getElementById('tunnel-warning').classList.add('hidden');
        }

        // ── Step 2: Create session on backend ──────────────────────────────
        const res = await fetch(`${BASE_ORIGIN}/api/session/create`, {
            method : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body   : JSON.stringify(patientProfile)
        });
        if (!res.ok) throw new Error('Failed to create session');
        const { session_id } = await res.json();
        currentSessionId = session_id;

        // ── Step 3: Build mobile URL using the PUBLIC HTTPS tunnel URL ─────
        const mobileURL = `${publicBase}/app/index.html?session=${session_id}`;

        // ── Step 4: Render QR code ─────────────────────────────────────────
        const qrContainer = document.getElementById('qrcode-container');
        qrContainer.innerHTML = '';
        new QRCode(qrContainer, {
            text        : mobileURL,
            width       : 220,
            height      : 220,
            colorDark   : "#1e293b",
            colorLight  : "#ffffff",
            correctLevel: QRCode.CorrectLevel.M
        });

        // Show mobile link text (if element exists on page)
        const linkEl = document.getElementById('mobile-link');
        if (linkEl) {
            linkEl.href        = mobileURL;
            linkEl.textContent = mobileURL;
        }

        // ── Step 5: Show QR panel & start polling ─────────────────────────
        document.getElementById('qr-generation-area').classList.add('hidden');
        document.getElementById('qr-display-area').classList.remove('hidden');
        startDesktopPolling(session_id);

    } catch (e) {
        showToast('Could not create QR session. Is the backend running?', 'error');
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-qrcode"></i> Generate QR Code';
    }
}

function startDesktopPolling(sessionId) {
    const statusText = document.getElementById('poll-status-text');
    let attempts = 0;
    const maxAttempts = 180; // poll for 3 mins (every second)

    pollInterval = setInterval(async () => {
        attempts++;
        if (attempts > maxAttempts) {
            clearInterval(pollInterval);
            if (statusText) statusText.textContent = 'Session timed out. Please generate a new QR code.';
            return;
        }

        try {
            const res  = await fetch(`${BASE_ORIGIN}/api/session/${sessionId}/poll`);
            const data = await res.json();

            if (data.status === 'completed') {
                clearInterval(pollInterval);
                showDesktopResult(data, sessionId);
            }
        } catch (e) { /* ignore network blips */ }
    }, 2000); // poll every 2 seconds
}

function showDesktopResult(data, sessionId) {
    const now = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    desktopResult = { ...data, datetime: now };

    // Hide polling status
    document.getElementById('desktop-poll-status').classList.add('hidden');

    // Fill result fields
    document.getElementById('desk-res-name').innerText       = patientProfile.name;
    document.getElementById('desk-res-age').innerText        = patientProfile.age;
    document.getElementById('desk-res-blood').innerText      = patientProfile.blood;
    document.getElementById('desk-res-phone').innerText      = patientProfile.phone;
    document.getElementById('desk-res-prediction').innerText = data.prediction;
    document.getElementById('desk-res-frequency').innerText  = `${data.frequency_hz} Hz`;
    document.getElementById('desk-res-amplitude').innerText  = data.amplitude !== undefined ? `${data.amplitude} m/s²` : '--';
    document.getElementById('desk-res-datetime').innerText   = now;

    const sev = document.getElementById('desk-res-severity');
    sev.innerText = data.severity;
    sev.className = `badge ${data.severity}`;

    // Show instruction box
    if (data.instruction) {
        const instrBox = document.getElementById('desk-res-instruction-box');
        document.getElementById('desk-res-instruction').innerText = data.instruction;
        instrBox.style.display = 'block';
        if (data.severity === 'High') {
            instrBox.style.background = '#fef2f2'; instrBox.style.borderColor = '#fca5a5'; instrBox.style.color = '#991b1b';
        } else if (data.severity === 'Medium') {
            instrBox.style.background = '#fffbeb'; instrBox.style.borderColor = '#fde68a'; instrBox.style.color = '#92400e';
        } else {
            instrBox.style.background = '#f0fdf4'; instrBox.style.borderColor = '#bbf7d0'; instrBox.style.color = '#166534';
        }
    }

    document.getElementById('desktop-result-display').classList.remove('hidden');
    showToast('Phone test completed! Result received. ✅', 'success');
    setTimeout(fetchHistory, 1000);
}

function resetQR() {
    // Stop any active polling
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
    currentSessionId = null;
    // Hide QR display, show generation button again
    document.getElementById('qr-display-area').classList.add('hidden');
    document.getElementById('desktop-result-display').classList.add('hidden');
    document.getElementById('qr-generation-area').classList.remove('hidden');
    document.getElementById('qrcode-container').innerHTML = '';
    // Re-enable generate button
    const btn = document.getElementById('gen-qr-btn');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-qrcode"></i> Generate QR Code'; }
    // Reset poll status text
    const st = document.getElementById('poll-status-text');
    if (st) st.textContent = 'Waiting for phone to complete test...';
    document.getElementById('desktop-poll-status').classList.remove('hidden');
}

// ────────────────────────────────────────────────────────────────
// PDF Download
// ────────────────────────────────────────────────────────────────
function buildReportHTML(prediction, frequency_hz, severity, datetime, amplitude, instruction) {
    const sevColor = severity === 'High' ? '#ef4444' : severity === 'Medium' ? '#f59e0b' : '#10b981';
    const instrBg  = severity === 'High' ? '#fef2f2' : severity === 'Medium' ? '#fffbeb' : '#f0fdf4';
    const instrBorder = severity === 'High' ? '#fca5a5' : severity === 'Medium' ? '#fde68a' : '#bbf7d0';
    const instrColor  = severity === 'High' ? '#991b1b' : severity === 'Medium' ? '#92400e' : '#166534';

    const amplitudeRow = amplitude ? `
                <tr>
                    <td style="padding: 8px 12px; color: #64748b;">Tremor Amplitude</td>
                    <td style="padding: 8px 12px; font-weight: 600; color: #1e293b;">${amplitude} m/s²</td>
                </tr>` : '';

    const instructionBlock = instruction ? `
        <div style="border: 1px solid ${instrBorder}; background: ${instrBg}; border-radius: 10px; padding: 16px; margin-bottom: 18px; font-size: 0.9rem; color: ${instrColor}; line-height: 1.6;">
            <strong>🩺 Medical Guidance:</strong><br>${instruction}
        </div>` : '';

    return `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; padding: 40px; max-width: 700px; margin: auto;">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); color: white; padding: 28px 32px; border-radius: 12px; margin-bottom: 28px;">
            <h1 style="margin: 0; font-size: 1.9rem;">🧠 NeuroTrack</h1>
            <p style="margin: 6px 0 0; opacity: 0.75; font-size: 0.95rem;">Parkinson's Tremor Screening Report</p>
            <p style="margin: 4px 0 0; opacity: 0.5; font-size: 0.8rem;">Generated: ${datetime}</p>
        </div>

        <!-- Patient Info -->
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
            <h2 style="margin: 0 0 16px; font-size: 1.1rem; color: #1e293b;">📋 Patient Information</h2>
            <table style="width: 100%; border-collapse: collapse; font-size: 0.95rem;">
                <tr>
                    <td style="padding: 8px 12px; color: #64748b; width: 40%;">Full Name</td>
                    <td style="padding: 8px 12px; font-weight: 600; color: #1e293b;">${patientProfile.name}</td>
                </tr>
                <tr style="background: #f1f5f9;">
                    <td style="padding: 8px 12px; color: #64748b;">Age</td>
                    <td style="padding: 8px 12px; font-weight: 600; color: #1e293b;">${patientProfile.age} years</td>
                </tr>
                <tr>
                    <td style="padding: 8px 12px; color: #64748b;">Blood Group</td>
                    <td style="padding: 8px 12px; font-weight: 600; color: #1e293b;">${patientProfile.blood}</td>
                </tr>
                <tr style="background: #f1f5f9;">
                    <td style="padding: 8px 12px; color: #64748b;">Mobile Number</td>
                    <td style="padding: 8px 12px; font-weight: 600; color: #1e293b;">${patientProfile.phone}</td>
                </tr>
            </table>
        </div>

        <!-- Test Results -->
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
            <h2 style="margin: 0 0 16px; font-size: 1.1rem; color: #1e293b;">📊 Screening Results</h2>
            <table style="width: 100%; border-collapse: collapse; font-size: 0.95rem;">
                <tr>
                    <td style="padding: 8px 12px; color: #64748b; width: 40%;">Prediction</td>
                    <td style="padding: 8px 12px; font-weight: 600; color: #1e293b;">${prediction}</td>
                </tr>
                <tr style="background: #f1f5f9;">
                    <td style="padding: 8px 12px; color: #64748b;">Tremor Frequency</td>
                    <td style="padding: 8px 12px; font-weight: 600; color: #1e293b;">${frequency_hz}</td>
                </tr>${amplitudeRow}
                <tr>
                    <td style="padding: 8px 12px; color: #64748b;">Severity Level</td>
                    <td style="padding: 8px 12px;">
                        <span style="background: ${sevColor}; color: white; padding: 3px 12px; border-radius: 20px; font-size: 0.85rem; font-weight: 700;">${severity}</span>
                    </td>
                </tr>
                <tr style="background: #f1f5f9;">
                    <td style="padding: 8px 12px; color: #64748b;">Test Date &amp; Time</td>
                    <td style="padding: 8px 12px; font-weight: 600; color: #1e293b;">${datetime}</td>
                </tr>
            </table>
        </div>

        <!-- Medical Guidance -->
        ${instructionBlock}

        <!-- Disclaimer -->
        <div style="border: 1px solid #fde68a; background: #fffbeb; border-radius: 10px; padding: 16px; font-size: 0.82rem; color: #92400e;">
            <strong>⚠️ Disclaimer:</strong> This report is generated by an AI screening tool and is not a medical diagnosis.
            Please consult a qualified neurologist for clinical evaluation and treatment.
        </div>

        <p style="text-align: center; color: #94a3b8; font-size: 0.8rem; margin-top: 24px;">— NeuroTrack AI Platform —</p>
    </div>`;
}

// Called from mobile phone result UI
function downloadResultPDF() {
    const prediction   = document.getElementById('res-prediction').innerText;
    const frequency_hz = document.getElementById('res-frequency').innerText;
    const severity     = document.getElementById('res-severity').innerText;
    const datetime     = document.getElementById('res-datetime').innerText;
    const amplitude    = document.getElementById('res-amplitude').innerText;
    const instruction  = document.getElementById('res-instruction').innerText;

    const report = document.createElement('div');
    report.innerHTML = buildReportHTML(prediction, frequency_hz, severity, datetime, amplitude, instruction);

    const opt = {
        margin  : 0.5,
        filename: `NeuroTrack_Report_${patientProfile.name.replace(/\s+/g, '_')}.pdf`,
        html2canvas: { scale: 2 },
        jsPDF   : { unit: 'in', format: 'letter', orientation: 'portrait' }
    };
    html2pdf().set(opt).from(report).save();
}

// Called from desktop result UI (result received from phone)
function downloadDesktopPDF() {
    if (!desktopResult) return;
    const report = document.createElement('div');
    report.innerHTML = buildReportHTML(
        desktopResult.prediction,
        `${desktopResult.frequency_hz} Hz`,
        desktopResult.severity,
        desktopResult.datetime,
        desktopResult.amplitude ? `${desktopResult.amplitude} m/s²` : '',
        desktopResult.instruction || ''
    );
    const opt = {
        margin  : 0.5,
        filename: `NeuroTrack_Report_${patientProfile.name.replace(/\s+/g, '_')}.pdf`,
        html2canvas: { scale: 2 },
        jsPDF   : { unit: 'in', format: 'letter', orientation: 'portrait' }
    };
    html2pdf().set(opt).from(report).save();
}

// ────────────────────────────────────────────────────────────────
// History & Chart
// ────────────────────────────────────────────────────────────────
async function fetchHistory() {
    const list = document.getElementById('test-history-body');
    if (!list) return;
    try {
        const res      = await fetch(`${BASE_ORIGIN}/api/history`);
        const history  = await res.json();
        const filtered = history.filter(h => h.patient_name === patientProfile.name);

        if (filtered.length === 0) {
            list.innerHTML = '<p style="color: #64748b;">No test history found.</p>';
            updateChart([]);
            return;
        }

        list.innerHTML = filtered.slice().reverse().map(h => {
            const dotColor = h.severity === 'High' ? '#ef4444' : h.severity === 'Medium' ? '#f59e0b' : '#10b981';
            return `
            <div class="med-item" style="display:flex; justify-content:space-between; align-items:center; border-left:4px solid ${dotColor};">
                <div>
                    <strong>${h.prediction}</strong>
                    <div style="font-size:0.8rem; color:#64748b; margin-top:3px;">${h.timestamp} &nbsp;|&nbsp; ${h.frequency_hz} Hz</div>
                </div>
                <span class="badge ${h.severity}">${h.severity}</span>
            </div>`;
        }).join('');

        updateChart(filtered);
    } catch (e) { console.error('History fetch error:', e); }
}

function updateChart(history) {
    const canvas = document.getElementById('historyChart');
    if (!canvas) return;

    // Ensure container height
    const container = canvas.parentElement;
    if (container) container.style.height = '300px';

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Safely destroy old chart
    if (chartInstance) {
        try { chartInstance.destroy(); } catch(e) {}
        chartInstance = null;
    }

    if (!history || history.length === 0) return;

    // Labels: show date + time abbreviated so duplicates are visible
    const labels = history.map(h => {
        const parts    = h.timestamp ? h.timestamp.split(' ') : ['--', '--'];
        const datePart = parts[0] || '';
        const timePart = parts[1] ? parts[1].slice(0, 5) : '';
        return datePart + '\n' + timePart;
    });

    const dataPoints = history.map(h => parseFloat(h.frequency_hz) || 0);

    // Color each dot by severity
    const pointColors = history.map(h => {
        if (h.severity === 'High')   return '#ef4444';
        if (h.severity === 'Medium') return '#f59e0b';
        return '#10b981';
    });

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label               : 'Tremor Frequency (Hz)',
                data                : dataPoints,
                borderColor         : '#3b82f6',
                borderWidth         : 2.5,
                tension             : 0.4,
                fill                : true,
                backgroundColor     : 'rgba(59, 130, 246, 0.08)',
                pointBackgroundColor: pointColors,
                pointBorderColor    : pointColors,
                pointBorderWidth    : 2,
                pointRadius         : 7,
                pointHoverRadius    : 10,
            }]
        },
        options: {
            responsive         : true,
            maintainAspectRatio: false,
            animation          : { duration: 600, easing: 'easeInOutQuart' },
            plugins: {
                legend: {
                    display: true,
                    labels : { color: '#1e293b', font: { size: 13 } }
                },
                tooltip: {
                    callbacks: {
                        title: (items) => history[items[0].dataIndex]?.timestamp || '',
                        label: (item) => {
                            const h = history[item.dataIndex];
                            return [
                                ` Frequency: ${h.frequency_hz} Hz`,
                                ` Severity : ${h.severity}`,
                                ` ${h.prediction}`
                            ];
                        },
                        labelColor: (item) => ({
                            borderColor    : pointColors[item.dataIndex],
                            backgroundColor: pointColors[item.dataIndex],
                        })
                    }
                }
            },
            scales: {
                x: {
                    ticks: { color: '#64748b', font: { size: 11 }, maxRotation: 30 },
                    grid : { color: 'rgba(0,0,0,0.05)' }
                },
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text   : 'Frequency (Hz)',
                        color  : '#64748b',
                        font   : { size: 12 }
                    },
                    ticks: { color: '#64748b', font: { size: 11 } },
                    grid : { color: 'rgba(0,0,0,0.06)' }
                }
            }
        }
    });
}

// ────────────────────────────────────────────────────────────────
// Startup
// ────────────────────────────────────────────────────────────────
window.onload = () => {
    const urlParams    = new URLSearchParams(window.location.search);
    const sessionParam = urlParams.get('session');

    if (sessionParam) {
        // ── MOBILE QR PATH: skip login form, auto-load from session ──
        document.getElementById('saas-portal').classList.add('hidden');
        loadMobileSession(sessionParam);
        return;
    }

    // Check for existing login token
    if (localStorage.getItem('neuroToken') && patientProfile.name) {
        document.getElementById('saas-portal').classList.add('hidden');
        updateSidebarProfile();
        initTestPage();
        return;
    }

    // Show login form (fresh visit)
    // Detect if mobile to auto-show sensor UI after login
};
