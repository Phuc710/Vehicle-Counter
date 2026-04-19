"""router.py – Tất cả HTTP endpoints cho web vehicle counter."""

import json, os, time
from fastapi import APIRouter
from fastapi.responses import HTMLResponse, StreamingResponse
from pydantic import BaseModel
from typing import List
from config import STATIC_DIR, ZONE_FILE, DEFAULT_ROI
import shared

router = APIRouter()


# ── HTML pages ────────────────────────────────────────────────────────────────
@router.get("/", response_class=HTMLResponse)
async def index():
    return HTMLResponse(open(os.path.join(STATIC_DIR, "index.html"), encoding="utf-8").read())


# ── MJPEG stream ──────────────────────────────────────────────────────────────
def mjpeg_generator():
    while True:
        with shared.frame_lock:
            frame = shared.latest_frame
        if frame:
            yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + frame + b"\r\n"
        time.sleep(0.03)

@router.get("/api/stream")
async def stream():
    return StreamingResponse(mjpeg_generator(),
                             media_type="multipart/x-mixed-replace; boundary=frame")


# ── Stats (polling) ───────────────────────────────────────────────────
@router.get("/api/stats")
async def stats():
    has_zone = len(shared.roi_points) >= 3
    with shared.state_lock:
        s = {
            "counts":    dict(shared.state["counts"]),   # Tích lũy, chỉ tăng
            "frame_idx": shared.state["frame_idx"],
            "has_zone":  has_zone,
            "roi_points": shared.roi_points,
        }
    return s


@router.get("/api/detections")
async def get_detections():
    """Bbox hiện tại (640×360) — frontend dùng để vẽ."""
    return {"detections": shared.detections}


# ── ROI management ────────────────────────────────────────────────────────────

class ZoneBody(BaseModel):
    points: List[List[int]]


@router.get("/api/zone")
async def get_roi():
    return {"status": "ok", "points": shared.roi_points}


@router.post("/api/zone")
async def set_roi(body: ZoneBody):
    if len(body.points) < 3:
        return {"status": "error", "msg": "Need at least 3 points"}
    shared.roi_points = body.points
    try:
        json.dump(body.points, open(ZONE_FILE, "w"))
    except Exception:
        pass
    return {"status": "ok", "points": shared.roi_points}


@router.delete("/api/zone")
async def reset_roi():
    shared.roi_points = [list(p) for p in DEFAULT_ROI]
    try:
        json.dump(shared.roi_points, open(ZONE_FILE, "w"))
    except Exception:
        pass
    return {"status": "ok"}


# ── Reset counts ───────────────────────────────────────────────────
@router.post("/api/reset")
async def reset_counts():
    from config import TARGET_NAMES
    with shared.state_lock:
        shared.state["counts"]    = {n: 0 for n in TARGET_NAMES}
        shared.state["frame_idx"] = 0
    shared.seen_ids.clear()
    shared.zone_seen_ids.clear()
    return {"status": "ok"}
