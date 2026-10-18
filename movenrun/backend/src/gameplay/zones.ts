/**
 * Zone partitions for rule set 1002 (`per-holder-min-level-v1`, open
 * decision D5, SIMULATION-PILOT PROPOSAL).
 *
 * A resolution 9 zone can contain resolution 10 units held by different
 * walkers. The zone is never given a single holder. It is split, for every
 * purpose, into one partition per holder: the units of that zone that walker
 * holds at day close (after decay, counted ground only: shade is left out
 * when shade does not count as held, D15).
 *
 * - **Upkeep**: each partition is one held zone of its holder and pays that
 *   zone's upkeep once, at the partition's level. A unit is in exactly one
 *   partition, so no unit is charged twice and nobody pays for another
 *   walker's ground.
 * - **Level**: the partition's level is the lowest level among its units.
 *   Deterministic, never above any unit's own level, and it cannot be raised
 *   by flipping a stronger walker's unit into the partition (a flipped unit
 *   starts at level 1). Today every unit is level 1 (no level purchase
 *   exists), so this changes no number; it replaces the shared model's
 *   refusal of the whole day when one holder's units in a zone differ.
 * - **Visits and away days**: a partition is visited when its holder stepped
 *   on any unit of the zone that day (the shared model's rule). Away-day
 *   protection (D17, not built) would apply to a holder's own partitions
 *   only, never to another holder's partition of the same zone.
 * - **Upgrades** (level purchase or fortify, not built): would act on the
 *   buyer's partition only, that is on the buyer's units in that zone.
 *
 * Settlement checks the invariants below and refuses the day on any breach.
 * Nothing here is player-facing: partitions, zones and units are internal
 * ids and never leave the server.
 */
import { decayTo, type HoldingRules, type LandLevel, type UnitState } from "@movenrun/shared/holding";
import type { HoldingsAtClose } from "@movenrun/shared/holdingSettlement";

export interface Partition {
  zoneId: string;
  holderId: string;
  level: LandLevel;
  unitIds: string[];
}

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Counted held ground at the close of `day`, by (zone, holder). Sorted by zone, then holder; unit ids sorted. */
export function zonePartitions(input: {
  day: number;
  states: ReadonlyMap<string, UnitState>;
  holding: HoldingRules;
  zoneOf: (unitId: string) => string;
  shadeCountsAsHeld: boolean;
}): Partition[] {
  const byKey = new Map<string, Partition>();
  for (const [unitId, raw] of [...input.states].sort(([a], [b]) => byString(a, b))) {
    if (raw.asOfDay > input.day) continue;
    const s = decayTo(raw, input.day, input.holding);
    if (s.holderId === null) continue;
    if (s.ground === "shade" && !input.shadeCountsAsHeld) continue;
    const zoneId = input.zoneOf(unitId);
    const key = `${zoneId}\u0000${s.holderId}`;
    const p = byKey.get(key) ?? { zoneId, holderId: s.holderId, level: s.level, unitIds: [] };
    byKey.set(key, p);
    p.unitIds.push(unitId);
    if (s.level < p.level) p.level = s.level;
  }
  return [...byKey.values()].sort((a, b) => byString(a.zoneId, b.zoneId) || byString(a.holderId, b.holderId));
}

/**
 * The states to settle with: every held unit carries its partition's level,
 * so the shared model sees one level per holder and zone. Units outside a
 * partition (unheld, shade not counted) are returned unchanged.
 */
export function withPartitionLevels(states: ReadonlyMap<string, UnitState>, partitions: readonly Partition[]): Map<string, UnitState> {
  const out = new Map(states);
  for (const p of partitions) {
    for (const u of p.unitIds) {
      const s = out.get(u)!;
      if (s.level !== p.level) out.set(u, { ...s, level: p.level });
    }
  }
  return out;
}

/**
 * Settlement invariants for partitioned zones; empty when they hold.
 *
 * 1. Every counted held unit is in exactly one partition, and its holder is
 *    the partition's holder.
 * 2. The model's held zones are exactly the partitions: one per (zone,
 *    holder), with the same units and level. No holder holds a zone in which
 *    they hold no unit, and no zone is counted twice for one holder.
 * 3. Each credit line's `zonesHeld` equals its holder's partition count, and
 *    the lines' total equals the number of partitions.
 */
export function partitionProblems(input: {
  partitions: readonly Partition[];
  holdings: Pick<HoldingsAtClose, "holders">;
  lines?: readonly { playerId: string; zonesHeld: number }[];
}): string[] {
  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const p of input.partitions) {
    for (const u of p.unitIds) {
      const prior = seen.get(u);
      if (prior !== undefined) problems.push(`unit ${u} is in two partitions (${prior}, ${p.holderId})`);
      seen.set(u, p.holderId);
    }
  }
  const expected = new Map(input.partitions.map((p) => [`${p.zoneId}\u0000${p.holderId}`, p]));
  let modelCount = 0;
  for (const h of input.holdings.holders) {
    const zones = new Set<string>();
    for (const z of h.zones) {
      modelCount += 1;
      if (zones.has(z.zoneId)) problems.push(`zone ${z.zoneId} counted twice for ${h.playerId}`);
      zones.add(z.zoneId);
      const p = expected.get(`${z.zoneId}\u0000${h.playerId}`);
      if (!p) {
        problems.push(`zone ${z.zoneId} held by ${h.playerId} without a unit there`);
        continue;
      }
      if (p.level !== z.level) problems.push(`zone ${z.zoneId}: ${h.playerId} at level ${z.level}, partition at ${p.level}`);
      if ([...z.unitIds].sort(byString).join(",") !== p.unitIds.join(",")) problems.push(`zone ${z.zoneId}: ${h.playerId}'s units differ from the partition`);
    }
  }
  if (modelCount !== input.partitions.length) problems.push(`held zones ${modelCount} differ from partitions ${input.partitions.length}`);
  if (input.lines) {
    const perHolder = new Map<string, number>();
    for (const p of input.partitions) perHolder.set(p.holderId, (perHolder.get(p.holderId) ?? 0) + 1);
    let total = 0;
    for (const l of input.lines) {
      total += l.zonesHeld;
      if (l.zonesHeld !== (perHolder.get(l.playerId) ?? 0)) problems.push(`credit line ${l.playerId}: ${l.zonesHeld} zones, ${perHolder.get(l.playerId) ?? 0} partitions`);
    }
    if (total !== input.partitions.length) problems.push(`credit lines hold ${total} zones, partitions ${input.partitions.length}`);
  }
  return problems;
}
