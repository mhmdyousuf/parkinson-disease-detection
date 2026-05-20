"""
NeuroTrack — Streamlined main.py
Patient Info handling, Tremor Test (WebSocket), Session-based QR Phone Sync, and History/Analysis.
"""

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel
import json, joblib, time, os, uuid
import numpy as np
from typing import Optional

from database import engine, Base, get_db
import models

# ── Public URL store (set by tunnel on startup) ───────────────────────────────
# Reads from MAGIC_URL.txt written by cf_tunnel.py / ngrok
public_tunnel_url: str = ""

def _read_tunnel_url() -> str:
    """Try to read the public tunnel URL from known files."""
    for filename in ["MAGIC_URL.txt", "tunnel_url.txt", "CF_URL.txt"]:
        # Check in project root (one level up from backend)
        for base in [BASE_DIR, os.path.join(BASE_DIR, "..")]:
            path = os.path.join(base, filename)
            if os.path.exists(path):
                try:
                    url = open(path).read().strip()
                    if url.startswith("http"):
                        return url
                except:
                    pass
    return ""

# ── Setup ───────────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, "model", "tremor_model.pkl")

# Create tables
Base.metadata.create_all(bind=engine)

app = FastAPI(title="NeuroTrack — Parkinson Tremor Detection")

# Mount Frontend static files
FRONTEND_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "frontend"))
app.mount("/app", StaticFiles(directory=FRONTEND_DIR), name="frontend")

@app.get("/")
async def root_redirect():
    return RedirectResponse(url="/app/index.html")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── In-Memory Session Store ───────────────────────────────────────────────────
# sessions[session_id] = { "patient": {...}, "result": {...} or None, "created_at": float }
sessions: dict = {}

SESSION_TTL = 3600  # 1 hour

def cleanup_sessions():
    """Remove expired sessions."""
    now = time.time()
    expired = [sid for sid, s in sessions.items() if now - s["created_at"] > SESSION_TTL]
    for sid in expired:
        del sessions[sid]

# ── Pydantic Models ───────────────────────────────────────────────────────────
class PatientSessionCreate(BaseModel):
    name: str
    age: str
    blood: str
    phone: str

class TestResultStore(BaseModel):
    session_id: str
    prediction: str
    frequency_hz: float
    severity: str
    instruction: Optional[str] = ""
    amplitude: Optional[float] = 0.0

# ── Session APIs ──────────────────────────────────────────────────────────────
@app.post("/api/session/create")
def create_session(patient: PatientSessionCreate):
    """Desktop calls this to create a session and get back a session_id for the QR code."""
    cleanup_sessions()
    session_id = str(uuid.uuid4())
    sessions[session_id] = {
        "patient": patient.dict(),
        "result": None,
        "created_at": time.time()
    }
    return {"session_id": session_id}

@app.get("/api/session/{session_id}")
def get_session(session_id: str):
    """Mobile phone calls this to retrieve patient info from session_id in URL."""
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found or expired.")
    s = sessions[session_id]
    return {
        "patient": s["patient"],
        "has_result": s["result"] is not None,
        "result": s["result"]
    }

@app.post("/api/session/result")
def store_result(data: TestResultStore):
    """Mobile phone posts the test result back so desktop can poll for it."""
    if data.session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found.")
    sessions[data.session_id]["result"] = {
        "prediction": data.prediction,
        "frequency_hz": data.frequency_hz,
        "severity": data.severity,
    }
    return {"ok": True}

@app.get("/api/session/{session_id}/poll")
def poll_result(session_id: str):
    """Desktop polls this to check if the mobile phone has submitted a result."""
    if session_id not in sessions:
        return {"status": "not_found"}
    s = sessions[session_id]
    if s["result"]:
        return {"status": "completed", **s["result"]}
    return {"status": "waiting"}

# ── Public URL Endpoint ───────────────────────────────────────────────────────
@app.get("/api/public-url")
def get_public_url():
    """Returns the public tunnel URL (cloudflare/ngrok) for QR code generation."""
    url = _read_tunnel_url()
    if not url:
        return {"url": "", "available": False}
    return {"url": url.rstrip("/"), "available": True}

@app.post("/api/public-url")
def set_public_url(payload: dict):
    """Allows the tunnel script to push the URL directly to the backend."""
    global public_tunnel_url
    public_tunnel_url = payload.get("url", "").strip()
    return {"ok": True, "url": public_tunnel_url}

# ── Load ML model ─────────────────────────────────────────────────────────────
try:
    ml_model = joblib.load(MODEL_PATH)
    print(f"Model loaded: {MODEL_PATH}")
except Exception as e:
    ml_model = None
    print(f"Model load failed: {e} -> running without ML (FFT-only mode)")

# ── REST: History/Analysis ───────────────────────────────────────────────────
@app.get("/api/history")
def get_history(db: Session = Depends(get_db)):
    """Returns the full test history for analysis."""
    all_tests = db.query(models.TestHistoryDB).order_by(models.TestHistoryDB.id.asc()).all()
    return [
        {
            "timestamp"   : t.timestamp,
            "patient_name": t.patient_name,
            "prediction"  : t.prediction,
            "frequency_hz": t.frequency_hz,
            "severity"    : t.severity,
        } for t in all_tests
    ]

