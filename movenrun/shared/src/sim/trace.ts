/**
 * An opt-in, per-day record of a simulated season, for analyses that need
 * more than the season summary (the G5–G7 economy research in `economyG5.ts`).
 *
 * Collecting it changes nothing the simulator computes: the same seed gives
 * the same fingerprint with and without a trace (tested). SIMULATION ONLY:
 * synthetic players on a synthetic grid.
 */

import type { SIM_ONLY } from "./pilotRuleset";
import type { Profile } from "./world";

export interface TraceLine {
  playerId: string;
  /** The day's reward after both ceilings and trust weight (what the day mints for this player). */
  earnedMicro: number;
  rechargeMicro: number;
  upkeepTakenMicro: number;
  tollPaidMicro: number;
  tollReceivedMicro: number;
  /** Credits kept that day, as settled. */
  netMicro: number;
}

export interface TraceDay {
  day: number;
  poolMicro: number;
  dayShareMicro: number;
  /** One per settled player row, sorted by player id. */
  lines: TraceLine[];
  /** Level purchases the simulator made that day, by player (outside the models' books). */
  levelSpendMicro: [playerId: string, micro: number][];
  /** Units held at day close: [unitId, holderId, ground], sorted by unit id. */
  held: [unitId: string, holderId: string, ground: "solid" | "shade"][];
  /** Distinct walkers with an applied stepped-on ("solid") push on each unit that day, sorted. */
  stepped: [unitId: string, walkerIds: string[]][];
}

export interface SeasonTrace {
  status: typeof SIM_ONLY;
  ruleset: string;
  seed: number;
  units: number;
  players: { id: string; profile: Profile; club: string | null }[];
  days: TraceDay[];
}
