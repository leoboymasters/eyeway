"""
CaptureWorker
=============
QThread that owns the camera, runs YOLO every 3 frames, tracks objects,
and emits signals for the UI thread. No UI code here.

Signals:
  frame_ready(np.ndarray, dict)
      Annotated RGB frame + stats:
      {
        "pothole_count":      int,    # deduplicated pothole regions in lane (now)
        "session_total":      int,    # unique confirmed potholes since capture start
        "nearest_distance_m": float|None,  # last depth from cloud, fresh only
        "fps":                float,  # EMA frames-per-second
        "cloud_ok_count":     int,    # successful cloud confirmations (live)
        "latency_ms":         float,  # last YOLO inference ms
        "capture_w":          int,
        "capture_h":          int,
      }

  detection_event(int, list)
      (frame_index, detections) where detections is a list of dicts:
      [{"class_name": str, "confidence": float, "box": [x1,y1,x2,y2],
        "track_id": int}]
      Emitted every frame that has at least one detection.

  error(str)
      Human-readable error message.
"""
from __future__ import annotations

import threading
import time
import uuid
from datetime import datetime, timezone

import cv2
import numpy as np
from PyQt5.QtCore import QThread, pyqtSignal

from .config import (
    CAMERA_INDEX,
    DATA_DIR,
    HYBRID_MIN_CONFIDENCE,
    HYBRID_HTTP_TIMEOUT_S,
    HYBRID_CLOUD_URL,
    HYBRID_CLOUD_PATH,
    HYBRID_MODE,
    HYBRID_GPS_LAT,
    HYBRID_GPS_LON,
    LANE_TOP_RATIO_MIN,
    LANE_TOP_RATIO_MAX,
)
from .tracking import KADSORTTracker
from .inference import OnnxDetector
from .geometry import filter_detections_by_lane_roi, lane_trapezoid

import platform as _platform
import errno as _errno
import urllib.error as _urllib_error


def _extract_distance_m(resp: dict) -> float | None:
    """
    Pull a pothole-distance-in-metres value out of a fusion response.

    The Modal fusion service's response schema is still evolving, so we try
    a few likely keys in the root and inside ``extra``. Returns ``None`` if
    none match or the value isn't a finite positive float.
    """
    if not isinstance(resp, dict):
        return None
    candidates = (
        "distance_m", "depth_m", "pothole_distance_m", "mean_distance_m",
        "median_distance_m", "nearest_distance_m",
    )
    def _as_float(v) -> float | None:
        try:
            f = float(v)
        except (TypeError, ValueError):
            return None
        return f if f == f and f > 0.0 else None  # reject NaN/0/negative

    for k in candidates:
        f = _as_float(resp.get(k))
        if f is not None:
            return f
    extra = resp.get("extra")
    if isinstance(extra, dict):
        for k in candidates:
            f = _as_float(extra.get(k))
            if f is not None:
                return f
    return None


def _is_network_error(exc: BaseException) -> bool:
    """Return True if exc indicates no internet (vs a real server error)."""
    if isinstance(exc, _urllib_error.HTTPError):
        return False   # server was reachable; real error
    if isinstance(exc, _urllib_error.URLError):
        return True
    if isinstance(exc, (ConnectionError, TimeoutError)):
        return True
    if isinstance(exc, OSError):
        return getattr(exc, "errno", None) in {
            _errno.ENETUNREACH,
            _errno.ECONNREFUSED,
            _errno.ETIMEDOUT,
        }
    return False


def _is_transient_cloud_error(err_msg: str) -> bool:
    """Return True if the cloud responded with a transient error worth retrying
    from the offline queue (network timeouts, 5xx, Supabase insert failures,
    Modal cold-start stalls). Permanent 4xx responses return False so bad
    requests do not loop forever."""
    if not err_msg:
        return False
    lo = err_msg.lower()
    if any(s in lo for s in ("timed out", "timeout", "time out",
                             "connection reset", "connection refused",
                             "bad gateway", "service unavailable",
                             "gateway timeout", "supabase insert failed")):
        return True
    # Match "HTTP 5xx" from hybrid_client error strings.
    for code in (500, 502, 503, 504):
        if f"http {code}" in lo:
            return True
    return False


