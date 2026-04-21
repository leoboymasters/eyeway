"""
EyewayApp — QMainWindow
=======================
Owns shared state, the QStackedWidget, SessionLogger, and NetworkMonitor.
Views are constructed once and never recreated.
"""
from __future__ import annotations

import json
import sys
import threading
from pathlib import Path

from PyQt5.QtCore import Qt, QTimer
from PyQt5.QtWidgets import (
    QApplication,
    QMainWindow,
    QSizePolicy,
    QStackedWidget,
)

from .config import (
    DATA_DIR, VIDEO_PREFS_FILE, VIDEO_SOURCE_FILE,
    USE_VIDEO_OVER_CAMERA, CAMERA_INDEX,
    CALIBRATION_SCRIPT,
    GPS_DEVICE, GPS_BAUD,
)
from .theme import LIGHT_QSS, DARK_QSS
from .session_logger import SessionLogger
from .network_monitor import NetworkMonitor
from .sync_worker import SyncWorker
from .gps_monitor import GpsMonitor
from .utils import import_from_path

# Lazy view imports (avoid importing cv2/onnx at module level before QApp exists)
from .views.splash import SplashView
from .views.wizard import WizardView
from .views.home import HomeView
from .views.results import ResultsView
from .views.dashboard import DashboardView


try:
    _extract_angle = import_from_path("extract_camera_angle", CALIBRATION_SCRIPT)
except Exception as e:
    print(f"Warning: could not import calibration script: {e}")
    _extract_angle = None


