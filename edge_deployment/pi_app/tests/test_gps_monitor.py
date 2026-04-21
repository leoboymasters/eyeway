"""Tests for gps_monitor NMEA parsing — run with: pytest tests/test_gps_monitor.py -v

Only the pure-function helpers are exercised here. The serial reader itself
(GpsMonitor QThread.run) talks to real hardware and is covered by the live
smoke test in scripts/, not unit tests.
"""
import sys
from pathlib import Path

_MAC_APP_DIR = Path(__file__).parent.parent
if str(_MAC_APP_DIR) not in sys.path:
    sys.path.insert(0, str(_MAC_APP_DIR))

import pytest  # noqa: E402

from gps_monitor import (  # noqa: E402
    nmea_checksum_ok,
    parse_lat_lon,
    parse_rmc,
    parse_gga,
    _dmm_to_decimal,
)


# ---------------------------------------------------------------------
# Checksum
# ---------------------------------------------------------------------


def test_checksum_valid_rmc():
    # Canonical GPRMC from u-blox datasheets.
    line = "$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6A"
    assert nmea_checksum_ok(line) is True


def test_checksum_valid_gga():
    line = "$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47"
    assert nmea_checksum_ok(line) is True


def test_checksum_rejects_corrupted():
    line = "$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*00"
    assert nmea_checksum_ok(line) is False


@pytest.mark.parametrize("bad", ["", "foo", "$GPRMC,no,star,here", "$*AB"])
def test_checksum_rejects_malformed(bad):
    assert nmea_checksum_ok(bad) is False


def test_checksum_accepts_lowercase_hex():
    line = "$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6a"
    assert nmea_checksum_ok(line) is True


# ---------------------------------------------------------------------
# DMM → decimal
# ---------------------------------------------------------------------


def test_dmm_latitude_north():
    lat = _dmm_to_decimal("4807.038", "N", 2)
    assert lat == pytest.approx(48 + 7.038 / 60.0, abs=1e-6)


def test_dmm_latitude_south_is_negative():
    lat = _dmm_to_decimal("4807.038", "S", 2)
    assert lat == pytest.approx(-(48 + 7.038 / 60.0), abs=1e-6)


def test_dmm_longitude_east():
    lon = _dmm_to_decimal("01131.000", "E", 3)
    assert lon == pytest.approx(11 + 31.0 / 60.0, abs=1e-6)


def test_dmm_longitude_west_is_negative():
    lon = _dmm_to_decimal("01131.000", "W", 3)
    assert lon == pytest.approx(-(11 + 31.0 / 60.0), abs=1e-6)


def test_dmm_empty_returns_none():
    assert _dmm_to_decimal("", "N", 2) is None
    assert _dmm_to_decimal("4807.038", "", 2) is None


def test_dmm_bad_hemisphere_returns_none():
    assert _dmm_to_decimal("4807.038", "X", 2) is None


def test_dmm_garbage_returns_none():
    assert _dmm_to_decimal("abcd.efg", "N", 2) is None


# ---------------------------------------------------------------------
# parse_lat_lon
# ---------------------------------------------------------------------


def test_parse_lat_lon_valid_pair():
    lat, lon = parse_lat_lon("4807.038", "N", "01131.000", "E")
    assert lat == pytest.approx(48.11730, abs=1e-4)
    assert lon == pytest.approx(11.51667, abs=1e-4)


def test_parse_lat_lon_out_of_range_returns_none_pair():
    # Longitude 999 deg obviously invalid.
    lat, lon = parse_lat_lon("4807.038", "N", "99900.000", "E")
    assert (lat, lon) == (None, None)


def test_parse_lat_lon_empty_returns_none_pair():
    assert parse_lat_lon("", "", "", "") == (None, None)


# ---------------------------------------------------------------------
# RMC
# ---------------------------------------------------------------------


def _rmc_fields(line: str) -> list[str]:
    body = line.split("*", 1)[0]
    return body.split(",")


def test_parse_rmc_valid_fix():
    line = "$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6A"
    info = parse_rmc(_rmc_fields(line))
    assert info is not None
    assert info["valid"] is True
    assert info["lat"] == pytest.approx(48.11730, abs=1e-4)
    assert info["lon"] == pytest.approx(11.51667, abs=1e-4)
    assert info["speed_kn"] == pytest.approx(22.4, abs=1e-3)


def test_parse_rmc_void_status_returns_invalid():
    line = "$GPRMC,123519,V,,,,,,,230394,,*01"
    info = parse_rmc(_rmc_fields(line))
    assert info is not None
    assert info["valid"] is False
    assert info["lat"] is None
    assert info["lon"] is None


def test_parse_rmc_wrong_sentence_type_returns_none():
    line = "$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47"
    assert parse_rmc(_rmc_fields(line)) is None


def test_parse_rmc_short_row_returns_none():
    assert parse_rmc(["$GPRMC", "123519"]) is None


# ---------------------------------------------------------------------
# GGA
# ---------------------------------------------------------------------


def _gga_fields(line: str) -> list[str]:
    body = line.split("*", 1)[0]
    return body.split(",")


def test_parse_gga_valid_fix():
    line = "$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47"
    info = parse_gga(_gga_fields(line))
    assert info is not None
    assert info["quality"] == 1
    assert info["sats"] == 8
    assert info["lat"] == pytest.approx(48.11730, abs=1e-4)
    assert info["lon"] == pytest.approx(11.51667, abs=1e-4)


def test_parse_gga_no_fix_quality_zero():
    # Quality 0 means no fix — parser still returns a dict, caller decides.
    line = "$GPGGA,123519,,,,,0,00,,,M,,M,,*66"
    info = parse_gga(_gga_fields(line))
    assert info is not None
    assert info["quality"] == 0
    assert info["sats"] == 0
    assert info["lat"] is None and info["lon"] is None


def test_parse_gga_wrong_type_returns_none():
    line = "$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6A"
    assert parse_gga(_gga_fields(line)) is None
