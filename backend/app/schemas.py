"""Request schemas (pydantic v2). These validate every incoming API body."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

GasKey = Literal["ch4", "co", "o2", "co2", "h2s"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ScenarioRequest(Strict):
    scenario: Literal["warning", "critical_gas", "sensor_failure", "comm_loss", "blocked_tunnel", "evacuation", "clear"]
    segment_id: Optional[str] = Field(default=None, pattern=r"^S\d{2}$")
    gas: Optional[GasKey] = None
    zone: Optional[Literal["Main", "North", "South", "East"]] = None


class SpeedRequest(Strict):
    speed: float = Field(description="Simulation speed multiplier: one of 1, 2, 5, 10, 30, 60")


class RoverCommandRequest(Strict):
    command: Literal["forward", "backward", "turn_left", "turn_right", "stop", "start_mapping", "pause_mapping", "return_to_base"]
    speed_mps: float = Field(default=0.8, ge=0.0, le=0.8)
    duration_s: float = Field(default=1.0, gt=0.0, le=5.0)


class NavStartRequest(Strict):
    worker_id: str = Field(pattern=r"^W-\d{3}$")
    dest_node: Optional[str] = Field(default=None, max_length=16)
    mode: Literal["normal", "emergency"] = "normal"
    alternate: bool = False


class NavControlRequest(Strict):
    worker_id: str = Field(pattern=r"^W-\d{3}$")
    action: Literal["pause", "resume", "stop", "recalculate"]


class ThresholdUpdate(Strict):
    gas: GasKey
    warn_high: Optional[float] = None
    crit_high: Optional[float] = None
    warn_low: Optional[float] = None
    crit_low: Optional[float] = None
