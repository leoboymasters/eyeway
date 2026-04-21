"""
DashboardView
=============
Main operational interface. Owns a CaptureWorker, log drawer, toolbar.

Layout
------
Vertical:
  1. Toolbar (single row)
       [clock] [source segmented] [video-name hint]
       [DETECT CTA]                                  <stretch>
       [internet pill] [sync badge] [Rec] [Drawer] [Menu]
  2. Main area (horizontal)
       [video feed (fills)]   [sidebar: status chip + pothole/hazard cards
                               + collapsible log drawer]
"""
from __future__ import annotations

import platform
import threading
from datetime import datetime
from pathlib import Path

import numpy as np
from PyQt5.QtCore import Qt, QTimer, QUrl, QPoint, pyqtSignal, QSize
from PyQt5.QtGui import QImage, QPixmap, QTextCursor
from PyQt5.QtGui import QDesktopServices
from PyQt5.QtWidgets import (
    QAction, QFileDialog, QFrame, QHBoxLayout, QLabel,
    QMenu, QMessageBox, QPlainTextEdit, QPushButton, QSizePolicy, QSplitter,
    QTabWidget, QVBoxLayout, QWidget,
)

from ..config import CAMERA_INDEX, DATA_DIR
from ..capture_worker import CaptureWorker
from ..recording_compress import compress_recording_inplace
from ..theme import COLORS

_IS_PI5 = platform.machine().startswith("aarch64")
_MAX_DET_LINES = 200
_MAX_EVT_LINES = 500

_NET_COLORS = {
    "online":  COLORS["online"],
    "slow":    COLORS["slow"],
    "offline": COLORS["offline"],
}

# GPS chip follows the same traffic-light palette as the Internet chip:
#   live  → green (valid fix, lat/lon flowing to fusion POSTs)
#   nofix → amber (hardware present, searching for satellites)
#   nohw  → red   (no device configured or serial error)
_GPS_COLORS = {
    "live":  COLORS["online"],
    "nofix": COLORS["slow"],
    "nohw":  COLORS["offline"],
}

# Primary touch-friendly control height (px)
_BTN_H = 44
_CTA_H = 48