class EyewayApp(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Eyeway Dashboard")
        self.resize(1920, 1080)

        # Theme (default light)
        self._dark_mode = False
        QApplication.instance().setStyleSheet(LIGHT_QSS)

        # Shared state
        self.calibration_results = None
        self.saved_pitch: float | None = None
        self.video_source_path = Path(VIDEO_SOURCE_FILE)
        self.use_video_file: bool = USE_VIDEO_OVER_CAMERA
        self.model = None
        self.model_backend: str | None = None
        self._model_load_lock = threading.Lock()
        self.log_detections: bool = True  # persisted toggle

        self._load_saved_calibration()
        self._load_video_source_prefs()

        # Logger and network monitor
        self.logger = SessionLogger(DATA_DIR)
        # Honour persisted "log detections off" preference loaded above.
        # Without this, SessionLogger defaults to enabled and writes JSONL even
        # if the user disabled logging in a previous session.
        self.logger.detections_enabled = self.log_detections
        self.network_monitor = NetworkMonitor(self)

        # Views
        self._stack = QStackedWidget(self)
        _fill = QSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        self._stack.setSizePolicy(_fill)
        self.setCentralWidget(self._stack)

        self.splash_view = SplashView(self)
        self.wizard_view = WizardView(self)
        self.home_view = HomeView(self)
        self.results_view = ResultsView(self)
        self.dashboard_view = DashboardView(self)

        for v in (self.splash_view, self.wizard_view, self.home_view,
                  self.results_view, self.dashboard_view):
            v.setSizePolicy(_fill)
            self._stack.addWidget(v)

        self._view_map = {
            "splash":    self.splash_view,
            "wizard":    self.wizard_view,
            "home":      self.home_view,
            "results":   self.results_view,
            "dashboard": self.dashboard_view,
        }

        # Wire network badge into dashboard
        self.network_monitor.status_changed.connect(
            self.dashboard_view.on_network_status)
        self.network_monitor.start()

        # Live GPS monitor. Safe to start even with no device: GpsMonitor
        # emits "nohw" once and blocks on its stop-event forever, so there's
        # zero overhead when the Pi has no receiver attached.
        self.gps_monitor = GpsMonitor(device=GPS_DEVICE, baud=GPS_BAUD, parent=self)
        self.gps_monitor.status_changed.connect(
            self.dashboard_view.on_gps_status)
        self.gps_monitor.start()

        # Offline sync worker
        self._sync_worker = SyncWorker()
        self._sync_worker.sync_status.connect(self._on_sync_status)
        self._sync_worker.uploaded_total.connect(
            self.dashboard_view.update_uploaded_total)
        self._sync_worker.sync_error.connect(
            lambda msg: self.logger.event("WARN", f"SyncWorker: {msg}"))
        self._sync_worker.start()

        # Wire logger toggle from dashboard
        self.dashboard_view.log_toggle_changed.connect(self._on_log_toggle)

        # Wire logger entries into dashboard drawer
        self.logger.log_entry.connect(self.dashboard_view.on_log_entry)

        # Fullscreen on macOS and Linux (Raspberry Pi kiosk).
        if sys.platform == "darwin" or sys.platform.startswith("linux"):
            self.showFullScreen()
        else:
            self.showMaximized()

        self.show_view("splash")
        self.logger.event("INFO", "App initialized")

        # Preload model in background
        threading.Thread(target=self._load_model, daemon=True).start()

    # ------------------------------------------------------------------
    # View switching
    # ------------------------------------------------------------------

    def show_view(self, name: str) -> None:
        view = self._view_map.get(name)
        if view is None:
            return
        self._stack.setCurrentWidget(view)
        if name == "splash":
            self.splash_view.start_sequence()
        elif name == "dashboard":
            self.dashboard_view.start_capture(
                source=str(self.video_source_path) if self.use_video_file
                       else CAMERA_INDEX,
                model=self.model,
                model_backend=self.model_backend,
                saved_pitch=self.saved_pitch or 45.0,
            )
            src_desc = ('video: ' + Path(self.video_source_path).name
                        if self.use_video_file else 'live camera')
            self.logger.event("INFO", f"Dashboard started - {src_desc}")

    # ------------------------------------------------------------------
    # Theme toggle
    # ------------------------------------------------------------------

    def toggle_theme(self) -> None:
        self._dark_mode = not self._dark_mode
        QApplication.instance().setStyleSheet(
            DARK_QSS if self._dark_mode else LIGHT_QSS)

    # ------------------------------------------------------------------
    # Persistence helpers
    # ------------------------------------------------------------------

    def _load_saved_calibration(self) -> None:
        cal_file = DATA_DIR / "calibration.json"
        if cal_file.exists():
            try:
                data = json.loads(cal_file.read_text())
                self.saved_pitch = float(data.get("pitch", 45.0))
            except Exception:
                pass

    def _load_video_source_prefs(self) -> None:
        if VIDEO_PREFS_FILE.exists():
            try:
                data = json.loads(VIDEO_PREFS_FILE.read_text())
                self.use_video_file = bool(
                    data.get("use_video_file", USE_VIDEO_OVER_CAMERA))
                raw_path = data.get("path", str(VIDEO_SOURCE_FILE))
                self.video_source_path = Path(raw_path)
                self.log_detections = bool(data.get("log_detections", True))
            except Exception:
                pass

    def save_video_source_prefs(self) -> None:
        try:
            VIDEO_PREFS_FILE.write_text(json.dumps({
                "use_video_file": self.use_video_file,
                "path": str(self.video_source_path),
                "log_detections": self.log_detections,
            }))
        except Exception:
            pass

    # ------------------------------------------------------------------
    # Model loading
    # ------------------------------------------------------------------

    def _load_model(self) -> None:
        from .inference import OnnxDetector
        with self._model_load_lock:
            if self.model is not None:
                return
            models_dir = Path(__file__).parent / "models"
            onnx_int8 = models_dir / "eyeway_v9_int8.onnx"
            onnx_fp32 = models_dir / "eyeway_v9.onnx"
            pt_path = models_dir / "eyeway_v9.pt"
            if onnx_int8.exists():
                path, backend = onnx_int8, "onnx_int8"
            elif onnx_fp32.exists():
                path, backend = onnx_fp32, "onnx_fp32"
            elif pt_path.exists():
                path, backend = pt_path, "pytorch"
            else:
                self.logger.event("ERROR", "No model found in models/")
                return
            try:
                if backend in ("onnx_int8", "onnx_fp32"):
                    self.model = OnnxDetector(path)
                else:
                    from ultralytics import YOLO
                    self.model = YOLO(str(path))
                self.model_backend = backend
                self.logger.event("INFO", f"Model loaded: {backend}")
                # If dashboard is already showing (started before model was ready),
                # restart capture now with the real model.
                QTimer.singleShot(0, self._restart_capture_if_dashboard_active)
            except Exception as e:
                msg = f"Model load failed: {e}"
                try:
                    self.logger.event("ERROR", msg)
                except Exception:
                    print(msg, file=sys.stderr)

    def _restart_capture_if_dashboard_active(self) -> None:
        """Called on the main thread after model finishes loading.
        If the dashboard is already the visible view, restart capture
        so the worker gets the real model instead of the None it had at
        splash-completion time."""
        if self._stack.currentWidget() is self.dashboard_view:
            self.show_view("dashboard")

    # ------------------------------------------------------------------
    # Slots
    # ------------------------------------------------------------------

    def _on_log_toggle(self, enabled: bool) -> None:
        self.log_detections = enabled
        self.logger.detections_enabled = enabled
        self.save_video_source_prefs()

    def _on_sync_status(self, pending: int) -> None:
        self.dashboard_view.update_sync_badge(pending)

    # ------------------------------------------------------------------
    # Shutdown
    # ------------------------------------------------------------------

    def closeEvent(self, event) -> None:
        self.network_monitor.stop()
        self._sync_worker.stop()
        try:
            self.gps_monitor.stop()
        except Exception:
            pass
        self.dashboard_view.stop_capture()
        self.logger.close()
        event.accept()
