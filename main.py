
import os, time, json, threading, math
import cv2
import numpy as np
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from ultralytics import YOLO

import router
import shared
from config import *

os.makedirs(STATIC_DIR, exist_ok=True)

# ── ROI ───────────────────────────────────────────────────────────────────────
def load_roi():
    if os.path.exists(ZONE_FILE):
        try:
            pts = json.load(open(ZONE_FILE))
            if isinstance(pts, list) and len(pts) >= 3:
                shared.roi_points = pts
                return
        except Exception:
            pass
    shared.roi_points = []

load_roi()


# ── Helpers ───────────────────────────────────────────────────────────────────
def point_in_roi(pt):
    if len(shared.roi_points) < 3:
        return False
    pts = np.array(shared.roi_points, dtype=np.int32)
    return cv2.pointPolygonTest(pts, (float(pt[0]), float(pt[1])), False) >= 0


# ── Anti-duplicate tracking params ───────────────────────────────────────────
# Xe phải xuất hiện liên tục ít nhất N frame trước khi được đếm
# Tránh đếm xe "ma" chỉ detect 1-2 frame rồi biến mất
MIN_PERSIST  = 6    # frames liên tiếp để confirm xe thật

# Khi tracker mất 1 xe rồi redetect với tid mới, check xem đó có phải xe cũ không
# bằng cách so sánh vị trí (cx, cy) và class
LOST_TIMEOUT = 30   # số frame nhớ xe đã mất (để spatial re-ID)
REID_DIST    = 100  # pixel — nếu tid mới xuất hiện trong vòng tròn này với xe đã đếm → duplicate