INFER_W, INFER_H = 1280, 720
N_HYBRID_SAMPLES = 1
_LIVE_CAMERA_W, _LIVE_CAMERA_H = INFER_W, INFER_H
_PREVIEW_TARGET_MS = 50 if _platform.machine().startswith("aarch64") else 33
POTHOLE_INSTANCE_IOU_THRESHOLD = 0.25
POTHOLE_INSTANCE_MAX_AGE_FRAMES = 120

# Suppress re-sending the same physical pothole to the cloud when the edge
# tracker assigns it a new track_id (common after brief occlusion, lane-ROI
# drop-outs, or YOLO misses). A detection is treated as a duplicate if it
# spatially matches a bbox already sent within this time window.
#
# The window counts from the LAST time we saw the pothole, not from the first
# send — see `_is_hybrid_spatial_dup`, which refreshes the entry's timestamp
# on every match. So as long as the pothole stays in view continuously, it
# stays de-duplicated regardless of how long the vehicle dwells on it.
# The raw value only matters for how long we remember a pothole *after* it
# leaves the frame (e.g. a stop-and-go scenario where we pass it, come back,
# and see it again) — 5 min is a safe buffer that comfortably covers a
# red-light cycle without keeping the list unbounded.
HYBRID_DEDUP_WINDOW_S = 300.0
HYBRID_DEDUP_IOU = 0.25
# Cap on remembered bboxes. Potholes encountered further back than this are
# allowed to re-send; on a continuous drive this is effectively unreachable
# since the window prunes first, but it bounds memory on pathological inputs.
HYBRID_DEDUP_MAX_ENTRIES = 256


def _iou_xyxy(a, b) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    inter_x1 = max(ax1, bx1); inter_y1 = max(ay1, by1)
    inter_x2 = min(ax2, bx2); inter_y2 = min(ay2, by2)
    inter_w = max(0.0, inter_x2 - inter_x1)
    inter_h = max(0.0, inter_y2 - inter_y1)
    inter_area = inter_w * inter_h
    area_a = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    area_b = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    union = area_a + area_b - inter_area
    return float(inter_area / union) if union > 0 else 0.0