# ── WebSocket: /ws/sensor ─────────────────────────────────────────────────────
@app.websocket("/ws/sensor")
async def websocket_sensor(ws: WebSocket):
    await ws.accept()
    buffer       = []
    patient_name = "Unknown"
    test_running = False
    session_id   = None
    print("Phone connected via WebSocket")

    try:
        while True:
            raw  = await ws.receive_text()
            data = json.loads(raw)

            if "patient_name" in data:
                patient_name = data["patient_name"]
                if "session_id" in data:
                    session_id = data["session_id"]
                continue

            if "command" in data and data["command"] == "analyze":
                if len(buffer) < 10:
                    buffer = [[0,0,0,0, time.time()]] * 10

                print(f"Analysing {len(buffer)} samples for {patient_name}...")
                arr = np.array(buffer)

                # 1. Improved Sampling Rate Calculation (using client timestamps)
                timestamps = arr[:, 4]
                if len(timestamps) > 1:
                    total_duration = timestamps[-1] - timestamps[0]
                    avg_dt = total_duration / (len(timestamps) - 1)
                    # Safety check: if avg_dt is zero or negative (due to bad client clocks), 
                    # fallback to a reasonable 50Hz (0.02s)
                    if avg_dt <= 0: avg_dt = 0.02
                else:
                    avg_dt = 0.02

                # 2. Vector Magnitude Calculation (X, Y, Z)
                # Removes dependency on phone orientation
                magnitude = np.sqrt(arr[:, 0]**2 + arr[:, 1]**2 + arr[:, 2]**2)

                # 3. DC Offset Removal (Mean Subtraction)
                # Removes gravity component
                signal = magnitude - np.mean(magnitude)

                # 4. ML Feature extraction (Mean, Std, Max, Min of magnitude)
                features = [[
                    np.mean(signal),
                    np.std(signal),
                    np.max(signal),
                    np.min(signal),
                ]]

                ml_pred = [0]
                if ml_model:
                    try:
                        ml_pred = ml_model.predict(features)
                    except Exception: pass

                # 5. FFT Frequency Analysis
                n = len(signal)
                fv = np.fft.fft(signal)
                fr = np.fft.fftfreq(n, d=avg_dt)
                
                # Take positive frequencies only
                pos_mask = fr > 0
                freqs = fr[pos_mask]
                mags  = np.abs(fv)[pos_mask]

                # Focus on tremor range (3 - 12 Hz) to avoid DC and high-freq noise
                range_mask = (freqs >= 3.0) & (freqs <= 12.0)
                if np.any(range_mask):
                    idx_peak = np.argmax(mags[range_mask])
                    freq     = float(freqs[range_mask][idx_peak])
                    peak_mag = float(mags[range_mask][idx_peak]) / n # Normalized amplitude
                else:
                    freq     = 0.0
                    peak_mag = 0.0

                if np.isnan(freq) or np.isinf(freq): freq = 0.0

                # 6. Final Prediction & Severity Logic
                amplitude = np.std(signal)
                is_significant = amplitude > 0.15

                if not is_significant:
                    # CASE 1: Stationary or very subtle movement
                    freq = 0.0
                    prediction = "Normal Movement / No Resting Tremor Detected"
                    severity   = "Normal"
                    instruction = "Your hand movement appears normal. No signs of tremor were detected during this test."
                else:
                    # CASE 2: Significant shaking detected
                    # Determine Status based on Frequency
                    if 4.0 <= freq <= 6.5:
                        prediction = "Possible Parkinson Tremor Detected"
                        # Severity matters for diseases
                        if amplitude > 0.6: severity = "High"
                        elif amplitude > 0.3: severity = "Medium"
                        else: severity = "Low"
                        instruction = f"⚠️ {severity} SEVERITY: Tremor detected in the Parkinson's frequency range (4-6.5 Hz). Please consult a neurologist."
                    elif freq > 6.4:
                        prediction = "Essential / Action Tremor Detected"
                        if amplitude > 0.6: severity = "High"
                        elif amplitude > 0.3: severity = "Medium"
                        else: severity = "Low"
                        instruction = f"NOTE: Fast tremor ({freq:.1f} Hz) detected. This may be an Essential Tremor."
                    else:
                        prediction = "Normal / Non-Parkinsonian Shaking"
                        severity   = "Normal"
                        instruction = "Irregular or slow shaking detected. Does not match typical Parkinson's patterns."

                print(f"Result: {prediction} | Freq: {freq:.2f}Hz | Amp: {amplitude:.3f} | Severity: {severity}")

                ts_str = time.strftime("%Y-%m-%d %H:%M:%S")
                db = next(get_db())
                try:
                    db.add(models.TestHistoryDB(
                        patient_name = patient_name,
                        timestamp    = ts_str,
                        prediction   = prediction,
                        frequency_hz = round(freq, 2),
                        severity     = severity,
                    ))
                    db.commit()
                finally:
                    db.close()

                result_payload = {
                    "status"      : "completed",
                    "prediction"  : prediction,
                    "frequency_hz": round(freq, 2),
                    "severity"    : severity,
                    "instruction" : instruction,
                    "amplitude"   : round(float(amplitude), 3),
                }

                # If this is a remote session, store result so desktop can poll it
                if session_id and session_id in sessions:
                    sessions[session_id]["result"] = {
                        "prediction"  : prediction,
                        "frequency_hz": round(freq, 2),
                        "severity"    : severity,
                        "instruction" : instruction,
                        "amplitude"   : round(float(amplitude), 3),
                    }

                await ws.send_json(result_payload)
                test_running = False
                buffer = []
                print("Test complete")
                continue

            if not test_running:
                test_running = True
                buffer       = []

            # 7. Buffer Data with Client Timestamp
            # Use client timestamp if available (conv to seconds), else fallback to server time
            client_ts = data.get("ts")
            ts_val = float(client_ts) / 1000.0 if client_ts else time.time()

            buffer.append([
                data.get("ax", 0),
                data.get("ay", 0),
                data.get("az", 0),
                data.get("gx", 0),
                ts_val
            ])

    except WebSocketDisconnect:
        print("Phone disconnected")
    except Exception as e:
        print(f"WebSocket error: {e}")

# ── Health check ──────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "NeuroTrack backend running"}

# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
