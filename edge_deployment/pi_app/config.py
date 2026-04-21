"""
Eyeway App Configuration
========================
Theme colors, paths, and constants for the application.
"""

import json
import os
import platform as _platform
from pathlib import Path

# --- Hybrid: local YOLO + cloud depth fusion (required for field deployment) ---
# Default: hybrid ON, Modal fusion URL. Override EYEWAY_HYBRID_URL for another host.
# Local fusion only: EYEWAY_HYBRID_URL=http://127.0.0.1:8080
# Disable hybrid POSTs (local-only dev): EYEWAY_HYBRID=0
def _hybrid_enabled() -> bool:
    raw = os.environ.get("EYEWAY_HYBRID", "").strip().lower()
    if raw in ("0", "false", "no", "off"):
        return False
    return True


HYBRID_MODE = _hybrid_enabled()
_DEFAULT_FUSION_URL = (
    "https://lfortin-master--eyeway-fusion-fusion-service.modal.run"
)
HYBRID_CLOUD_URL = os.environ.get(
    "EYEWAY_HYBRID_URL", _DEFAULT_FUSION_URL,
).rstrip("/")
HYBRID_CLOUD_PATH = os.environ.get("EYEWAY_HYBRID_PATH", "/v1/depth/infer")
# NOTE: ``EYEWAY_HYBRID_INTERVAL`` used to throttle cloud POSTs globally, but
# that meant only one pothole per interval could be sent even when several
# were on screen. Gating is now per-track (inflight set), so the global
# interval constant has been removed.
HYBRID_HTTP_TIMEOUT_S = float(os.environ.get("EYEWAY_HYBRID_TIMEOUT", "120"))
# Minimum YOLO confidence (0–1) before queuing a fusion POST to Modal.
HYBRID_MIN_CONFIDENCE = float(os.environ.get("EYEWAY_HYBRID_MIN_CONF", "0.6"))


def _env_float(name: str) -> float | None:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


# Optional fixed GPS for fusion + Supabase (vehicle hub or survey point).
# Used as a *fallback* when no live GPS fix is available. If the Pi has a
# GPS receiver (see EYEWAY_GPS_DEVICE below), GpsMonitor supplies live
# coordinates that override these.
HYBRID_GPS_LAT = _env_float("EYEWAY_GPS_LAT")
HYBRID_GPS_LON = _env_float("EYEWAY_GPS_LON")

# Live GPS (direct NMEA over serial). When EYEWAY_GPS_DEVICE is unset the
# GpsMonitor reports "nohw" and the app falls back to HYBRID_GPS_LAT/LON.
# Typical values on a Pi: /dev/ttyUSB0, /dev/ttyACM0, /dev/serial0.
GPS_DEVICE: str | None = os.environ.get("EYEWAY_GPS_DEVICE") or None
try:
    GPS_BAUD = int(os.environ.get("EYEWAY_GPS_BAUD", "9600"))
except ValueError:
    GPS_BAUD = 9600

# --- Path Configuration ---
APP_DIR = Path(__file__).parent.resolve()
SCRIPTS_DIR = APP_DIR / "scripts"
ASSETS_DIR = APP_DIR / "assets"
DATA_DIR = APP_DIR / "data"
MODELS_DIR = APP_DIR / "models"
CALIBRATION_SCRIPT = SCRIPTS_DIR / "01_calibration" / "extract_angle.py"
DISTANCE_SCRIPT = SCRIPTS_DIR / "da3_distance.py"
LOGO_PATH = ASSETS_DIR / "eyeway-logo.png"
CALIBRATION_FILE = DATA_DIR / "calibration.json"
LANE_OVERLAY_FILE = DATA_DIR / "lane_overlay.json"
VIDEO_PREFS_FILE = DATA_DIR / "video_source.json"
# Bundled sample (~39 s, 960p H.264) for dev / Mac file mode; see data/video_source.json.
VIDEO_SOURCE_FILE = DATA_DIR / "samples" / "10-20.mp4"