class CaptureWorker(QThread):
    frame_ready = pyqtSignal(object, dict)
    detection_event = pyqtSignal(int, list)
    error = pyqtSignal(str)

    def __init__(
        self,
        source,            # int (camera index) or str (video path)
        model,             # OnnxDetector or ultralytics YOLO, may be None
        model_backend: str | None,
        saved_pitch: float,
        zoom_level: float = 1.0,
        pan_x: float = 0.5,
        pan_y: float = 0.5,
        parent=None,
    ):
        super().__init__(parent)
        self._source = source
        self._model = model
        self._model_backend = model_backend
        self._saved_pitch = saved_pitch
        self.zoom_level = zoom_level
        self.pan_x = pan_x
        self.pan_y = pan_y
        self._running = False
        self._detection_lock = threading.Lock()
        self._detection_enabled = False
        self._detection_reset_requested = False

        # Recording state (toggled by DashboardView)
        self._is_recording = False
        self._video_writer: cv2.VideoWriter | None = None
        self._recording_start_time: datetime | None = None
        self._recording_io_lock = threading.Lock()

        # Hybrid state
        self._hybrid_inflight_tracks: set = set()
        self._track_frame_buffer: dict = {}
        # Track IDs whose physical pothole has already been submitted to the
        # cloud. Prevents re-submission on long dwells (same tid) and on
        # re-ID events (new tid that spatially matches a sent bbox).
        self._hybrid_sent_tracks: set = set()
        # Recently-sent bboxes used for spatial dedup across track IDs.
        # Each entry: {"box": [x1, y1, x2, y2], "ts": float}
        self._hybrid_sent_bboxes: list = []

        # Session counters / dashboard stats.
        # "Session" here = the lifetime of this CaptureWorker (resets when the
        # user changes source or restarts capture).
        self._session_track_ids: set = set()   # distinct confirmed potholes
        self._cloud_ok_count: int = 0          # successful cloud responses
        self._nearest_distance_m: float | None = None
        self._nearest_distance_ts: float = 0.0
        self._nearest_distance_ttl_s: float = 10.0
        # FPS EMA
        self._fps_ema: float = 0.0
        self._last_frame_t: float = 0.0

        # Live GPS (set from the UI thread via set_gps). Falls back to the
        # static HYBRID_GPS_LAT/LON when we don't have a live fix yet.
        self._gps_lock = threading.Lock()
        self._live_gps_lat: float | None = None
        self._live_gps_lon: float | None = None

    # ------------------------------------------------------------------
    # Public control API (called from UI thread)
    # ------------------------------------------------------------------

    def stop(self) -> None:
        """Signal the worker to exit its run() loop and wait up to 5 s."""
        self._running = False
        self.wait(5_000)

    def set_gps(self, lat: float | None, lon: float | None) -> None:
        """Thread-safe slot for live GPS updates from ``GpsMonitor``.

        Passing ``(None, None)`` clears the live fix; the worker then falls
        back to ``HYBRID_GPS_LAT``/``HYBRID_GPS_LON`` from the config.
        """
        with self._gps_lock:
            self._live_gps_lat = lat
            self._live_gps_lon = lon

    def _current_gps(self) -> tuple[float | None, float | None]:
        """Return (lat, lon): live fix if present, otherwise the static fallback."""
        with self._gps_lock:
            lat = self._live_gps_lat
            lon = self._live_gps_lon
        if lat is None or lon is None:
            return HYBRID_GPS_LAT, HYBRID_GPS_LON
        return lat, lon

    def set_detection_enabled(self, on: bool) -> None:
        """When False, only the raw feed is shown (no YOLO, tracking, hybrid, or overlays)."""
        with self._detection_lock:
            on = bool(on)
            was_on = self._detection_enabled
            self._detection_enabled = on
            if was_on and not on:
                self._detection_reset_requested = True

    def start_recording(self, output_path: str, fps: float, width: int, height: int) -> None:
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        with self._recording_io_lock:
            self._video_writer = cv2.VideoWriter(output_path, fourcc, fps, (width, height))
            self._recording_start_time = datetime.now()
            self._is_recording = True

    def stop_recording(self) -> None:
        with self._recording_io_lock:
            self._is_recording = False
            if self._video_writer is not None:
                self._video_writer.release()
                self._video_writer = None
            self._recording_start_time = None

    # ------------------------------------------------------------------
    # QThread entry point
    # ------------------------------------------------------------------

    def run(self) -> None:
        cap = cv2.VideoCapture(self._source)
        if isinstance(self._source, int):
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, _LIVE_CAMERA_W)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, _LIVE_CAMERA_H)
            video_frame_delay = None
        else:
            fps = cap.get(cv2.CAP_PROP_FPS)
            video_frame_delay = 1.0 / fps if fps > 0 else 1.0 / 30.0

        if not cap.isOpened():
            self.error.emit(f"Could not open source: {self._source}")
            return

        pothole_tracker = KADSORTTracker()
        pothole_instances: list = []
        frame_count = 0
        last_results = None
        last_infer_ms = 0.0
        self._running = True
        _lane_logged = False

        try:
            while self._running:
                t_frame_start = time.perf_counter()
                ret, frame_bgr = cap.read()
                if not ret:
                    break  # end of file or camera error — stop cleanly

                capture_w, capture_h = frame_bgr.shape[1], frame_bgr.shape[0]

                with self._recording_io_lock:
                    if self._is_recording and self._video_writer is not None:
                        self._video_writer.write(frame_bgr)

                frame_count += 1
                with self._detection_lock:
                    det_on = self._detection_enabled
                    do_reset = self._detection_reset_requested
                    if do_reset:
                        self._detection_reset_requested = False

                if do_reset:
                    pothole_tracker = KADSORTTracker()
                    pothole_instances = []
                    last_results = None
                    last_infer_ms = 0.0
                    self._track_frame_buffer.clear()
                    self._hybrid_sent_tracks.clear()
                    self._hybrid_sent_bboxes.clear()
                    # Also reset session counters so "session total" reflects
                    # the new detection run, not stale numbers from before.
                    self._session_track_ids.clear()
                    self._cloud_ok_count = 0
                    self._nearest_distance_m = None
                    self._nearest_distance_ts = 0.0

                # FPS EMA (cheap + smooth enough for a status line)
                now_t = time.perf_counter()
                if self._last_frame_t > 0.0:
                    dt = max(1e-6, now_t - self._last_frame_t)
                    inst_fps = 1.0 / dt
                    alpha = 0.1
                    self._fps_ema = (
                        inst_fps if self._fps_ema == 0.0
                        else (alpha * inst_fps + (1 - alpha) * self._fps_ema)
                    )
                self._last_frame_t = now_t

                run_inference = (frame_count % 3 == 0)
                hazard_count = 0

                if self._model is not None and det_on:
                    if frame_bgr.shape[1] == INFER_W and frame_bgr.shape[0] == INFER_H:
                        infer_bgr = frame_bgr
                    else:
                        infer_bgr = cv2.resize(frame_bgr, (INFER_W, INFER_H),
                                               interpolation=cv2.INTER_LINEAR)
                    infer_fw, infer_fh = INFER_W, INFER_H

                    results = last_results
                    if run_inference or results is None:
                        conf_threshold = 0.45
                        t_infer = time.perf_counter()
                        if self._model_backend in ("onnx_int8", "onnx_fp32"):
                            dets = self._model.predict(infer_bgr,
                                                       conf_threshold=conf_threshold)
                        else:
                            raw = self._model.predict(infer_bgr, conf=conf_threshold,
                                                      imgsz=640, verbose=False)
                            dets = []
                            if raw and raw[0].boxes:
                                boxes = raw[0].boxes
                                xyxy_all = boxes.xyxy.detach().cpu().numpy()
                                conf_all = boxes.conf.detach().cpu().numpy()
                                cls_all = boxes.cls.detach().cpu().numpy().astype(int)
                                for i in range(len(xyxy_all)):
                                    dets.append(list(xyxy_all[i]) +
                                                [float(conf_all[i]), int(cls_all[i])])
                        last_infer_ms = (time.perf_counter() - t_infer) * 1000
                        if frame_count % 90 == 0:
                            print(f"[YOLO] frame={frame_count}  infer={last_infer_ms:.1f}ms  "
                                  f"fps~{1000/last_infer_ms:.1f}", flush=True)

                        pitch = self._saved_pitch if self._saved_pitch else 45.0
                        dets, _ = filter_detections_by_lane_roi(
                            dets, infer_fw, infer_fh, pitch=pitch)
                        results = pothole_tracker.update(dets)
                        last_results = results

                        # Hybrid buffering (unchanged from original)
                        if HYBRID_MODE and results:
                            now_t = time.time()
                            self._prune_hybrid_sent_bboxes(now_t)
                            for r in results:
                                cid = int(r[5])
                                if cid != 0:
                                    continue
                                x1, y1, x2, y2 = map(int, r[:4])
                                if x2 <= x1 or y2 <= y1:
                                    continue
                                tid = int(r[4])
                                conf_val = float(r[6])

                                box_i = [x1, y1, x2, y2]
                                if (tid in self._hybrid_sent_tracks
                                        or self._is_hybrid_spatial_dup(box_i, now_t)):
                                    # Same physical pothole already sent
                                    # (same tid on a long dwell, or new tid
                                    # after a re-ID). Remember this tid so we
                                    # skip cheaply on subsequent frames.
                                    self._hybrid_sent_tracks.add(tid)
                                    self._track_frame_buffer.pop(tid, None)
                                    continue

                                buf = self._track_frame_buffer.setdefault(tid, [])
                                buf.append({"frame": infer_bgr.copy(),
                                            "bbox": (x1, y1, x2, y2),
                                            "conf": conf_val})
                                if len(buf) > N_HYBRID_SAMPLES:
                                    buf.pop(0)
                                # Per-track gating only: inflight check prevents
                                # duplicate POSTs for the same pothole. No global
                                # interval so multiple simultaneous potholes can
                                # all be dispatched in parallel.
                                if (len(buf) >= N_HYBRID_SAMPLES
                                        and tid not in self._hybrid_inflight_tracks):
                                    frames_data = list(buf)
                                    best = max(frames_data, key=lambda f: f["conf"])
                                    if best["conf"] < HYBRID_MIN_CONFIDENCE:
                                        continue
                                    print(f"[HYBRID] queuing track={tid}  "
                                          f"best_conf={best['conf']:.2f}", flush=True)
                                    self._hybrid_inflight_tracks.add(tid)
                                    self._hybrid_sent_tracks.add(tid)
                                    # Session counter: a distinct pothole is
                                    # "confirmed" the moment it crosses the
                                    # fusion confidence gate, regardless of
                                    # whether the cloud call succeeds. That's
                                    # what the user *saw*.
                                    self._session_track_ids.add(tid)
                                    self._hybrid_sent_bboxes.append({
                                        "box": list(best["bbox"]),
                                        "ts": now_t,
                                    })
                                    threading.Thread(
                                        target=self._hybrid_fetch,
                                        args=(tid, frames_data, infer_fw, infer_fh,
                                              best["bbox"], best["conf"]),
                                        daemon=True,
                                    ).start()

                    annotated = infer_bgr.copy()
                    dets_for_log: list[dict] = []

                    if results:
                        sx = capture_w / float(infer_fw)
                        sy = capture_h / float(infer_fh)
                        for r in results:
                            x1, y1, x2, y2, tid, cid, cnf = r
                            x1, y1, x2, y2 = map(int, [x1, y1, x2, y2])
                            color = (0, 165, 255) if cid == 0 else (0, 255, 0)
                            cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)
                            if cid == 0:
                                pothole_instances = self._update_pothole_instances(
                                    pothole_instances, [x1, y1, x2, y2], int(tid))
                            else:
                                hazard_count += 1

                            dets_for_log.append({
                                "class_name": "pothole" if cid == 0 else "hazard",
                                "confidence": float(cnf),
                                "box": [x1 * sx, y1 * sy, x2 * sx, y2 * sy],
                                "track_id": int(tid),
                            })

                    if dets_for_log:
                        self.detection_event.emit(frame_count, dets_for_log)

                    # Lane overlay — uses the same trapezoid as the ROI filter
                    pitch = self._saved_pitch if self._saved_pitch else 45.0
                    overlay_pts = lane_trapezoid(infer_fw, infer_fh, pitch=pitch)
                    if not _lane_logged:
                        corners = overlay_pts.reshape(-1, 2).astype(int).tolist()
                        print(f"[LANE] pitch={pitch:.0f}  frame={infer_fw}x{infer_fh}  "
                              f"corners TL={corners[0]} TR={corners[1]} "
                              f"BR={corners[2]} BL={corners[3]}", flush=True)
                        _lane_logged = True
                    cv2.polylines(annotated,
                                  [overlay_pts.astype(np.int32)],
                                  isClosed=True,
                                  color=(255, 255, 255),
                                  thickness=2)

                    # Recording indicator (red dot only — no on-video HUD text)
                    with self._recording_io_lock:
                        rec = self._is_recording
                    if rec:
                        cv2.circle(annotated, (30, 30), 10, (0, 0, 238), -1)

                    frame_rgb = cv2.cvtColor(annotated, cv2.COLOR_BGR2RGB)
                else:
                    frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)

                # Zoom/pan crop
                h, w = frame_rgb.shape[:2]
                if self.zoom_level > 1.0:
                    crop_w = int(w / self.zoom_level)
                    crop_h = int(h / self.zoom_level)
                    max_px = max(0, w - crop_w)
                    max_py = max(0, h - crop_h)
                    cx = int(self.pan_x * max_px)
                    cy = int(self.pan_y * max_py)
                    cx = max(0, min(cx, w - crop_w))
                    cy = max(0, min(cy, h - crop_h))
                    frame_rgb = frame_rgb[cy:cy + crop_h, cx:cx + crop_w]

                # Dashboard stats. See module docstring for field semantics.
                # nearest_distance_m expires after _nearest_distance_ttl_s so
                # a stale depth doesn't linger in the UI when the pothole is
                # long gone.
                nearest = self._nearest_distance_m
                if nearest is not None:
                    if (time.time() - self._nearest_distance_ts
                            > self._nearest_distance_ttl_s):
                        nearest = None

                stats = {
                    "pothole_count":      len(pothole_instances),
                    "session_total":      len(self._session_track_ids),
                    "nearest_distance_m": nearest,
                    "fps":                self._fps_ema,
                    "cloud_ok_count":     self._cloud_ok_count,
                    "latency_ms":         last_infer_ms,
                    "capture_w":          capture_w,
                    "capture_h":          capture_h,
                }
                self.frame_ready.emit(np.ascontiguousarray(frame_rgb), stats)

                if video_frame_delay is not None:
                    elapsed = time.perf_counter() - t_frame_start
                    sleep = video_frame_delay - elapsed
                    if sleep > 0:
                        time.sleep(sleep)
        finally:
            self._running = False
            cap.release()

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _lane_top_ratio(self) -> float:
        pitch = self._saved_pitch or 45.0
        raw = 0.5 - pitch / 180.0
        return max(LANE_TOP_RATIO_MIN, min(LANE_TOP_RATIO_MAX, raw))

    def _prune_hybrid_sent_bboxes(self, now_t: float) -> None:
        """Drop entries older than HYBRID_DEDUP_WINDOW_S, cap list size."""
        self._hybrid_sent_bboxes = [
            e for e in self._hybrid_sent_bboxes
            if now_t - e["ts"] < HYBRID_DEDUP_WINDOW_S
        ]
        if len(self._hybrid_sent_bboxes) > HYBRID_DEDUP_MAX_ENTRIES:
            # Drop the oldest; freshly-refreshed entries (latest sightings)
            # are preserved.
            self._hybrid_sent_bboxes.sort(key=lambda e: e["ts"])
            self._hybrid_sent_bboxes = \
                self._hybrid_sent_bboxes[-HYBRID_DEDUP_MAX_ENTRIES:]

    def _is_hybrid_spatial_dup(self, box: list, now_t: float) -> bool:
        """
        True if `box` spatially matches a recently-sent cloud bbox.

        Side effect: when a match is found, the entry's timestamp is
        refreshed and its bbox is updated to the latest position. This keeps
        the dedup alive for the entire time the pothole stays in view, which
        matters when the vehicle is stopped or slow and the same physical
        pothole is continuously re-detected (often under a new track_id
        whenever the KAD-SORT tracker drops and re-IDs it).
        """
        bw = max(1, box[2] - box[0])
        bh = max(1, box[3] - box[1])
        dist_thresh = max(bw, bh) * 0.5
        cx_n = (box[0] + box[2]) / 2
        cy_n = (box[1] + box[3]) / 2
        for e in self._hybrid_sent_bboxes:
            eb = e["box"]
            cx_e = (eb[0] + eb[2]) / 2
            cy_e = (eb[1] + eb[3]) / 2
            close = (abs(cx_e - cx_n) < dist_thresh
                     and abs(cy_e - cy_n) < dist_thresh)
            if close or _iou_xyxy(eb, box) > HYBRID_DEDUP_IOU:
                e["ts"] = now_t
                e["box"] = list(box)
                return True
        return False

    @staticmethod
    def _update_pothole_instances(
        instances: list, box: list, track_id: int
    ) -> list:
        """Spatial-dedup pothole counter. Returns updated instances list."""
        bw = max(1, box[2] - box[0])
        bh = max(1, box[3] - box[1])
        dist_thresh = max(bw, bh) * 0.5

        # Update age
        updated = []
        for inst in instances:
            inst["age"] += 1
            if inst["age"] < POTHOLE_INSTANCE_MAX_AGE_FRAMES:
                updated.append(inst)
        instances = updated

        # Match by IoU or proximity
        for inst in instances:
            if _iou_xyxy(inst["box"], box) > POTHOLE_INSTANCE_IOU_THRESHOLD:
                inst["box"] = box
                inst["track_ids"].add(track_id)
                inst["age"] = 0
                return instances
            cx_inst = (inst["box"][0] + inst["box"][2]) / 2
            cy_inst = (inst["box"][1] + inst["box"][3]) / 2
            cx_new = (box[0] + box[2]) / 2
            cy_new = (box[1] + box[3]) / 2
            if abs(cx_inst - cx_new) < dist_thresh and abs(cy_inst - cy_new) < dist_thresh:
                inst["box"] = box
                inst["track_ids"].add(track_id)
                inst["age"] = 0
                return instances

        instances.append({
            "box": box, "track_ids": {track_id},
            "age": 0, "first_seen": 0
        })
        return instances

    def _hybrid_fetch(self, track_id, frames_data, infer_fw, infer_fh, bbox_xyxy, conf):  # noqa: PLR0913
        """Fire-and-forget cloud depth call."""
        import time as _time
        t0 = _time.perf_counter()
        print(f"[HYBRID] -> POST track={track_id}  conf={conf:.2f}", flush=True)
        idem = str(uuid.uuid4())
        capture_ts = datetime.now(timezone.utc).isoformat()
        # Snapshot GPS once per fetch so the POST body and the offline-queue
        # entry agree on position even if a live fix arrives mid-call.
        _gps_lat, _gps_lon = self._current_gps()

        def _try_enqueue_offline() -> None:
            try:
                from .offline_queue import get_queue
                best_frame = max(frames_data, key=lambda f: f["conf"])
                if best_frame["conf"] < HYBRID_MIN_CONFIDENCE:
                    print(
                        f"[HYBRID] offline skip queue track={track_id}  "
                        f"conf={best_frame['conf']:.2f}",
                        flush=True,
                    )
                    return
                get_queue().enqueue(
                    track_id,
                    bbox_xyxy,
                    conf,
                    best_frame["frame"],
                    infer_fw,
                    infer_fh,
                    idempotency_key=idem,
                )
                print(
                    f"[HYBRID] offline - queued track={track_id} "
                    f"(will retry when online)",
                    flush=True,
                )
            except Exception as qe:
                print(f"[HYBRID] queue write failed: {qe}", flush=True)

        try:
            from .hybrid_client import post_hybrid_depth, _resize_for_send, _jpeg_b64, _JPEG_QUALITY
            # Log estimated payload size before sending
            best_frame = max(frames_data, key=lambda f: f["conf"])["frame"]
            small, sw, sh = _resize_for_send(best_frame)
            est_kb = len(_jpeg_b64(small)) * 3 / 4 / 1024  # base64 → bytes
            print(f"[HYBRID]   payload: {sw}x{sh} JPEG q={_JPEG_QUALITY}  "
                  f"~{est_kb:.0f} KB/frame x {len(frames_data)} frames  "
                  f"~{est_kb * len(frames_data):.0f} KB total", flush=True)
            d = post_hybrid_depth(
                frames_data, infer_fw, infer_fh, bbox_xyxy, conf,
                base_url=HYBRID_CLOUD_URL,
                path=HYBRID_CLOUD_PATH,
                timeout_s=HYBRID_HTTP_TIMEOUT_S,
                track_id=track_id,
                idempotency_key=idem,
                client_id="edge_pi",
                capture_ts_iso=capture_ts,
                gps_lat=_gps_lat,
                gps_lon=_gps_lon,
            )
            elapsed = _time.perf_counter() - t0
            if d.get("ok"):
                srv = (d.get("extra") or {}).get("server_latency_ms") or {}
                print(
                    f"[HYBRID] OK track={track_id}  round_trip={elapsed:.1f}s  "
                    f"server_total={srv.get('total_ms','?')}ms  "
                    f"da3={srv.get('da3_infer_ms','?')}ms  "
                    f"geometry={srv.get('geometry_ms','?')}ms  "
                    f"supabase={srv.get('supabase_ms','?')}ms  "
                    f"network~{max(0, elapsed*1000 - (srv.get('total_ms') or 0)):.0f}ms",
                    flush=True,
                )
                # Feed dashboard: successful cloud confirmation.
                self._cloud_ok_count += 1
                # Pick up a pothole-distance field if the fusion response has
                # one. The Modal service may evolve the key name; we probe a
                # handful defensively so the UI degrades to "--" rather than
                # crashing when the shape changes.
                dist = _extract_distance_m(d)
                if dist is not None and dist > 0.0:
                    self._nearest_distance_m = float(dist)
                    self._nearest_distance_ts = _time.time()
            else:
                err_msg = d.get("error") or ""
                print(f"[HYBRID] ERR track={track_id} {elapsed:.1f}s  error={err_msg}", flush=True)
                # Enqueue on any transient cloud error (5xx, timeout,
                # Supabase insert failure) so the detection is retried when
                # the cloud recovers instead of being silently dropped.
                if _is_transient_cloud_error(err_msg):
                    _try_enqueue_offline()
        except Exception as e:
            elapsed = _time.perf_counter() - t0
            if _is_network_error(e):
                _try_enqueue_offline()
            else:
                print(
                    f"[HYBRID] ERR EXCEPTION track={track_id} {elapsed:.1f}s: {e}",
                    flush=True,
                )
        finally:
            self._hybrid_inflight_tracks.discard(track_id)
