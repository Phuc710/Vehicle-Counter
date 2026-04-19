import os
import numpy as np

BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
VIDEO_PATH = os.path.join(BASE_DIR, "test2.mp4")   # 0 = webcam
MODEL_PATH = os.path.join(BASE_DIR, "yolov8n.pt")
ZONE_FILE  = os.path.join(BASE_DIR, "zone.json")
STATIC_DIR = os.path.join(BASE_DIR, "static")

TARGET_NAMES  = ["car", "truck", "bus", "motorcycle"]

FRAME_W = 1280
FRAME_H = 720

DEFAULT_ROI = []

COLOR_GREEN  = (  0, 255,   0)
COLOR_RED    = (  0,   0, 255)
COLOR_YELLOW = (  0, 255, 255)
COLOR_WHITE  = (255, 255, 255)