# ── Video processing thread ───────────────────────────────────────────────────
def video_loop():
    model   = YOLO(MODEL_PATH)
    cls_ids = [k for k, v in model.names.items() if v in TARGET_NAMES]
    cap     = cv2.VideoCapture(VIDEO_PATH)

    if not cap.isOpened():
        print(f"Cannot open: {VIDEO_PATH}")
        return

    print(f"Start — {FRAME_W}x{FRAME_H}")

    # ── Local tracking state ──────────────────────────────────────────────────
    # Số frame liên tiếp mỗi tid được nhìn thấy (chưa đếm)
    tid_persist: dict[int, int] = {}

    # Vị trí cuối của MỌI tid đang active trong frame
    tid_last_pos: dict[int, tuple] = {}  # tid → (cx, cy, name)

    # Xe đã đếm rồi bị mất: lưu để spatial re-ID khi redetect
    # lost_catalog: tid → (cx, cy, name, frame khi mất)
    lost_catalog: dict[int, tuple] = {}

    frame_idx = 0

    while True:
        ret, raw = cap.read()
        if not ret:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            continue

        frame_idx += 1
        frame = cv2.resize(raw, (FRAME_W, FRAME_H))
        results = model.track(frame, persist=True, classes=cls_ids, verbose=False)

        has_zone   = len(shared.roi_points) >= 3
        frame_dets = []
        current_tids: set[int] = set()

        if results[0].boxes.id is not None:
            bboxes = results[0].boxes.xyxy.cpu().numpy().astype(int)
            tids   = results[0].boxes.id.cpu().numpy().astype(int)
            clss   = results[0].boxes.cls.cpu().numpy().astype(int)
            confs  = results[0].boxes.conf.cpu().numpy()

            for box, tid_raw, cid, conf in zip(bboxes, tids, clss, confs):
                x1, y1, x2, y2 = box
                name = model.names[cid]
                tid  = int(tid_raw)
                cx, cy = (x1 + x2) // 2, (y1 + y2) // 2

                current_tids.add(tid)
                in_roi = point_in_roi((cx, cy)) if has_zone else True

                # ──────────────────────────────────────────────────────────────
                # BƯỚC 1: Chọn set đếm theo mode (zone / toàn frame)
                #   seen_set      = set các tid đã được đếm chính thức
                #   seen_ids_ref  = shared.seen_ids hoặc shared.zone_seen_ids
                # ──────────────────────────────────────────────────────────────
                if has_zone:
                    seen_set = shared.zone_seen_ids
                    should_count_this = in_roi  # chỉ đếm khi đang trong zone
                else:
                    seen_set = shared.seen_ids
                    should_count_this = True     # đếm mọi xe

                # ──────────────────────────────────────────────────────────────
                # BƯỚC 2: Nếu tid chưa được đếm
                # ──────────────────────────────────────────────────────────────
                if tid not in seen_set and should_count_this:

                    # ── Spatial Re-ID: kiểm tra xem tid mới có phải xe cũ bị mất track ──
                    is_reappear = False
                    for lost_tid, (lx, ly, lname, lost_at) in list(lost_catalog.items()):
                        # Chỉ xét xe cùng class và mất trong vòng LOST_TIMEOUT frames
                        if lname != name:
                            continue
                        if (frame_idx - lost_at) > LOST_TIMEOUT:
                            del lost_catalog[lost_tid]
                            continue
                        dist = math.hypot(cx - lx, cy - ly)
                        if dist <= REID_DIST:
                            # Đây là xe cũ bị assign tid mới → KHÔNG đếm thêm
                            # Đánh dấu tid mới này là "đã đếm" để không đếm sau này
                            seen_set.add(tid)
                            is_reappear = True
                            # Cập nhật vị trí trong lost_catalog với tid mới
                            del lost_catalog[lost_tid]
                            break

                    if not is_reappear:
                        # ── Minimum Persistence: chỉ đếm sau khi thấy liên tục N frames ──
                        tid_persist[tid] = tid_persist.get(tid, 0) + 1
                        if tid_persist[tid] >= MIN_PERSIST:
                            seen_set.add(tid)
                            with shared.state_lock:
                                shared.state["counts"][name] += 1
                            tid_persist.pop(tid, None)  # không cần track nữa

                # Cập nhật vị trí cuối của tid
                tid_last_pos[tid] = (cx, cy, name)

                frame_dets.append({
                    "name":   name,
                    "tid":    tid,
                    "x1": int(x1), "y1": int(y1),
                    "x2": int(x2), "y2": int(y2),
                    "in_roi": in_roi,
                })

        # ── Dọn dẹp các tid đã biến mất khỏi frame ──────────────────────────
        disappeared = set(tid_last_pos.keys()) - current_tids
        for gone_tid in disappeared:
            cx, cy, name = tid_last_pos.pop(gone_tid)
            # Nếu xe đã được đếm → lưu vào lost_catalog để spatial re-ID sau
            seen_set = shared.zone_seen_ids if has_zone else shared.seen_ids
            if gone_tid in seen_set:
                lost_catalog[gone_tid] = (cx, cy, name, frame_idx)
            # Bỏ khỏi persist nếu chưa đủ frames
            tid_persist.pop(gone_tid, None)

        # ── Dọn lost_catalog hết hạn ─────────────────────────────────────────
        expired = [t for t, (_, _, _, f) in lost_catalog.items() if frame_idx - f > LOST_TIMEOUT]
        for t in expired:
            lost_catalog.pop(t, None)

        # ── Cập nhật shared state ─────────────────────────────────────────────
        with shared.state_lock:
            shared.state["frame_idx"] += 1
        shared.detections = frame_dets

        # Stream raw frame (không vẽ gì lên)
        _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 82])
        with shared.frame_lock:
            shared.latest_frame = buf.tobytes()


# ── FastAPI app ───────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    t = threading.Thread(target=video_loop, daemon=True)
    t.start()
    print("\n" + "="*45)
    print("   http://localhost:8000")
    print("="*45 + "\n")
    yield

app = FastAPI(title="Vehicle Counter", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.include_router(router.router)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