class DashboardView(QWidget):
    log_toggle_changed = pyqtSignal(bool)   # emitted when log-detections toggled

    _SOURCE_CAMERA = "Camera"
    _SOURCE_VIDEO = "Video"

    def __init__(self, app, parent=None):
        super().__init__(parent)
        self._app = app
        self._worker: CaptureWorker | None = None
        self._detection_on = False
        # Most recent live GPS fix (or None if we're not in state="live"). Used
        # to seed a freshly-started CaptureWorker with the current position so
        # the first fusion POST doesn't miss the fix purely because of timing.
        self._last_gps_lat: float | None = None
        self._last_gps_lon: float | None = None
        self._is_recording = False
        self._recording_start: datetime | None = None
        self._recording_output_path: Path | None = None
        self._rec_timer = QTimer(self)
        self._rec_timer.setInterval(1000)
        self._rec_timer.timeout.connect(self._update_rec_elapsed)

        self._build_ui()

        # Clock
        self._clock_timer = QTimer(self)
        self._clock_timer.setInterval(1000)
        self._clock_timer.timeout.connect(self._update_clock)
        self._clock_timer.start()
        self._update_clock()

    # ==================================================================
    # UI Construction
    # ==================================================================

    def _build_ui(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(20, 16, 20, 16)
        root.setSpacing(12)

        root.addWidget(self._build_toolbar())

        # ---- Main area: video (left) + sidebar (right) ----
        main_area = QHBoxLayout()
        main_area.setContentsMargins(0, 0, 0, 0)
        main_area.setSpacing(14)

        main_area.addWidget(self._build_video_panel(), 4)
        main_area.addWidget(self._build_sidebar(), 0)

        root.addLayout(main_area, 1)

        self._refresh_source_ui()
        self._sync_detection_button()
        self._sync_log_toggle_button()

        self.setAcceptDrops(True)

    # ------------------------------------------------------------------
    # Toolbar
    # ------------------------------------------------------------------

    def _build_toolbar(self) -> QFrame:
        toolbar = QFrame()
        toolbar.setObjectName("toolbar")
        toolbar.setFixedHeight(76)

        row = QHBoxLayout(toolbar)
        row.setContentsMargins(18, 10, 18, 10)
        row.setSpacing(14)

        # --- Clock / date block ---
        clock_block = QVBoxLayout()
        clock_block.setSpacing(0)
        self._time_label = QLabel("--:--")
        self._time_label.setStyleSheet(
            "font-size: 22px; font-weight: 700; letter-spacing: 0.5px;")
        self._date_label = QLabel("")
        self._date_label.setStyleSheet(
            f"font-size: 12px; color: {COLORS['text_secondary']};")
        clock_block.addWidget(self._time_label)
        clock_block.addWidget(self._date_label)
        row.addLayout(clock_block)

        row.addWidget(self._vline())

        # --- Source segmented control ---
        source_group = QHBoxLayout()
        source_group.setSpacing(0)
        self._btn_camera = QPushButton(self._SOURCE_CAMERA)
        self._btn_camera.setObjectName("segLeft")
        self._btn_camera.setCheckable(True)
        self._btn_camera.setFixedHeight(_BTN_H)
        self._btn_camera.setMinimumWidth(96)
        self._btn_camera.setToolTip("Use the live USB camera as the video source.")
        self._btn_camera.clicked.connect(self._on_use_live_camera)

        self._btn_video = QPushButton(self._SOURCE_VIDEO)
        self._btn_video.setObjectName("segRight")
        self._btn_video.setCheckable(True)
        self._btn_video.setFixedHeight(_BTN_H)
        self._btn_video.setMinimumWidth(96)
        self._btn_video.setToolTip(
            "Open a video file for playback (or drop a file on the window).")
        self._btn_video.clicked.connect(self._on_pick_video_file)

        source_group.addWidget(self._btn_camera)
        source_group.addWidget(self._btn_video)
        row.addLayout(source_group)

        # --- Source filename hint (only shown when Video is selected) ---
        self._source_hint = QLabel("")
        self._source_hint.setStyleSheet(
            f"color: {COLORS['text_secondary']}; font-size: 12px;")
        self._source_hint.setMinimumWidth(0)
        self._source_hint.setMaximumWidth(320)
        self._source_hint.setTextInteractionFlags(Qt.TextSelectableByMouse)
        row.addWidget(self._source_hint)

        row.addSpacing(8)

        # --- Primary CTA: Start / Stop detection ---
        self._det_btn = QPushButton("Start detection")
        self._det_btn.setObjectName("primaryCta")
        self._det_btn.setFixedHeight(_CTA_H)
        self._det_btn.setMinimumWidth(180)
        self._det_btn.setToolTip(
            "Run road-hazard detection on the feed. When off, only the "
            "camera or video preview is shown (no model, counts, or uploads)."
        )
        self._det_btn.clicked.connect(self._toggle_detection)
        row.addWidget(self._det_btn)

        row.addStretch(1)

        # --- GPS chip (live NMEA fix) ---
        row.addWidget(self._build_gps_chip())

        # --- Internet reachability chip ---
        row.addWidget(self._build_net_chip())

        # --- Offline sync badge (hidden unless queued) ---
        self._sync_badge = QLabel()
        self._sync_badge.setObjectName("syncBadge")
        self._sync_badge.setToolTip("Detections queued for upload when online")
        self._sync_badge.hide()
        row.addWidget(self._sync_badge)

        # --- Record ---
        self._rec_btn = QPushButton("● Rec")
        self._rec_btn.setObjectName("recBtn")
        self._rec_btn.setCheckable(True)
        self._rec_btn.setFixedHeight(_BTN_H)
        self._rec_btn.setMinimumWidth(96)
        self._rec_btn.setToolTip("Record the current video feed to a local MP4 file.")
        self._rec_btn.clicked.connect(self._toggle_recording)
        row.addWidget(self._rec_btn)

        # --- Drawer toggle ---
        self._logs_btn = QPushButton("Logs")
        self._logs_btn.setFixedHeight(_BTN_H)
        self._logs_btn.setMinimumWidth(72)
        self._logs_btn.setToolTip("Show or hide the log drawer.")
        self._logs_btn.clicked.connect(self._toggle_drawer)
        row.addWidget(self._logs_btn)

        # --- Menu (overflow) ---
        self._menu_btn = QPushButton("⋯")
        self._menu_btn.setObjectName("iconBtn")
        self._menu_btn.setFixedSize(_BTN_H, _BTN_H)
        self._menu_btn.setToolTip("More actions")
        self._menu_btn.clicked.connect(self._show_menu)
        row.addWidget(self._menu_btn)

        return toolbar

    def _build_net_chip(self) -> QFrame:
        net_block = QFrame()
        net_block.setObjectName("netChip")
        net_block.setFixedHeight(_BTN_H)

        net_layout = QHBoxLayout(net_block)
        net_layout.setContentsMargins(12, 6, 14, 6)
        net_layout.setSpacing(8)

        self._net_dot = QLabel("●")
        self._net_dot.setObjectName("netChipDot")
        self._net_dot.setStyleSheet(
            f"color: {COLORS['text_muted']}; background: transparent; "
            "font-size: 14px;")

        self._net_title = QLabel("Internet")
        self._net_title.setObjectName("netChipText")
        self._net_title.setStyleSheet(
            f"color: {COLORS['text_secondary']}; background: transparent; "
            "font-size: 12px; font-weight: 600;")

        self._net_status = QLabel("Checking…")
        self._net_status.setObjectName("netChipText")
        self._net_status.setStyleSheet(
            f"color: {COLORS['text_primary']}; background: transparent; "
            "font-size: 13px; font-weight: 600;")

        _net_tip_initial = (
            "Checking whether this device can reach the public internet "
            "(quick test to Google DNS, not Wi-Fi bars)."
        )
        for w in (net_block, self._net_dot, self._net_title, self._net_status):
            w.setToolTip(_net_tip_initial)

        net_layout.addWidget(self._net_dot)
        net_layout.addWidget(self._net_title)
        net_layout.addWidget(self._net_status)
        return net_block

    def _build_gps_chip(self) -> QFrame:
        """Traffic-light chip mirroring the Internet chip; tooltip carries coords."""
        gps_block = QFrame()
        # Reuse netChip QSS so the two chips are visually consistent.
        gps_block.setObjectName("netChip")
        gps_block.setFixedHeight(_BTN_H)

        gps_layout = QHBoxLayout(gps_block)
        gps_layout.setContentsMargins(12, 6, 14, 6)
        gps_layout.setSpacing(8)

        self._gps_dot = QLabel("●")
        self._gps_dot.setObjectName("netChipDot")
        self._gps_dot.setStyleSheet(
            f"color: {COLORS['text_muted']}; background: transparent; "
            "font-size: 14px;")

        self._gps_title = QLabel("GPS")
        self._gps_title.setObjectName("netChipText")
        self._gps_title.setStyleSheet(
            f"color: {COLORS['text_secondary']}; background: transparent; "
            "font-size: 12px; font-weight: 600;")

        self._gps_status = QLabel("Checking…")
        self._gps_status.setObjectName("netChipText")
        self._gps_status.setStyleSheet(
            f"color: {COLORS['text_primary']}; background: transparent; "
            "font-size: 13px; font-weight: 600;")

        _gps_tip_initial = (
            "Live GPS status from the serial NMEA receiver.\n"
            "Coordinates are attached to every cloud-fusion POST so "
            "confirmed potholes get the right location in Supabase."
        )
        for w in (gps_block, self._gps_dot, self._gps_title, self._gps_status):
            w.setToolTip(_gps_tip_initial)

        gps_layout.addWidget(self._gps_dot)
        gps_layout.addWidget(self._gps_title)
        gps_layout.addWidget(self._gps_status)
        return gps_block

    @staticmethod
    def _vline() -> QFrame:
        ln = QFrame()
        ln.setFrameShape(QFrame.VLine)
        ln.setFixedWidth(1)
        ln.setStyleSheet(f"color: {COLORS['hairline']};"
                         f"background: {COLORS['hairline']};")
        ln.setMaximumHeight(44)
        return ln

    @staticmethod
    def _lane_stat_card(
        frame_object_name: str,
        value_label: QLabel,
        caption: QLabel,
        tooltip: str,
        sub_label: QLabel | None = None,
    ) -> QFrame:
        """Single lane-metric card: big digit + caption (+ optional sub-line)."""
        card = QFrame()
        card.setObjectName(frame_object_name)
        card.setMinimumHeight(170)
        card.setMinimumWidth(120)
        card.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Minimum)
        card.setToolTip(tooltip)
        value_label.setToolTip(tooltip)
        caption.setToolTip(tooltip)
        if sub_label is not None:
            sub_label.setToolTip(tooltip)

        lay = QVBoxLayout(card)
        lay.setContentsMargins(12, 14, 12, 16)
        lay.setSpacing(0)

        inner = QWidget()
        inner.setAttribute(Qt.WA_TranslucentBackground)
        inner.setStyleSheet("background: transparent; border: none;")
        inner_l = QVBoxLayout(inner)
        inner_l.setContentsMargins(0, 0, 0, 0)
        inner_l.setSpacing(4)
        inner_l.addWidget(value_label, 0, Qt.AlignHCenter)
        inner_l.addWidget(caption, 0, Qt.AlignHCenter)
        if sub_label is not None:
            inner_l.addSpacing(4)
            inner_l.addWidget(sub_label, 0, Qt.AlignHCenter)

        lay.addStretch(1)
        lay.addWidget(inner, 0, Qt.AlignHCenter)
        lay.addStretch(1)
        return card

    # ------------------------------------------------------------------
    # Video panel
    # ------------------------------------------------------------------

    def _build_video_panel(self) -> QFrame:
        container = QFrame()
        container.setStyleSheet(
            "QFrame {"
            "background: #000000;"
            "border: 1px solid " + COLORS["hairline"] + ";"
            "border-radius: 14px;"
            "}"
        )
        lay = QVBoxLayout(container)
        lay.setContentsMargins(0, 0, 0, 0)

        self._video_label = QLabel(
            "No source — choose Video or drop a video file on the window.")
        self._video_label.setAlignment(Qt.AlignCenter)
        self._video_label.setSizePolicy(
            QSizePolicy.Expanding, QSizePolicy.Expanding)
        self._video_label.setStyleSheet(
            "background: #000000; color: #94A3B8; border: none; "
            "border-radius: 14px; font-size: 15px;")
        lay.addWidget(self._video_label)
        return container

    # ------------------------------------------------------------------
    # Sidebar: status chip + stats cards + (splitter) drawer
    # ------------------------------------------------------------------

    def _build_sidebar(self) -> QWidget:
        right_panel = QWidget()
        right_panel.setFixedWidth(340)
        right_panel.setSizePolicy(QSizePolicy.Fixed, QSizePolicy.Expanding)
        right_layout = QVBoxLayout(right_panel)
        right_layout.setContentsMargins(0, 0, 0, 0)
        right_layout.setSpacing(0)

        # ---- Top: status chip + stats cards ----
        top = QWidget()
        top_layout = QVBoxLayout(top)
        top_layout.setContentsMargins(4, 2, 4, 8)
        top_layout.setSpacing(12)

        # Detection status chip
        self._status_chip = QLabel("DETECTION PAUSED")
        self._status_chip.setObjectName("statusChip")
        self._status_chip.setAlignment(Qt.AlignCenter)
        top_layout.addWidget(self._status_chip, 0, Qt.AlignLeft)

        section = QLabel("Road scan")
        section.setObjectName("sectionTitle")
        top_layout.addWidget(section)

        # Two cards:
        #  - "Potholes in lane" (now) — real-time count
        #  - "Session total"         — unique confirmed potholes since capture
        #                               started, with the last known cloud
        #                               depth as a sub-line.
        cards_row = QHBoxLayout()
        cards_row.setSpacing(10)

        self._pothole_val = QLabel("0")
        self._pothole_val.setObjectName("statPothole")
        self._pothole_val.setAlignment(Qt.AlignHCenter)
        self._pothole_val.setAutoFillBackground(False)
        pot_caption = QLabel("Potholes in lane")
        pot_caption.setObjectName("statCaptionPothole")
        pot_caption.setAlignment(Qt.AlignHCenter)
        pot_caption.setWordWrap(False)
        pot_card = self._lane_stat_card(
            "potCard",
            self._pothole_val,
            pot_caption,
            "Pothole-class regions in your lane right now, merged when they "
            "overlap the same road spot.\nOrange boxes on the video.",
            sub_label=None,
        )

        self._session_val = QLabel("0")
        self._session_val.setObjectName("statSession")
        self._session_val.setAlignment(Qt.AlignHCenter)
        self._session_val.setAutoFillBackground(False)
        session_caption = QLabel("Session total")
        session_caption.setObjectName("statCaptionSession")
        session_caption.setAlignment(Qt.AlignHCenter)
        session_caption.setWordWrap(False)
        self._nearest_label = QLabel("Nearest: —")
        self._nearest_label.setObjectName("nearestLine")
        self._nearest_label.setAlignment(Qt.AlignHCenter)
        self._nearest_label.setWordWrap(False)
        session_card = self._lane_stat_card(
            "sessionCard",
            self._session_val,
            session_caption,
            "Unique potholes this detection session "
            "(since detection was started or the source was changed).\n"
            "\"Nearest\" shows the last depth reported by the cloud fusion "
            "service and fades to — when no fresh reading is available.",
            sub_label=self._nearest_label,
        )

        cards_row.addWidget(pot_card)
        cards_row.addWidget(session_card)

        top_layout.addLayout(cards_row)

        # Compact health / upload status line under the cards.
        # Intentionally text-only (no large digits) — it's a glance-check,
        # not a primary metric.
        self._status_line = QLabel("— fps · — ms · Uploaded 0 · Pending 0")
        self._status_line.setObjectName("statusLine")
        self._status_line.setAlignment(Qt.AlignHCenter)
        self._status_line.setToolTip(
            "Live system health.\n"
            "• fps — how many frames the Pi is processing per second\n"
            "• ms  — last YOLO inference time on the Pi\n"
            "• Uploaded — cloud fusion confirmations this session\n"
            "• Pending  — detections still waiting in the offline queue"
        )
        top_layout.addSpacing(8)
        top_layout.addWidget(self._status_line)

        # Session counters for the status line.
        self._pending_count = 0
        self._uploaded_total = 0
        self._live_cloud_ok = 0    # direct hybrid successes from CaptureWorker
        self._last_fps = 0.0
        self._last_latency_ms = 0.0

        top_layout.addStretch(1)

        # ---- Bottom: log drawer ----
        drawer = QWidget()
        drawer.setObjectName("logDrawer")
        drawer_layout = QVBoxLayout(drawer)
        drawer_layout.setContentsMargins(4, 8, 4, 2)
        drawer_layout.setSpacing(8)

        drawer_header = QHBoxLayout()
        drawer_header.setSpacing(8)

        drawer_title = QLabel("Activity")
        drawer_title.setObjectName("sectionTitle")
        drawer_header.addWidget(drawer_title)
        drawer_header.addStretch()

        self._clear_btn = QPushButton("Clear")
        self._clear_btn.setObjectName("drawerBtn")
        self._clear_btn.setFixedHeight(32)
        self._clear_btn.setMinimumWidth(72)
        self._clear_btn.clicked.connect(self._clear_logs)
        drawer_header.addWidget(self._clear_btn)

        self._open_folder_btn = QPushButton("Open")
        self._open_folder_btn.setObjectName("drawerBtn")
        self._open_folder_btn.setFixedHeight(32)
        self._open_folder_btn.setMinimumWidth(72)
        self._open_folder_btn.setToolTip("Open logs folder in the file manager")
        self._open_folder_btn.clicked.connect(self._open_log_folder)
        drawer_header.addWidget(self._open_folder_btn)

        drawer_layout.addLayout(drawer_header)

        self._tabs = QTabWidget()
        self._tabs.setObjectName("logTabs")
        self._tabs.tabBar().setExpanding(True)
        self._det_log = QPlainTextEdit()
        self._det_log.setObjectName("logPane")
        self._det_log.setReadOnly(True)
        self._evt_log = QPlainTextEdit()
        self._evt_log.setObjectName("logPane")
        self._evt_log.setReadOnly(True)
        self._tabs.addTab(self._det_log, "Detections")
        self._tabs.addTab(self._evt_log, "Events")
        drawer_layout.addWidget(self._tabs)

        # Splitter: stats / drawer
        self._splitter = QSplitter(Qt.Vertical)
        self._splitter.setChildrenCollapsible(True)
        self._splitter.setHandleWidth(6)
        self._splitter.addWidget(top)
        self._splitter.addWidget(drawer)
        self._splitter.setSizes([1, 0])   # drawer hidden by default

        right_layout.addWidget(self._splitter)
        return right_panel

    # Offline sync badge is now defined in toolbar.

    # ==================================================================
    # Capture lifecycle
    # ==================================================================

    def start_capture(self, source, model, model_backend, saved_pitch):
        self.stop_capture()
        self._worker = CaptureWorker(
            source=source,
            model=model,
            model_backend=model_backend,
            saved_pitch=saved_pitch,
        )
        self._worker.frame_ready.connect(self._on_frame)
        self._worker.detection_event.connect(self._on_detection_event)
        self._worker.error.connect(self._on_worker_error)
        self._worker.start()
        self._worker.set_detection_enabled(self._detection_on)
        # Seed the new worker with the latest known fix. If there's no live
        # fix cached, this call is a no-op (worker keeps its static fallback).
        if self._last_gps_lat is not None and self._last_gps_lon is not None:
            self._worker.set_gps(self._last_gps_lat, self._last_gps_lon)
        self._sync_detection_button()

    def stop_capture(self):
        if self._worker is not None:
            if self._is_recording and self._recording_output_path is not None:
                self._worker.stop_recording()
                self._is_recording = False
                self._recording_start = None
                self._rec_timer.stop()
                path = self._recording_output_path
                self._recording_output_path = None
                self._rec_btn.setChecked(False)
                self._rec_btn.setText("● Rec")
                ok, msg = compress_recording_inplace(path)
                if not ok and msg:
                    self._app.logger.event("WARN", f"Recording compress: {msg}")
                elif msg == "skipped_no_ffmpeg":
                    self._app.logger.event(
                        "INFO",
                        "Recording saved (install ffmpeg to compress)",
                    )
            elif self._is_recording:
                self._stop_recording()
            self._worker.stop()
            self._worker = None

    # ==================================================================
    # Signal slots
    # ==================================================================

    def _on_frame(self, rgb: np.ndarray, stats: dict):
        h, w = rgb.shape[:2]
        img = QImage(rgb.data, w, h, 3 * w, QImage.Format_RGB888)
        pix = QPixmap.fromImage(img)
        tw, th = self._video_label.width(), self._video_label.height()
        pix = self._scale_pixmap_cover(pix, tw, th)
        self._video_label.setPixmap(pix)

        self._pothole_val.setText(str(stats.get("pothole_count", 0)))
        self._session_val.setText(str(stats.get("session_total", 0)))

        dist = stats.get("nearest_distance_m")
        if isinstance(dist, (int, float)) and dist > 0:
            self._nearest_label.setText(f"Nearest: {dist:.1f} m")
        else:
            self._nearest_label.setText("Nearest: —")

        self._last_fps = float(stats.get("fps") or 0.0)
        self._last_latency_ms = float(stats.get("latency_ms") or 0.0)
        self._live_cloud_ok = int(stats.get("cloud_ok_count") or 0)
        self._refresh_status_line()

    def _on_detection_event(self, frame_idx: int, dets: list):
        """Forward to logger (logger handles enable/disable)."""
        self._app.logger.detection(frame_idx, dets)

    def _on_worker_error(self, msg: str):
        self._video_label.setPixmap(QPixmap())
        self._video_label.setStyleSheet(
            "background: #000000; color: #FCA5A5; border: none; "
            "border-radius: 14px; font-size: 15px;")
        self._video_label.setText(f"Error: {msg}")
        self._app.logger.event("ERROR", msg)

    def on_log_entry(self, level: str, message: str):
        """Called by SessionLogger.log_entry signal — appends to drawer."""
        ts = datetime.now().strftime("%H:%M:%S")
        if level == "DET":
            self._append_to(self._det_log, message, _MAX_DET_LINES)
        else:
            self._append_to(self._evt_log,
                            f"{ts} [{level}] {message}", _MAX_EVT_LINES)

    def on_network_status(self, state: str, latency_ms: int):
        color = _NET_COLORS.get(state, COLORS["offline"])
        if state == "online":
            status = f"Online · {latency_ms} ms"
            tip = (
                "Internet: reachable (test opens a short connection to "
                "8.8.8.8, port 53 — same check as many 'online' tests).\n"
                f"Round-trip: about {latency_ms} ms.\n"
                "This is not Wi-Fi signal strength; you can have Wi-Fi "
                "but no internet if the router or ISP is down."
            )
        elif state == "slow":
            status = f"Slow · {latency_ms} ms"
            tip = (
                f"Internet responds but latency is high (~{latency_ms} ms). "
                "Cloud uploads may be slow or time out.\n"
                "Wi-Fi can still show as connected while the link is poor."
            )
        else:
            status = "Offline"
            tip = (
                "This device cannot reach the public internet (the test to "
                "8.8.8.8 failed or timed out).\n"
                "Wi-Fi may still appear connected to a router that has no "
                "upstream — check the router, cables, or ISP."
            )
        self._net_status.setText(status)
        self._net_status.setStyleSheet(
            f"color: {color}; background: transparent; "
            "font-size: 13px; font-weight: 600;")
        self._net_dot.setStyleSheet(
            f"color: {color}; background: transparent; font-size: 14px;")
        self._net_title.setStyleSheet(
            f"color: {COLORS['text_secondary']}; background: transparent; "
            "font-size: 12px; font-weight: 600;")
        self._net_title.setToolTip(tip)
        self._net_dot.setToolTip(tip)
        self._net_status.setToolTip(tip)

    def on_gps_status(self, state: str, lat, lon) -> None:
        """Slot for ``GpsMonitor.status_changed``.

        ``lat``/``lon`` are ``float`` when state == ``"live"``, else ``None``.
        Live coordinates are also forwarded to the active CaptureWorker so
        the next fusion POST carries the fresh fix.
        """
        color = _GPS_COLORS.get(state, COLORS["offline"])

        if state == "live":
            status = "Live fix"
            lat_str = f"{lat:.5f}" if isinstance(lat, (int, float)) else "—"
            lon_str = f"{lon:.5f}" if isinstance(lon, (int, float)) else "—"
            tip = (
                "GPS: live satellite fix.\n"
                f"Lat {lat_str},  Lon {lon_str}\n"
                "These coordinates are attached to each cloud-fusion POST "
                "so confirmed potholes land at the right location in the "
                "Supabase table."
            )
        elif state == "nofix":
            status = "Searching"
            tip = (
                "GPS: receiver is connected but has no satellite fix yet.\n"
                "Cold starts can take 30–90 s indoors or under tree cover. "
                "Until a fix arrives, fusion POSTs use the fallback "
                "coordinates from EYEWAY_GPS_LAT / EYEWAY_GPS_LON (if set), "
                "otherwise the cloud service's placeholder."
            )
        else:
            status = "No GPS"
            tip = (
                "GPS: no receiver detected on the configured serial device "
                "(EYEWAY_GPS_DEVICE).\n"
                "Set EYEWAY_GPS_DEVICE (e.g. /dev/ttyUSB0) and EYEWAY_GPS_BAUD "
                "to enable live coordinates. The app still works without GPS; "
                "fusion POSTs will fall back to EYEWAY_GPS_LAT / EYEWAY_GPS_LON."
            )

        self._gps_status.setText(status)
        self._gps_status.setStyleSheet(
            f"color: {color}; background: transparent; "
            "font-size: 13px; font-weight: 600;")
        self._gps_dot.setStyleSheet(
            f"color: {color}; background: transparent; font-size: 14px;")
        self._gps_title.setStyleSheet(
            f"color: {COLORS['text_secondary']}; background: transparent; "
            "font-size: 12px; font-weight: 600;")
        for w in (self._gps_dot, self._gps_title, self._gps_status):
            w.setToolTip(tip)

        # Cache the latest live fix so a freshly-started CaptureWorker can
        # pick it up immediately via start_capture(). On loss of fix we cache
        # (None, None) which causes the worker to revert to the static
        # HYBRID_GPS_LAT/LON fallback.
        if state == "live" and isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
            self._last_gps_lat: float | None = float(lat)
            self._last_gps_lon: float | None = float(lon)
        else:
            self._last_gps_lat = None
            self._last_gps_lon = None

        if self._worker is not None:
            try:
                self._worker.set_gps(self._last_gps_lat, self._last_gps_lon)
            except Exception as exc:
                self._app.logger.event(
                    "WARN", f"GPS forward to CaptureWorker failed: {exc}")

    def update_sync_badge(self, pending: int) -> None:
        """Called by SyncWorker via app._on_sync_status."""
        self._pending_count = int(pending)
        self._refresh_status_line()
        if pending > 0:
            self._sync_badge.setObjectName("syncBadge")
            self._sync_badge.style().unpolish(self._sync_badge)
            self._sync_badge.style().polish(self._sync_badge)
            self._sync_badge.setText(f"{pending} queued")
            self._sync_badge.show()
            if hasattr(self, "_sync_hide_timer"):
                self._sync_hide_timer.stop()
        else:
            # Brief "Synced" confirmation, then hide
            self._sync_badge.setObjectName("syncBadgeOk")
            self._sync_badge.style().unpolish(self._sync_badge)
            self._sync_badge.style().polish(self._sync_badge)
            self._sync_badge.setText("Synced")
            self._sync_badge.show()
            self._sync_hide_timer = QTimer(self)
            self._sync_hide_timer.setSingleShot(True)
            self._sync_hide_timer.timeout.connect(self._hide_sync_badge)
            self._sync_hide_timer.start(2000)

    def update_uploaded_total(self, total: int) -> None:
        """Called by SyncWorker.uploaded_total signal (cumulative)."""
        self._uploaded_total = int(total)
        self._refresh_status_line()

    def _refresh_status_line(self) -> None:
        """Compose the compact health-and-uploads line under the cards."""
        fps = self._last_fps
        ms = self._last_latency_ms
        fps_txt = f"{fps:.0f} fps" if fps > 0.5 else "— fps"
        ms_txt = f"{ms:.0f} ms" if ms > 0 else "— ms"
        uploaded_total = self._uploaded_total + self._live_cloud_ok
        self._status_line.setText(
            f"{fps_txt} · {ms_txt} · Uploaded {uploaded_total} · "
            f"Pending {self._pending_count}"
        )

    def _hide_sync_badge(self) -> None:
        self._sync_badge.hide()

    # ==================================================================
    # Toolbar actions
    # ==================================================================

    def _update_clock(self):
        now = datetime.now()
        self._time_label.setText(now.strftime("%H:%M"))
        self._date_label.setText(now.strftime("%a %d %b %Y"))

    def _on_use_live_camera(self) -> None:
        self._app.use_video_file = False
        self._app.save_video_source_prefs()
        self._refresh_source_ui()
        self._restart_capture()

    def _sync_detection_button(self) -> None:
        if self._detection_on:
            self._det_btn.setText("■ Stop detection")
            bg = COLORS["pothole"]
            hover = "#B91C1C"
            self._status_chip.setText("DETECTION ACTIVE")
            self._status_chip.setObjectName("statusChipOn")
        else:
            self._det_btn.setText("▶ Start detection")
            bg = COLORS["online"]
            hover = "#15803D"
            self._status_chip.setText("DETECTION PAUSED")
            self._status_chip.setObjectName("statusChipOff")
        self._det_btn.setStyleSheet(
            f"QPushButton#primaryCta {{"
            f"background-color: {bg};"
            f"color: #FFFFFF;"
            f"font-weight: 700;"
            f"font-size: 15px;"
            f"border: none;"
            f"border-radius: 12px;"
            f"padding: 10px 22px;"
            f"}}"
            f"QPushButton#primaryCta:hover {{background-color: {hover};}}"
        )
        # Repolish the status chip so its objectName change takes effect
        self._status_chip.style().unpolish(self._status_chip)
        self._status_chip.style().polish(self._status_chip)

    def _toggle_detection(self) -> None:
        self._detection_on = not self._detection_on
        if self._worker is not None:
            self._worker.set_detection_enabled(self._detection_on)
        self._sync_detection_button()

    def _toggle_log_detections(self) -> None:
        enabled = not self._app.log_detections
        self.log_toggle_changed.emit(enabled)
        self._sync_log_toggle_button()

    def _sync_log_toggle_button(self) -> None:
        """Reflect the log-detections state on the Menu action label."""
        # Action text is updated dynamically when the menu opens; nothing to do here.
        return

    def _on_pick_video_file(self) -> None:
        path, _ = QFileDialog.getOpenFileName(
            self, "Select video", str(Path.home()),
            "Video (*.mp4 *.mov *.avi *.mkv *.m4v *.webm *.insv);;All (*.*)",
        )
        if not path:
            # User cancelled — restore previous source selection
            self._refresh_source_ui()
            return
        self._app.video_source_path = Path(path).resolve()
        self._app.use_video_file = True
        self._app.save_video_source_prefs()
        self._refresh_source_ui()
        self._restart_capture()

    def _on_exit(self) -> None:
        if QMessageBox.question(
            self,
            "Quit",
            "Quit Eyeway?",
            QMessageBox.Yes | QMessageBox.No,
            QMessageBox.No,
        ) != QMessageBox.Yes:
            return
        self._app.close()

    def _restart_capture(self):
        if self._app.use_video_file:
            p = Path(self._app.video_source_path)
            if not p.is_file():
                self._video_label.setPixmap(QPixmap())
                self._video_label.setStyleSheet(
                    "background: #000000; color: #94A3B8; border: none; "
                    "border-radius: 14px; font-size: 15px;")
                self._video_label.setText(
                    "Video not found — use Video or drop a file on the window.")
                return
            source = str(p)
        else:
            source = CAMERA_INDEX
        self.start_capture(
            source=source,
            model=self._app.model,
            model_backend=self._app.model_backend,
            saved_pitch=self._app.saved_pitch or 45.0,
        )

    def _refresh_source_ui(self):
        use_video = self._app.use_video_file
        self._btn_camera.setChecked(not use_video)
        self._btn_video.setChecked(use_video)
        if use_video:
            p = Path(self._app.video_source_path)
            name = p.name
            truncated = name if len(name) <= 36 else name[:16] + "…" + name[-18:]
            self._source_hint.setText(truncated)
            self._source_hint.setToolTip(str(p))
        else:
            self._source_hint.setText("")
            self._source_hint.setToolTip("")

    def _show_menu(self):
        menu = QMenu(self)

        act_cal = QAction("Calibration wizard", self)
        act_cal.triggered.connect(lambda: self._app.show_view("wizard"))
        menu.addAction(act_cal)

        act_theme = QAction("Toggle theme", self)
        act_theme.triggered.connect(self._app.toggle_theme)
        menu.addAction(act_theme)

        menu.addSeparator()

        act_log = QAction("Log detections", self)
        act_log.setCheckable(True)
        act_log.setChecked(bool(self._app.log_detections))
        act_log.triggered.connect(lambda checked: self._set_log_detections(checked))
        menu.addAction(act_log)

        act_open = QAction("Open logs folder", self)
        act_open.triggered.connect(self._open_log_folder)
        menu.addAction(act_open)

        act_clear = QAction("Clear on-screen logs", self)
        act_clear.triggered.connect(self._clear_logs)
        menu.addAction(act_clear)

        menu.addSeparator()

        act_exit = QAction("Exit Eyeway", self)
        act_exit.triggered.connect(self._on_exit)
        menu.addAction(act_exit)

        # Anchor the menu to the button's bottom-right so it extends left/down.
        br = self._menu_btn.mapToGlobal(self._menu_btn.rect().bottomRight())
        menu_size = menu.sizeHint()
        menu.exec_(QPoint(br.x() - menu_size.width(), br.y() + 4))

    def _set_log_detections(self, enabled: bool) -> None:
        if bool(self._app.log_detections) == bool(enabled):
            return
        self.log_toggle_changed.emit(bool(enabled))

    def _toggle_drawer(self):
        sizes = self._splitter.sizes()
        if sizes[1] == 0:
            self._splitter.setSizes([200, 260])
        else:
            self._splitter.setSizes([1, 0])

    def _toggle_recording(self):
        if self._is_recording:
            self._stop_recording()
        else:
            self._start_recording()

    def _start_recording(self):
        if self._worker is None:
            self._rec_btn.setChecked(False)
            return
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        out_dir = DATA_DIR / "recordings"
        out_dir.mkdir(parents=True, exist_ok=True)
        path = out_dir / f"eyeway_recording_{ts}.mp4"
        self._recording_output_path = path
        self._worker.start_recording(str(path), fps=20.0,
                                     width=1280, height=720)
        self._is_recording = True
        self._recording_start = datetime.now()
        self._rec_btn.setChecked(True)
        self._rec_btn.setText("■ REC 00:00")
        self._rec_timer.start()
        self._app.logger.event("INFO", f"Recording started: {path}")

    def _stop_recording(self):
        if self._worker is not None:
            self._worker.stop_recording()
        path = self._recording_output_path
        switch_to_camera_after = self._app.use_video_file
        self._recording_output_path = None
        self._is_recording = False
        self._recording_start = None
        self._rec_timer.stop()
        self._rec_btn.setChecked(False)
        self._app.logger.event("INFO", "Recording stopped")

        if path is None:
            self._rec_btn.setText("● Rec")
            return

        self._rec_btn.setText("Compressing…")
        self._rec_btn.setEnabled(False)

        def work() -> None:
            ok, msg = compress_recording_inplace(path)

            def on_done() -> None:
                self._rec_btn.setEnabled(True)
                self._rec_btn.setText("● Rec")
                if not ok and msg:
                    self._app.logger.event("WARN", f"Recording compress: {msg}")
                elif msg == "skipped_no_ffmpeg":
                    self._app.logger.event(
                        "INFO",
                        "Recording saved (install ffmpeg to compress)",
                    )
                else:
                    self._app.logger.event(
                        "INFO",
                        f"Recording saved: {path.name}",
                    )
                if switch_to_camera_after:
                    self._app.use_video_file = False
                    self._app.save_video_source_prefs()
                    self._refresh_source_ui()
                self._restart_capture()

            QTimer.singleShot(0, on_done)

        threading.Thread(target=work, daemon=True).start()

    def _update_rec_elapsed(self):
        if self._recording_start:
            elapsed = datetime.now() - self._recording_start
            m, s = divmod(int(elapsed.total_seconds()), 60)
            self._rec_btn.setText(f"■ REC {m:02d}:{s:02d}")

    def _clear_logs(self):
        self._det_log.clear()
        self._evt_log.clear()

    def _open_log_folder(self):
        log_dir = self._app.logger.log_dir
        QDesktopServices.openUrl(QUrl.fromLocalFile(str(log_dir)))

    # ==================================================================
    # Drag-and-drop
    # ==================================================================

    def dragEnterEvent(self, event):
        if event.mimeData().hasUrls():
            event.acceptProposedAction()

    def dropEvent(self, event):
        exts = {".mp4", ".mov", ".avi", ".mkv", ".m4v", ".webm", ".insv"}
        for url in event.mimeData().urls():
            p = Path(url.toLocalFile())
            if p.is_file() and p.suffix.lower() in exts:
                self._app.video_source_path = p.resolve()
                self._app.use_video_file = True
                self._app.save_video_source_prefs()
                self._refresh_source_ui()
                self._restart_capture()
                return

    # ==================================================================
    # Helpers
    # ==================================================================

    @staticmethod
    def _scale_pixmap_cover(pixmap: QPixmap, target_w: int, target_h: int) -> QPixmap:
        """Scale pixmap to fill target rect; crop center. No letterboxing."""
        if pixmap.isNull() or target_w <= 0 or target_h <= 0:
            return pixmap
        sw, sh = pixmap.width(), pixmap.height()
        if sw <= 0 or sh <= 0:
            return pixmap
        scaled = pixmap.scaled(
            QSize(target_w, target_h),
            Qt.KeepAspectRatioByExpanding,
            Qt.SmoothTransformation,
        )
        x = max(0, (scaled.width() - target_w) // 2)
        y = max(0, (scaled.height() - target_h) // 2)
        return scaled.copy(x, y, target_w, target_h)

    @staticmethod
    def _append_to(widget: QPlainTextEdit, line: str, max_lines: int):
        widget.appendPlainText(line)
        doc = widget.document()
        while doc.blockCount() > max_lines:
            cursor = widget.textCursor()
            cursor.movePosition(QTextCursor.Start)
            cursor.select(QTextCursor.BlockUnderCursor)
            cursor.removeSelectedText()
            cursor.deleteChar()
            widget.setTextCursor(cursor)
        widget.moveCursor(QTextCursor.End)
