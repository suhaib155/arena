/**
 * Case generators for the bookkeeping properties. Every draw comes from the
 * seeded `Rng`; nothing reads the clock or Math.random.
 *
 * Synthetic data only: ids like "p3", "c17" and "z2/u4" are labels, not places.
 */
import type { DayInput, EconomyRules, KitLevel, LandLevel, PlayerDayInput, SessionInput } from "@movenrun/shared/economy-v3";
import type { HoldingRules, UnitState } from "@movenrun/shared/holding";
import { newUnit } from "@movenrun/shared/holding";
import type { LedgerEntry } from "@movenrun/shared/holdingLedger";
import type { CreditsPlayerInput } from "@movenrun/shared/holdingSettlement";
import type { Rng } from "./prng";

export const LEVELS: readonly LandLevel[] = [1, 2, 3, 4, 5];
export const KITS: readonly KitLevel[] = [1, 2, 3, 4, 5];

/** D4 is open: placeholder decay numbers for the harness, not a proposal. */
export const HARNESS_HOLDING_RULES: HoldingRules = {
  rulesVersion: 7,
  solidDecayPerDay: 10,
  shadeDecayMultiplier: 3,
  stageFloors: { held: 60, atRisk: 30, contested: 10 },
};
/** D5 is open: in the harness a unit's zone is the part of its id before "/". */
export const harnessZoneOf = (unitId: string): string => unitId.split("/")[0]!;

export function minutesDraw(rng: Rng): number {
  const r = rng.next();
  if (r < 0.1) return rng.int(0, 9); // below the qualifying line
  if (r < 0.15) return 10; // exactly on it
  if (r < 0.7) return rng.int(10, 60);
  if (r < 0.95) return rng.int(60, 240);
  return Math.round(rng.next() * 100_000) / 100; // fractional minutes
}

export function metersDraw(rng: Rng): number {
  const r = rng.next();
  if (r < 0.08) return rng.int(0, 749);
  if (r < 0.12) return 750;
  return rng.int(750, 30_000);
}

export function sessionDraw(rng: Rng, cells: readonly string[]): SessionInput {
  const crossed: string[] = [];
  const n = rng.int(0, Math.min(30, cells.length));
  for (let i = 0; i < n; i++) crossed.push(rng.pick(cells));
  // Laps: repeat some cells.
  if (crossed.length > 0 && rng.chance(0.3)) for (let i = rng.int(1, 10); i > 0; i--) crossed.push(rng.pick(crossed));
  return { minutes: minutesDraw(rng), meters: metersDraw(rng), unscored: rng.chance(0.08) || undefined, crossedCells: crossed };
}

export function trustDraw(rng: Rng): number {
  const r = rng.next();
  if (r < 0.6) return 1;
  if (r < 0.7) return 0;
  if (r < 0.8) return 0.5;
  return Math.round(rng.next() * 1000) / 1000;
}

export interface G0Options {
  maxPlayers: number;
  /** Pool in micro: "rules" uses the season-one daily pool, otherwise drawn small so it binds. */
  pool: "rules" | "small" | "mixed";
}

/** A settleDay input: players, sessions, deeds, links. */
export function g0Day(rng: Rng, rules: EconomyRules, opts: G0Options): DayInput {
  const nPlayers = rng.int(0, opts.maxPlayers);
  const cells = Array.from({ length: rng.int(1, 60) }, (_, i) => `c${i}`);
  const ids = Array.from({ length: nPlayers }, (_, i) => `p${i}`);
  const outsiders = Array.from({ length: rng.int(0, 6) }, (_, i) => `o${i}`);
  const owners = [...ids, ...outsiders];
  const deedOwnerByCell = new Map<string, string>();
  if (owners.length > 0) for (const c of cells) if (rng.chance(0.35)) deedOwnerByCell.set(c, rng.pick(owners));
  const players: PlayerDayInput[] = ids.map((playerId) => {
    const zonesHeld = rng.chance(0.5) ? 0 : rng.int(0, 40);
    const unvisited = Array.from({ length: rng.int(0, zonesHeld) }, () => rng.pick(LEVELS));
    const linked = owners.filter((o) => o !== playerId && rng.chance(0.08));
    return {
      playerId,
      linkedPlayerIds: linked.length > 0 ? linked : undefined,
      sessions: Array.from({ length: rng.int(0, 4) }, () => sessionDraw(rng, cells)),
      activeDaysThisWeek: rng.int(1, 7),
      trustWeight: trustDraw(rng),
      kitLevel: rng.pick(KITS),
      zonesHeld,
      unvisitedZoneLevels: unvisited,
      awayProtected: rng.chance(0.1) || undefined,
    };
  });
  const mode = opts.pool === "mixed" ? (rng.chance(0.5) ? "rules" : "small") : opts.pool;
  const poolMicro =
    mode === "rules"
      ? rules.seasonOneDailyPoolMicro
      : rng.pick([0, 1, 7, rng.int(0, 1_000), rng.int(0, 50_000_000), rng.int(0, 1_000_000_000)]);
  return { poolMicro, players, deedOwnerByCell };
}

