"""
GpsMonitor
==========
Read live GPS coordinates from a direct serial NMEA device (e.g. a USB
GPS dongle on ``/dev/ttyUSB0``) and emit status updates to the UI.

Design notes
------------
* No ``gpsd`` dependency. We speak NMEA 0183 straight off the serial port
  because (a) gpsd isn't always available/configured on field Pis and
  (b) the parsing we need (position + fix flag + sat count) is ~30 lines.
* ``pyserial`` is imported lazily inside :meth:`run` so developer machines
  without the package (or without the GPS hardware) can still import this
  module and keep the app starting.
* Emission is throttled to 1 Hz. A good NMEA dongle pushes RMC/GGA every
  100–200 ms; we don't want to spam the UI thread with identical data.
* Three public states:

    * ``"live"``  — valid fix, ``lat``/``lon`` are real floats
    * ``"nofix"`` — hardware is talking to us but no satellite fix yet
    * ``"nohw"``  — no device configured, or repeated serial errors

Signals
-------
status_changed(str, object, object)
    ``(state, lat_or_none, lon_or_none)``. ``object`` typing is used so
    ``None`` flows through on ``nofix`` / ``nohw``.
"""
from __future__ import annotations

import threading
import time
from typing import Optional

from PyQt5.QtCore import QThread, pyqtSignal

# ======================================================================
# Pure NMEA helpers — importable and unit-testable without serial hardware.
# ======================================================================


def nmea_checksum_ok(sentence: str) -> bool:
    """Return True if an NMEA sentence matches its XOR checksum.

    Accepts both ``$GPRMC,...*A9`` and ``$GPRMC,...*a9`` casings.
    Silently rejects malformed input.
    """
    if not sentence or sentence[0] != "$" or "*" not in sentence:
        return False
    body, _, cksum = sentence.partition("*")
    cksum = cksum.strip()[:2]
    x = 0
    for ch in body[1:]:
        x ^= ord(ch)
    try:
        return x == int(cksum, 16)
    except ValueError:
        return False


def _dmm_to_decimal(value: str, hemisphere: str, deg_width: int) -> Optional[float]:
    """Convert NMEA degrees-minutes (``DDMM.MMMM`` / ``DDDMM.MMMM``) to signed decimal.

    ``deg_width`` is 2 for latitude, 3 for longitude. Returns ``None`` if
    the fields are empty or malformed.
    """
    if not value or not hemisphere:
        return None
    try:
        deg = float(value[:deg_width])
        minutes = float(value[deg_width:])
    except (ValueError, IndexError):
        return None
    decimal = deg + minutes / 60.0
    if hemisphere in ("S", "W"):
        decimal = -decimal
    if hemisphere not in ("N", "S", "E", "W"):
        return None
    return decimal


def parse_lat_lon(lat_str: str, ns: str,
                  lon_str: str, ew: str) -> tuple[Optional[float], Optional[float]]:
    """Parse an NMEA lat/lon pair. Returns ``(None, None)`` on failure."""
    lat = _dmm_to_decimal(lat_str, ns, 2)
    lon = _dmm_to_decimal(lon_str, ew, 3)
    if lat is None or lon is None:
        return None, None
    if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
        return None, None
    return lat, lon


def parse_rmc(fields: list[str]) -> Optional[dict]:
    """Parse ``$xxRMC`` fields.

    NMEA layout (0-indexed):
        0 talker+type, 1 time, 2 status (A valid / V void),
        3 lat, 4 N/S, 5 lon, 6 E/W, 7 speed_kn, 8 track_deg,
        9 date, ...
    """
    if len(fields) < 7 or not fields[0].endswith("RMC"):
        return None
    status = fields[2]
    if status != "A":
        return {"valid": False, "lat": None, "lon": None, "speed_kn": None}
    lat, lon = parse_lat_lon(fields[3], fields[4], fields[5], fields[6])
    if lat is None:
        return {"valid": False, "lat": None, "lon": None, "speed_kn": None}
    speed_kn: Optional[float] = None
    if len(fields) > 7 and fields[7]:
        try:
            speed_kn = float(fields[7])
        except ValueError:
            pass
    return {"valid": True, "lat": lat, "lon": lon, "speed_kn": speed_kn}


def parse_gga(fields: list[str]) -> Optional[dict]:
    """Parse ``$xxGGA`` fields.

    NMEA layout:
        0 talker+type, 1 time, 2 lat, 3 N/S, 4 lon, 5 E/W,
        6 fix_quality (0 none, 1 GPS, 2 DGPS), 7 num_sats,
        8 hdop, 9 altitude_m, ...
    """
    if len(fields) < 8 or not fields[0].endswith("GGA"):
        return None
    try:
        quality = int(fields[6]) if fields[6] else 0
    except ValueError:
        quality = 0
    try:
        sats = int(fields[7]) if fields[7] else 0
    except ValueError:
        sats = 0
    lat, lon = parse_lat_lon(fields[2], fields[3], fields[4], fields[5])
    return {"quality": quality, "sats": sats, "lat": lat, "lon": lon}


