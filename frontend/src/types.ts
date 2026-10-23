export type SafetyState = "SAFE" | "WARNING" | "DANGER" | "UNKNOWN";
export type Severity = "critical" | "warning" | "info";
export type GasKey = "ch4" | "co" | "o2" | "co2" | "h2s";
export type MetricKey = GasKey | "temp" | "rh" | "pressure";
export type Vec3 = [number, number, number];

export const GAS_KEYS: GasKey[] = ["ch4", "co", "o2", "co2", "h2s"];
export const GAS_INFO: Record<GasKey, { formula: string; unit: string; decimals: number }> = {
  ch4: { formula: "CH₄", unit: "% vol", decimals: 2 },
  co: { formula: "CO", unit: "ppm", decimals: 1 },
  o2: { formula: "O₂", unit: "% vol", decimals: 2 },
  co2: { formula: "CO₂", unit: "ppm", decimals: 0 },
  h2s: { formula: "H₂S", unit: "ppm", decimals: 2 },
};

export interface Reason {
  code: string; severity: Severity; segment_id: string; zone?: string; ts: string | null;
  metric?: string; value?: number; unit?: string; threshold?: number; direction?: "high" | "low";
  sensor_id?: string; stale?: boolean; age_s?: number; action?: string;
}
export interface SegmentLive {
  id: string; name: string; zone: string; length_m: number; width_m: number; state: SafetyState;
  avoid: boolean; traversable: boolean; obstructed: boolean; restricted: boolean; reasons: Reason[];
  sensor_id: string; sensor_status: "ok" | "stale" | "fault" | "no_data"; values: Partial<Record<MetricKey, number>>;
  last_update: string | null; connected: string[];
  mapping: { state: "unexplored" | "partial" | "explored"; explored_m: number; ratio: number; intervals: [number, number][] };
}
export interface HazardInfo { segment_id: string; distance_m: number; near: boolean }
export interface ExitInfo { found: boolean; dest_node: string; distance_m: number; eta_s: number; segments: string[]; message: string | null }
export interface WorkerLive {
  id: string; callsign: string; segment_id: string; zone: string; pos: Vec3; true_pos: Vec3; heading: number;
  status: string; speed_mps: number; last_update: string; age_s: number; stale: boolean; comm_lost: boolean;
  destination: string | null; destination_name: string | null; route_remaining_m: number; route_segments: string[];
  hazard: HazardInfo | null; evacuated: boolean; segment_state: SafetyState; navigating: boolean; nav_mode: string | null; exit: ExitInfo;
}
export interface Instruction {
  type: "start" | "turn" | "continue" | "arrive" | "reroute"; segment_id?: string; segment_name?: string; distance_m?: number;
  at_distance_m?: number; turn?: string; junction_id?: string; junction_name?: string; node_id?: string; node_name?: string; text: string;
}
export interface NavLive {
  worker_id: string; mode: "normal" | "emergency"; status: string; paused: boolean; dest_node: string | null; dest_name: string | null;
  found: boolean; message: string | null; remaining_m: number; eta_s: number; progress: number; warnings: { segment_id: string; reason: string }[];
  instructions: Instruction[]; path: Vec3[]; rerouted_recently: boolean; system: boolean; alternate: boolean;
}
export interface RoverLive {
  id: string; mode: string; mapping: boolean; task: string; segment_id: string; segment_name: string; zone: string; pos: Vec3;
  heading: number; speed_mps: number; battery_pct: number; connection: "online" | "lost"; last_telemetry: string; age_s: number;
  odometer_m: number; obstacles: { time: string; kind: string; segment_id: string }[]; trajectory: number[][]; traj_count: number;
  manual_cmd: string; low_battery_return: boolean;
}
export interface AlertItem {
  id: string; severity: Severity; category: string; zone: string | null; segment_id: string | null;
  related: { type: string; id: string } | null; t: number; time: string; params: Record<string, any>;
  status: "open" | "acknowledged" | "resolved"; acknowledged_at: string | null; resolved_at: string | null;
  resolved_by: string | null; condition_active: boolean; persistent?: boolean;
}
export interface Mapping {
  total_m: number; explored_m: number; remaining_m: number; coverage_pct: number; segments_total: number; segments_explored: number;
  restricted_unexplored_m: number; current_segment: string; last_mapped: string | null; definition: string;
}
export interface Threshold { key: GasKey; name: string; formula: string; unit: string; decimals: number; warn_high: number | null; crit_high: number | null; warn_low: number | null; crit_low: number | null }
export interface TimelineItem { t: number; time: string; kind: string; severity: Severity; params: Record<string, any> }
export interface Snapshot {
  type: "telemetry"; simulated: true; mode: "SIMULATION"; seq: number; t: number; sim_time: string; running: boolean; speed: number; speeds: number[]; tick_interval_s: number;
  safety: {
    state: SafetyState; action: string; disclaimer: string; triggers: Reason[];
    zones: Record<string, { zone: string; state: SafetyState; segments: string[]; avoid: boolean }>;
    monitoring: { segments_total: number; segments_valid: number; ratio: number; min_required: number; unknown_segments: string[] };
    counts: { danger: number; warning: number; unknown: number };
  };
  segments: Record<string, SegmentLive>; workers: WorkerLive[]; rover: RoverLive; navigation: NavLive[];
  alerts: { counts: { active: number; critical: number; warning: number; unacknowledged: number; total: number }; recent: AlertItem[] };
  mapping: Mapping;
  kpi: {
    env: Record<"temp" | "rh" | "pressure", { value: number | null; trend: number | null; sensors: number }>;
    gas: Record<GasKey, { value: number | null; segment_id: string | null; trend: number | null }>;
  };
  health: {
    engine: string; running: boolean; sensors: { ok: number; fault: number; stale: number; no_data: number }; sensors_total: number;
    max_telemetry_age_s: number | null; history_samples: number; rejected_frames: number;
    persistence: { enabled: boolean; ok?: boolean; path?: string; rows_written?: number; error?: string | null };
    hardware: { hardware_adapter_enabled: boolean; active_adapter: string; note: string }; last_tick_wall: number; reset_count: number;
  };
  emergency: { active: boolean; evacuation: boolean; hazards: { segment_id: string; name: string; zone: string; state: SafetyState; obstructed: boolean }[]; affected_workers: string[]; rover_affected: boolean };
  scenarios: { id: string; kind: string; segment_id: string | null; zone: string | null; gas: string | null; since: string; until: string | null }[];
  ambient: { id: string; segment_id: string; gas: string; since: string }[];
  timeline: TimelineItem[];
  thresholds: Record<GasKey, Omit<Threshold, "key"> & { key?: GasKey }>;
}