# Lane trapezoid (used for BOTH the on-screen overlay AND the detection ROI
# filter in geometry.filter_detections_by_lane_roi — single source of truth).
#
# Coordinates are fractions of the inference frame:
#   top_ratio            vertical position of the upper edge (0 = top of frame)
#   bottom_ratio         vertical position of the lower edge (must be > top_ratio)
#   bottom_half / top_half   half-width of the lower / upper edge, from centerline
#
# Defaults are tuned for a dashcam mount where the hood is visible and the
# driving lane covers ~70 % of the frame width at the bottom. Override by
# placing a JSON file at data/lane_overlay.json with any of these keys:
#   {"top_ratio": 0.28, "bottom_ratio": 0.85,
#    "bottom_half": 0.35, "top_half": 0.10}
LANE_TOP_RATIO_MIN = 0.15
LANE_TOP_RATIO_MAX = 0.45
# Direct top-row position (0 = frame top). When set, the trapezoid's upper
# edge is placed exactly here (still clamped to [MIN, MAX]), giving us a
# stable far-field horizon regardless of pitch. Set to ``None`` to fall back
# to the pitch-driven formula (``0.5 - pitch/180``), useful when the camera
# mount is adjustable and we want the ROI to track its angle.
LANE_TOP_RATIO = 0.20
# Wider defaults so the ROI covers the full driving lane on a wide-angle
# dashcam (was 0.35 / 0.10). If you still see potholes rejected at lane edges,
# raise bottom_half further via data/lane_overlay.json.
LANE_HALF_WIDTH_BOTTOM_RATIO = 0.45   # each side from centerline
LANE_HALF_WIDTH_TOP_RATIO = 0.13
# Where the trapezoid bottom sits. 0.72 stops just above the hood spoiler on
# our current Pi camera mount (hood visible from ~y=0.68). Lower this value
# if your hood occupies less of the frame.
LANE_BOTTOM_RATIO = 0.72
LANE_OVERLAY_DECIMALS = 4


def _load_lane_overlay_overrides() -> None:
    """Apply ``data/lane_overlay.json`` on top of the defaults, if present."""
    global LANE_HALF_WIDTH_BOTTOM_RATIO, LANE_HALF_WIDTH_TOP_RATIO
    global LANE_BOTTOM_RATIO, LANE_TOP_RATIO, LANE_TOP_RATIO_MIN, LANE_TOP_RATIO_MAX
    try:
        with open(LANE_OVERLAY_FILE, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return
    if not isinstance(data, dict):
        return

    def _clip(v, lo=0.0, hi=1.0):
        try:
            return max(lo, min(hi, float(v)))
        except (TypeError, ValueError):
            return None

    v = _clip(data.get("bottom_half"))
    if v is not None:
        LANE_HALF_WIDTH_BOTTOM_RATIO = v
    v = _clip(data.get("top_half"))
    if v is not None:
        LANE_HALF_WIDTH_TOP_RATIO = v
    v = _clip(data.get("bottom_ratio"))
    if v is not None:
        LANE_BOTTOM_RATIO = v
    if "top_ratio" in data:
        raw = data["top_ratio"]
        if raw is None:
            LANE_TOP_RATIO = None
        else:
            v = _clip(raw)
            if v is not None:
                LANE_TOP_RATIO = v
                LANE_TOP_RATIO_MIN = min(LANE_TOP_RATIO_MIN, v)
                LANE_TOP_RATIO_MAX = max(LANE_TOP_RATIO_MAX, v)


_load_lane_overlay_overrides()
_IS_PI = _platform.machine().startswith("aarch64")
# Pi always uses live USB camera; Mac dev environment defaults to video file.
USE_VIDEO_OVER_CAMERA = not _IS_PI
CAMERA_INDEX = 0  # /dev/video0 on Pi, built-in on Mac

# --- Theme Colors (Light Mode) ---
THEME_BG_COLOR = "#F8FAFC"       # Slate 50
THEME_CARD_COLOR = "#FFFFFF"     # White
THEME_ACCENT_COLOR = "#FA5B33"   # Brand Orange
THEME_ACCENT_HOVER = "#D94E2B"
THEME_TEXT_COLOR = "#0F172A"     # Slate 900
THEME_TEXT_SECONDARY = "#64748B" # Slate 500
# Minimal chrome (toolbar, dividers, neutral icon buttons) — used outside driving UI
THEME_TOOLBAR_BG = "#FFFFFF"
THEME_HAIRLINE = "#E2E8F0"
THEME_ICON_BUTTON_BG = "#E2E8F0"
THEME_ICON_BUTTON_HOVER = "#CBD5E1"
THEME_ICON_BUTTON_TEXT = "#334155"
# Stats accents (sidebar) — high contrast on white
THEME_STAT_POTHOLE = "#DC2626"
THEME_STAT_HAZARD = "#D97706"
# Primary toolbar control height (px)
THEME_TOOLBAR_CONTROL_HEIGHT = 44