# ======================================================================
# Serial reader thread
# ======================================================================


_RECONNECT_DELAY_S = 5.0
_NOFIX_TIMEOUT_S = 8.0      # no valid fix in this window → "nofix"
_EMIT_INTERVAL_S = 1.0      # throttle UI updates


class GpsMonitor(QThread):
    """Read NMEA from a serial device and emit state + last known lat/lon."""

    status_changed = pyqtSignal(str, object, object)   # state, lat|None, lon|None

    def __init__(
        self,
        device: Optional[str] = None,
        baud: int = 9600,
        parent=None,
    ) -> None:
        super().__init__(parent)
        self._device = device
        self._baud = int(baud)
        self._stop_event = threading.Event()
        self._last_state: str = ""
        self._last_lat: Optional[float] = None
        self._last_lon: Optional[float] = None
        self._last_sats: int = 0
        self._last_fix_ts: float = 0.0
        self._last_emit_ts: float = 0.0

    # ---------------------------------------------------------------
    # Public API
    # ---------------------------------------------------------------

    def stop(self) -> None:
        self._stop_event.set()
        self.wait(3_000)

    @property
    def last_position(self) -> tuple[Optional[float], Optional[float]]:
        """Most recent (lat, lon), or (None, None) if never fixed."""
        return self._last_lat, self._last_lon

    @property
    def last_sats(self) -> int:
        return self._last_sats

    # ---------------------------------------------------------------
    # QThread entry
    # ---------------------------------------------------------------

    def run(self) -> None:
        # No device configured → report once and idle forever (the signal is
        # still wired; app stays usable). We don't spin-loop; we block on
        # the stop_event so cleanup is instant.
        if not self._device:
            self._emit("nohw", None, None, force=True)
            self._stop_event.wait()
            return

        try:
            import serial  # type: ignore
        except ImportError:
            print(
                "[GPS] pyserial not installed — GPS disabled "
                "(pip install pyserial)",
                flush=True,
            )
            self._emit("nohw", None, None, force=True)
            self._stop_event.wait()
            return

        # Outer loop: (re)open the device as needed.
        while not self._stop_event.is_set():
            ser = None
            try:
                ser = serial.Serial(self._device, self._baud, timeout=1.0)
                print(f"[GPS] opened {self._device} @ {self._baud} baud",
                      flush=True)
                self._read_loop(ser)
            except Exception as exc:
                print(f"[GPS] serial error on {self._device}: {exc}",
                      flush=True)
                self._emit("nohw", None, None)
            finally:
                try:
                    if ser is not None:
                        ser.close()
                except Exception:
                    pass
            # Back off before reopening so we don't hammer a missing port.
            if not self._stop_event.wait(_RECONNECT_DELAY_S):
                continue
            break

    # ---------------------------------------------------------------
    # Inner helpers
    # ---------------------------------------------------------------

    def _read_loop(self, ser) -> None:
        """Consume NMEA lines until the serial port errors or we're stopped."""
        while not self._stop_event.is_set():
            try:
                raw = ser.readline()
            except Exception as exc:
                print(f"[GPS] read error: {exc}", flush=True)
                return
            if not raw:
                # No data within the 1 s timeout — check if we've aged out.
                self._check_nofix()
                continue
            try:
                line = raw.decode("ascii", errors="ignore").strip()
            except Exception:
                continue
            if not line or not line.startswith("$") or "*" not in line:
                continue
            if not nmea_checksum_ok(line):
                continue

            body = line.split("*", 1)[0]
            fields = body.split(",")
            if len(fields[0]) < 4:
                continue

            stype = fields[0][-3:]
            if stype == "RMC":
                info = parse_rmc(fields)
                if info and info.get("valid"):
                    self._on_fix(info["lat"], info["lon"])
            elif stype == "GGA":
                info = parse_gga(fields)
                if info is None:
                    continue
                self._last_sats = info.get("sats") or 0
                if info.get("quality", 0) > 0 and info.get("lat") is not None:
                    self._on_fix(info["lat"], info["lon"])
                else:
                    self._check_nofix()

    def _on_fix(self, lat: float, lon: float) -> None:
        self._last_lat = lat
        self._last_lon = lon
        self._last_fix_ts = time.time()
        self._emit("live", lat, lon)

    def _check_nofix(self) -> None:
        """Downgrade to 'nofix' if we've gone too long without a valid fix."""
        if self._last_fix_ts == 0.0:
            self._emit("nofix", None, None)
            return
        if time.time() - self._last_fix_ts > _NOFIX_TIMEOUT_S:
            self._emit("nofix", None, None)

    def _emit(self, state: str, lat, lon, *, force: bool = False) -> None:
        """Throttled emit: at most once per `_EMIT_INTERVAL_S` unless state flips."""
        now = time.time()
        changed = state != self._last_state
        if not force and not changed and (now - self._last_emit_ts) < _EMIT_INTERVAL_S:
            return
        self._last_state = state
        self._last_emit_ts = now
        self.status_changed.emit(state, lat, lon)