export interface MineNode { id: string; name: string; kind: string; pos: Vec3; checkpoint: string | null; emergency_exit: boolean; degree: number }
export interface MineSegment {
  id: string; name: string; a: string; b: string; length_m: number; width_m: number; zone: string; kind: string; restricted: boolean;
  polyline: Vec3[]; connected_segments: string[]; dead_end: boolean;
}
export interface MineMap { nodes: MineNode[]; segments: MineSegment[]; total_length_m: number; connected: boolean; note: string }

export interface HistoryResult {
  t: number[]; series: Record<string, { v: (number | null)[]; avg: (number | null)[]; min: (number | null)[]; max: (number | null)[] }>;
  stats: Record<string, { min: number; max: number; avg: number; last: number; trend: "rising" | "falling" | "stable"; delta: number; per_hour: number } | null>;
  units: Record<string, string>; sensor: string; samples: number; from: string; to: string; t_from: number; t_to: number;
}
export interface RoutePreview {
  found: boolean; dest_node: string; message: string | null; distance_m: number; eta_s: number; nodes: string[];
  segments: { segment_id: string; length_m: number; to_node: string }[]; warnings: { segment_id: string; reason: string }[];
  instructions: Instruction[]; path: Vec3[];
}
export interface Analytics {
  events: { warning: number; critical: number }; event_buckets: { t: number; warning: number; critical: number }[];
  hazard_distribution: { segment_id: string; name: string; warning_s: number; critical_s: number }[];
  state_distribution: Record<SafetyState, number>; coverage: { t: number; coverage_pct: number; explored_m: number }[];
  exposure: { t: number; time: string; worker_id: string; segment_id: string; state: SafetyState }[]; exposure_total: number;
  rover_history: { odometer_m: number; trajectory_points: number }; note: string;
}
