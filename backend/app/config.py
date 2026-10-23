"""Configuration: example gas thresholds, simulation settings and feature flags.

IMPORTANT: All thresholds below are *example values for a simulated prototype*.
They are NOT legal limits. Real thresholds must be configured against applicable
mining regulations, site-specific procedures and calibrated instruments.
"""
from __future__ import annotations

import os
from copy import deepcopy
from dataclasses import dataclass, asdict
from datetime import datetime, timezone

# Fixed simulated clock origin: the simulation "starts" at this instant.
SIM_ORIGIN: float = datetime(2026, 3, 2, 8, 0, 0, tzinfo=timezone.utc).timestamp()

GAS_ORDER = ["ch4", "co", "o2", "co2", "h2s"]
ENV_KEYS = ["temp", "rh", "pressure"]
METRIC_KEYS = GAS_ORDER + ENV_KEYS


def sim_iso(t: float) -> str:
    """Simulated time as ISO-8601 (UTC). This is a *simulated* clock."""
    return datetime.fromtimestamp(t, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass
class GasDef:
    key: str
    name: str
    formula: str
    unit: str
    decimals: int
    warn_high: float | None = None
    crit_high: float | None = None
    warn_low: float | None = None
    crit_low: float | None = None


def _default_gases() -> dict[str, GasDef]:
    return {
        "ch4": GasDef("ch4", "Methane", "CH₄", "% vol", 2, warn_high=1.0, crit_high=2.0),
        "co": GasDef("co", "Carbon monoxide", "CO", "ppm", 1, warn_high=25.0, crit_high=50.0),
        "o2": GasDef("o2", "Oxygen", "O₂", "% vol", 2, warn_low=19.5, crit_low=18.0, warn_high=22.0, crit_high=23.5),
        "co2": GasDef("co2", "Carbon dioxide", "CO₂", "ppm", 0, warn_high=5000.0, crit_high=15000.0),
        "h2s": GasDef("h2s", "Hydrogen sulfide", "H₂S", "ppm", 2, warn_high=5.0, crit_high=10.0),
    }


class ThresholdConfig:
    """Configurable *example* thresholds."""

    def __init__(self) -> None:
        self.gases: dict[str, GasDef] = _default_gases()

    def reset(self) -> None:
        self.gases = _default_gases()

    def to_dict(self) -> dict:
        return {k: asdict(v) for k, v in self.gases.items()}

    def update(self, gas: str, **vals: float | None) -> GasDef:
        if gas not in self.gases:
            raise ValueError(f"Unknown gas '{gas}'")
        g = deepcopy(self.gases[gas])
        for k, v in vals.items():
            if k not in ("warn_high", "crit_high", "warn_low", "crit_low"):
                raise ValueError(f"Unknown threshold field '{k}'")
            if v is not None:
                setattr(g, k, float(v))
        self._validate(g)
        self.gases[gas] = g
        return g

    @staticmethod
    def _validate(g: GasDef) -> None:
        if g.warn_high is not None and g.crit_high is not None and not g.warn_high < g.crit_high:
            raise ValueError(f"{g.key}: warn_high must be below crit_high")
        if g.warn_low is not None and g.crit_low is not None and not g.crit_low < g.warn_low:
            raise ValueError(f"{g.key}: crit_low must be below warn_low")
        if g.warn_low is not None and g.warn_high is not None and not g.warn_low < g.warn_high:
            raise ValueError(f"{g.key}: warn_low must be below warn_high")


@dataclass
class SimSettings:
    seed: int = 42
    tick_interval_s: float = 1.0       # wall-clock seconds between telemetry ticks
    sample_interval_s: float = 5.0     # simulated seconds between history samples
    backfill_hours: float = 6.0        # simulated history generated before t0
    stale_after_s: float = 15.0        # sensor telemetry older than this is stale
    worker_stale_after_s: float = 30.0
    min_coverage: float = 0.7          # fraction of segments with valid data needed to judge safety
    walk_speed_mps: float = 1.1
    rover_speed_mps: float = 0.8
    hazard_near_m: float = 60.0
    rover_autostart: bool = True
    ambient_events: bool = True        # occasional controlled warning events


def env_flag(name: str, default: bool = False) -> bool:
    v = os.getenv(name)
    if v is None:
        return default
    return v.strip().lower() in ("1", "true", "yes", "on")


PERSIST_ENABLED = env_flag("RAGMINE_PERSIST", False)
DB_PATH = os.getenv("RAGMINE_DB", os.path.join(os.path.dirname(__file__), "..", "data", "ragmine.db"))
AUTOSTART = env_flag("RAGMINE_AUTOSTART", True)
HARDWARE_ADAPTER_ENABLED = env_flag("ENABLE_HARDWARE_ADAPTER", False)  # OFF by default
CORS_ORIGINS = [o.strip() for o in os.getenv("RAGMINE_CORS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()]
