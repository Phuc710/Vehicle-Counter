import threading
from config import TARGET_NAMES, DEFAULT_ROI

# Trạng thái đếm xe - tích lũy (chỉ tăng, không giảm)
state = {
    # Mode không zone: số xe đã từng xuất hiện, mỗi tid chỉ đếm 1 lần
    # Mode có zone   : số xe đã từng vào zone,  mỗi tid chỉ đếm 1 lần
    "counts":     {n: 0 for n in TARGET_NAMES},
    "frame_idx":  0,
}
state_lock = threading.Lock()

# Khung hình mới nhất (raw, không vẽ)
latest_frame: bytes = b""
frame_lock = threading.Lock()

# Vùng ROI
roi_points = [list(p) for p in DEFAULT_ROI]

# Set tracking IDs đã được đếm rồi (chống duplicate)
# Khi có zone:    tid vào zone  → +1 vào zone_seen_ids
# Khi không zone: tid xuất hiện → +1 vào seen_ids
seen_ids      = set()  # xe toàn frame đã đếm
zone_seen_ids = set()  # xe trong zone đã đếm

# Detections hiện tại (frontend vẽ bbox)
detections = []   # list of {name, tid, x1, y1, x2, y2, in_roi}
