# Scenarios (Simulation panel → Scenarios)
| Scenario | Effect | Expected result |
|---|---|---|
| Warning | chosen gas ramps over its warning limit in a segment | segment WARNING, gas_warning alert; auto-resolves when it clears |
| Critical gas | ramps past critical (CH4/CO/H2S high, O2 low) | segment DANGER, mine DANGER, emergency banner, workers nearby re-routed, critical alert needs operator resolve |
| Sensor failure | sensor stops reporting | segment UNKNOWN (never SAFE); stays DANGER if last value was critical |
| Communication loss | whole zone stops updating | stale telemetry/locations, UNKNOWN or WARNING monitoring state |
| Blocked tunnel | segment obstructed | WARNING, non-traversable, routes recalculated; "NO SAFE SIMULATED ROUTE AVAILABLE." if none |
| Evacuation | all workers route to nearest exit | evacuation progress alerts and timeline events |
| Clear | removes all scenario events | state recovers; critical alerts remain until resolved by an operator |

Background: a few deterministic, routine warning events run on their own (shown as "routine background events").
Everything is reproducible for seed 42; **Reset to baseline** restores the initial state.