/* ── G3: holdings plus players ─────────────────────────────────────────────── */

export interface G3Case {
  day: number;
  states: Map<string, UnitState>;
  entries: LedgerEntry[];
  players: CreditsPlayerInput[];
}

/**
 * Units grouped into zones, held by players or strangers, some deeded, some
 * shade; one level per holder per zone (so the D5 refusal only fires when a
 * case injects it); visits as solid ledger entries dated the day.
 */
export function g3Day(rng: Rng, day: number, opts: { maxPlayers: number } = { maxPlayers: 10 }): G3Case {
  const nPlayers = rng.int(0, opts.maxPlayers);
  const ids = Array.from({ length: nPlayers }, (_, i) => `p${i}`);
  const strangers = Array.from({ length: rng.int(0, 3) }, (_, i) => `s${i}`);
  const holders = [...ids, ...strangers];
  const states = new Map<string, UnitState>();
  const levelOf = new Map<string, LandLevel>();
  const nZones = rng.int(0, 8);
  for (let z = 0; z < nZones; z++) {
    for (let u = rng.int(1, 6); u > 0; u--) {
      const unitId = `z${z}/u${u}`;
      if (holders.length === 0 || rng.chance(0.2)) {
        states.set(unitId, newUnit(unitId, day - rng.int(0, 3)));
        continue;
      }
      const holderId = rng.pick(holders);
      const key = `${holderId}\u0000z${z}`;
      const level = levelOf.get(key) ?? rng.pick(LEVELS);
      levelOf.set(key, level);
      const deeded = rng.chance(0.25);
      const shade = !deeded && rng.chance(0.2);
      states.set(unitId, {
        ...newUnit(unitId, day - rng.int(0, 3)),
        holderId,
        strength: shade ? rng.int(1, 25) : rng.int(40, 100),
        ground: shade ? "shade" : "solid",
        deeded,
        level,
        fortified: rng.chance(0.1),
      });
    }
  }
  const unitIds = [...states.keys()];
  const entries: LedgerEntry[] = [];
  let k = 0;
  for (const w of ids) {
    if (unitIds.length === 0) break;
    for (let n = rng.int(0, 4); n > 0; n--) {
      const unitId = rng.pick(unitIds);
      const s = states.get(unitId)!;
      entries.push({
        eventId: `e${k++}`,
        unitId,
        walkerId: w,
        day,
        pushKind: rng.chance(0.85) ? "solid" : "shade",
        outcome: s.holderId === w ? "reinforced" : "eroded",
        previousHolderId: s.holderId,
        newHolderId: s.holderId,
        strengthBefore: s.strength,
        strengthAfter: s.strength,
        rulesVersion: HARNESS_HOLDING_RULES.rulesVersion,
      });
    }
  }
  const cells = unitIds.length > 0 ? unitIds : ["x0"];
  const players: CreditsPlayerInput[] = ids.map((playerId) => {
    const linked = holders.filter((o) => o !== playerId && rng.chance(0.08));
    return {
      playerId,
      linkedPlayerIds: linked.length > 0 ? linked : undefined,
      sessions: Array.from({ length: rng.int(0, 4) }, () => sessionDraw(rng, cells)),
      activeDaysThisWeek: rng.int(1, 7),
      trustWeight: trustDraw(rng),
      kitLevel: rng.pick(KITS),
      awayProtected: rng.chance(0.1) || undefined,
    };
  });
  return { day, states, entries, players };
}
