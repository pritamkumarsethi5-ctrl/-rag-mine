"""Telemetry / command adapters.

The simulation consumes *frames* from an adapter and never talks to hardware directly.

    SimulatedAdapter       - default, produces frames from the local simulation model.
    Esp32SerialAdapter     - FUTURE hardware adapter. DISABLED unless ENABLE_HARDWARE_ADAPTER=1,
                             and even then it only validates/parses frames; it sends NO commands.

Frame schema (JSON, one per sensor node per sample):
    {"sensor_id": "GS-S04", "t": 1772438400.0, "status": "ok" | "fault",
     "values": {"ch4": 0.12, "co": 2.1, "o2": 20.8, "co2": 810, "h2s": 0.1,
                "temp": 26.4, "rh": 74.0, "pressure": 1010.9}}
"""
from __future__ import annotations

import json
import math
from typing import Protocol

from .config import HARDWARE_ADAPTER_ENABLED
from .mine_graph import MineGraph
from .telemetry import SensorBank, TelemetryModel

ROVER_COMMANDS = {"forward", "backward", "turn_left", "turn_right", "stop", "start_mapping", "pause_mapping", "return_to_base"}
MAX_MANUAL_SPEED_MPS = 0.8


class AdapterDisabled(RuntimeError):
    pass


class TelemetryAdapter(Protocol):
    name: str
    is_simulated: bool

    def poll(self, t: float, comm_zones: set[str]) -> list[dict]: ...
    def status(self) -> dict: ...


class SimulatedAdapter:
    name = "simulated"
    is_simulated = True

    def __init__(self, model: TelemetryModel, graph: MineGraph) -> None:
        self.model = model
        self.graph = graph
        self.faults: dict[str, str] = {}

    def set_fault(self, sensor_id: str) -> None:
        self.faults[sensor_id] = "fault"

    def clear_fault(self, sensor_id: str | None = None) -> None:
        if sensor_id is None:
            self.faults.clear()
        else:
            self.faults.pop(sensor_id, None)

    def poll(self, t: float, comm_zones: set[str]) -> list[dict]:
        frames: list[dict] = []
        for sid in self.model.seg_ids:  # fixed order -> deterministic random stream
            sensor_id = f"GS-{sid}"
            vals = self.model.read(sid, t)
            if self.faults.get(sensor_id) == "fault":
                frames.append({"sensor_id": sensor_id, "t": t, "status": "fault", "values": None, "source": "simulated"})
            elif self.graph.segments[sid].zone in comm_zones:
                continue  # communication loss: no frame at all -> data goes stale
            else:
                frames.append({"sensor_id": sensor_id, "t": t, "status": "ok", "values": vals, "source": "simulated"})
        return frames

    def status(self) -> dict:
        return {"name": self.name, "simulated": True, "enabled": True, "faults": dict(self.faults)}


class Esp32SerialAdapter:
    """Placeholder for a future ESP32 link (serial/WiFi). Not used by the simulation.

    It demonstrates the boundary: parse -> validate -> hand frames to SensorBank.
    """

    name = "esp32"
    is_simulated = False

    def __init__(self) -> None:
        if not HARDWARE_ADAPTER_ENABLED:
            raise AdapterDisabled("Hardware adapter is disabled. Set ENABLE_HARDWARE_ADAPTER=1 to allow it.")
        self._queue: list[dict] = []

    def feed_line(self, line: str) -> str | None:
        """Parse one JSON line from the device. Returns an error string if rejected."""
        try:
            frame = json.loads(line)
        except json.JSONDecodeError:
            return "invalid json"
        err = SensorBank.validate_frame(frame)
        if err is None:
            frame["source"] = "esp32"
            self._queue.append(frame)
        return err

    def poll(self, t: float, comm_zones: set[str]) -> list[dict]:
        out, self._queue = self._queue, []
        return out

    def status(self) -> dict:
        return {"name": self.name, "simulated": False, "enabled": True, "queued": len(self._queue)}

    def send_command(self, command: dict) -> None:
        validate_rover_command(command)
        raise NotImplementedError("Motor command transmission is intentionally not implemented in this prototype.")


def validate_rover_command(cmd: dict) -> dict:
    """Validate a command before it could ever reach hardware (whitelist + bounds)."""
    if not isinstance(cmd, dict) or cmd.get("command") not in ROVER_COMMANDS:
        raise ValueError("unknown rover command")
    speed = cmd.get("speed_mps", 0.0)
    if not isinstance(speed, (int, float)) or not math.isfinite(speed) or not 0.0 <= speed <= MAX_MANUAL_SPEED_MPS:
        raise ValueError(f"speed_mps must be within 0..{MAX_MANUAL_SPEED_MPS}")
    dur = cmd.get("duration_s", 1.0)
    if not isinstance(dur, (int, float)) or not math.isfinite(dur) or not 0.0 < dur <= 5.0:
        raise ValueError("duration_s must be within (0, 5]")
    return {"command": cmd["command"], "speed_mps": float(speed), "duration_s": float(dur)}


def hardware_status() -> dict:
    return {
        "hardware_adapter_enabled": HARDWARE_ADAPTER_ENABLED,
        "active_adapter": "simulated",
        "note": "No real hardware is connected. All data and rover commands are simulated.",
    }
