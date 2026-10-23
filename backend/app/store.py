"""Optional SQLite persistence of simulated telemetry and alerts (off by default: RAGMINE_PERSIST=1)."""
from __future__ import annotations

import json
import os
import sqlite3

from .config import METRIC_KEYS


class SqliteStore:
    def __init__(self, path: str) -> None:
        self.path = os.path.abspath(path)
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        self.conn = sqlite3.connect(self.path, check_same_thread=False)
        cols = ", ".join(f"{k} REAL" for k in METRIC_KEYS)
        self.conn.execute(f"CREATE TABLE IF NOT EXISTS telemetry (run TEXT, t REAL, sensor TEXT, {cols})")
        self.conn.execute("CREATE TABLE IF NOT EXISTS alerts (run TEXT, id TEXT, t REAL, json TEXT)")
        self.conn.execute("CREATE INDEX IF NOT EXISTS ix_tel ON telemetry (run, t)")
        self.conn.commit()
        self.ok = True
        self.run = "run"
        self._buf: list[tuple] = []
        self.rows_written = 0
        self.last_error: str | None = None

    def new_run(self, run_id: str) -> None:
        self.run = run_id

    def write_sample(self, t: float, readings: dict[str, dict | None]) -> None:
        for sid, vals in readings.items():
            if vals:
                self._buf.append((self.run, t, sid, *[vals.get(k) for k in METRIC_KEYS]))
        if len(self._buf) >= 300:
            self.flush()

    def write_alert(self, alert: dict) -> None:
        try:
            self.conn.execute("INSERT INTO alerts VALUES (?,?,?,?)", (self.run, alert["id"], alert["t"], json.dumps(alert)))
            self.conn.commit()
        except sqlite3.Error as e:  # pragma: no cover
            self.ok, self.last_error = False, str(e)

    def flush(self) -> None:
        if not self._buf:
            return
        try:
            q = "INSERT INTO telemetry VALUES (" + ",".join("?" * (3 + len(METRIC_KEYS))) + ")"
            self.conn.executemany(q, self._buf)
            self.conn.commit()
            self.rows_written += len(self._buf)
        except sqlite3.Error as e:  # pragma: no cover
            self.ok, self.last_error = False, str(e)
        self._buf = []

    def status(self) -> dict:
        return {"enabled": True, "ok": self.ok, "path": self.path, "rows_written": self.rows_written, "error": self.last_error}

    def close(self) -> None:
        self.flush()
        self.conn.close()
