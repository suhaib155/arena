/**
 * The scenario lab's engine: one scenario's sessions through one rule
 * variant, in server receipt order, through the server's own pure ledger
 * step (`applyServerLedger`, backend gameplay policy.ts, imported read-only).
 * Holding arithmetic, the two-day challenge, the one-push rule, the take
 * budget, walk order, the second-push gap and the unit budget are therefore
 * the server's code, not a re-implementation. What the engine adds is what
 * the service does around it (D1 day, day close with grace, retries) and the
 * measurements.
 *
 * Separate from shared/src/sim/simulate.ts: nothing is imported from there.
 * Every number it produces is a SYNTHETIC EXPERIMENT result.
 */
import { cellToParent, getHexagonAreaAvg } from "h3-js";
import { decayTo, newUnit, unitProblems, type UnitState } from "@movenrun/shared/holding";
import type { PushEvent } from "@movenrun/shared/holdingLedger";
import { applyServerLedger, challengeKey, type ServerLedgerResult } from "../../../backend/src/gameplay/policy.ts";
import { DAY_MS, dayOf, lastClosedDay } from "../../../backend/src/gameplay/rules.ts";
import { LEGIT_COHORTS, type Participant, type Scenario, type Session } from "./population.ts";
import type { Variant } from "./variants.ts";

const H = 3_600_000;
const GROUP_COHORTS = new Set(["household", "cowalker", "club"]);

export interface RunOptions {
  /** Check invariants after every session (slower); violations are counted, never thrown. */
  audit?: boolean;
}

export interface CohortCounts {
  sessions: number;
  takeCapSessions: number;
  takeCapDenials: number;
  unitCapDenials: number;
  zeroGainSessions: number;
  unexplainedDenialSessions: number;
  challengeOnlySessions: number;
}

export interface RunResult {
  row: Record<string, number | string>;
  /** Take-cap and unit-cap denials of legit walkers by local start hour. */
  denialsByHour: { takeCap: number[]; unitCap: number[] };
  cohorts: Record<string, CohortCounts>;
  invariantViolations: string[];
}

function intensityOf(sessionsPerWeek: number): "low" | "mid" | "high" {
  return sessionsPerWeek < 2.5 ? "low" : sessionsPerWeek <= 6 ? "mid" : "high";
}

function unitsOf(s: Session, v: Variant): string[] {
  const path = s.gapped ? s.route.gapped : s.route.clean;
  let units: string[];
  if (v.unitSource === "res8-stored") {
    units = path.res8;
  } else {
    units = v.pushInterpolated ? path.res10 : path.res10.filter((_, i) => !path.interpolated[i]);
  }
  if (s.slice) units = units.slice(Math.floor(s.slice[0] * units.length), Math.floor(s.slice[1] * units.length));
  // 1001 consumes the stored cells in unit id order; 1002 the path in walk order.
  return v.unitSource === "res8-stored" ? [...new Set(units)].sort() : units;
}

export function gini(values: number[]): number {
  const xs = [...values].sort((a, b) => a - b);
  const n = xs.length;
  const sum = xs.reduce((a, b) => a + b, 0);
  if (n === 0 || sum === 0) return 0;
  let acc = 0;
  xs.forEach((x, i) => { acc += (2 * (i + 1) - n - 1) * x; });
  return acc / (n * sum);
}

/** Herfindahl–Hirschman index on a 0–10,000 scale. */
export function hhi(values: number[]): number {
  const sum = values.reduce((a, b) => a + b, 0);
  if (sum === 0) return 0;
  return values.reduce((a, x) => a + (x / sum) ** 2, 0) * 10_000;
}

export function runVariant(sc: Scenario, v: Variant, opts: RunOptions = {}): RunResult {
  const rules = v.rules;
  const tk = rules.takeover;
  const gap = tk.name === "two-day-challenge" && tk.policyVersion === 2 ? tk.secondPush.minElapsedMs : null;
  const budget = rules.takeBudget?.perWalkerPerDay ?? null;
  const res = v.unitSource === "res8-stored" ? 8 : 10;
  const area = getHexagonAreaAvg(res, "km2");
  const firstDay = sc.day0;
  const lastDay = sc.day0 + sc.spec.horizonDays - 1;
  const pById = new Map(sc.participants.map((p) => [p.id, p]));
  const isMal = (w: string | null) => (w ? pById.get(w)!.malicious : false);
  const violations: string[] = [];
  const violate = (m: string) => { if (violations.length < 50) violations.push(m); };

  const states = new Map<string, UnitState>();
  const opened = new Map<string, number>();
  const takes = new Map<string, number>();
  const unitsUsed = new Map<string, number>();
  const appliedSessions = new Set<string>();
  const hostileSeen = new Set<string>();
  /** When each walker's challenge on a unit first reached the server (measurement only, not a rule input). */
  const metricOpened = new Map<string, Map<string, number>>();

  // Counters.
  const c = {
    attackerFlips: 0, attackerFlipsFromLegit: 0, attackerClaims: 0, legitVsLegitFlips: 0, legitClaims: 0, straddleFlips: 0,
    jointSessions: 0, jointWalkFlips: 0, jointWalkErodes: 0, dayClosed: 0, staleDay: 0, otherRejected: 0, dailyLimitRefused: 0,
    takeCapDenialsLegit: 0, takeCapDenialsMal: 0, unitCapDenialsLegit: 0, unitCapDenialsMal: 0, d1Mismatch: 0, legitSessions: 0,
    zeroGain: 0, unexplained: 0, challengeOnly: 0, tooManyUnits: 0, retriesSkipped: 0,
  };
  const cohorts: Record<string, CohortCounts> = {};
  for (const k of LEGIT_COHORTS) cohorts[k] = { sessions: 0, takeCapSessions: 0, takeCapDenials: 0, unitCapDenials: 0, zeroGainSessions: 0, unexplainedDenialSessions: 0, challengeOnlySessions: 0 };
  const takeCapByHour = new Array(24).fill(0) as number[];
  const unitCapByHour = new Array(24).fill(0) as number[];
  const won = new Map<string, number>();
  const lost = new Map<string, number>();
  const empty = new Map<string, number>();
  const lostToday = new Map<string, number>();
  const failToday = new Set<string>();
  const contestedLegitUnits = new Set<string>();
  const everLegitHeld = new Set<string>();
  const firstClaim = new Map<string, number>();
  const heldDays = new Map<string, number>();
  const sessionsSoFar = new Map<string, number>();
  const inc = (m: Map<string, number>, k: string, by = 1) => m.set(k, (m.get(k) ?? 0) + by);

  // Day-end snapshots.
  let snapDay = firstDay;
  let prevHeld = new Map<string, number>();
  const survival = new Map(sc.participants.filter((p) => !p.malicious).map((p) => [p.id, 1]));
  let attackerHeldUnitDays = 0;
  let heldUnitDays = 0;
  let endHeld = new Map<string, number>();
  const joinerAt: Record<number, { held: number; n: number }> = { 1: { held: 0, n: 0 }, 7: { held: 0, n: 0 }, 30: { held: 0, n: 0 } };
  const seasonAttackerShare: number[][] = [[], []];

  const snapshot = (D: number) => {
    const held = new Map<string, number>();
    let total = 0;
    let mal = 0;
    for (const s of states.values()) {
      const st = s.asOfDay <= D ? decayTo(s, D, rules.holding) : s;
      if (st.holderId === null) continue;
      total++;
      inc(held, st.holderId);
      if (isMal(st.holderId)) mal++;
      else inc(heldDays, `${st.holderId}\u0000${st.unitId}`);
    }
    heldUnitDays += total;
    attackerHeldUnitDays += mal;
    const season = Math.floor((D - firstDay) / 90);
    if (season < 2 && total > 0) seasonAttackerShare[season]!.push(mal / total);
    for (const p of sc.participants) {
      if (p.malicious || D < firstDay + p.joinDay) continue;
      const before = prevHeld.get(p.id) ?? 0;
      const share = before > 0 ? Math.min(1, (lostToday.get(p.id) ?? 0) / before) : 0;
      const h = 0.004 * (1 + 3 * share) + (failToday.has(p.id) ? 0.005 : 0);
      survival.set(p.id, survival.get(p.id)! * (1 - h));
      const k = D - (firstDay + p.joinDay);
      if (p.joinDay > 0 && (k === 1 || k === 7 || k === 30) && (sessionsSoFar.get(p.id) ?? 0) > 0) {
        joinerAt[k]!.n++;
        if ((held.get(p.id) ?? 0) > 0) joinerAt[k]!.held++;
      }
    }
    lostToday.clear();
    failToday.clear();
    prevHeld = held;
    if (D === lastDay) endHeld = held;
  };
  const graceMs = rules.dayCloseGraceMs;
  const advanceTo = (receivedMs: number) => {
    while (snapDay <= lastDay && (snapDay + 1) * DAY_MS + graceMs <= receivedMs) snapshot(snapDay++);
  };

  for (const s of sc.sessions) {
    advanceTo(s.receivedMs);
    const p = pById.get(s.walker)!;
    const legit = !p.malicious;
    const day = dayOf(rules, s.endMs);
    if (day > lastDay) continue; // ends after the horizon
    if (legit && !s.retry) {
      c.legitSessions++;
      cohorts[p.cohort]!.sessions++;
      inc(sessionsSoFar, p.id);
      if (day !== s.localDay) c.d1Mismatch++;
      if (s.joint) c.jointSessions++;
    }
    const flag = { gain: false, unexplained: false, eroded: false, takeCap: false };
    const finishLegit = () => {
      if (!legit || s.retry) return;
      const cc = cohorts[p.cohort]!;
      if (!flag.gain) { c.zeroGain++; cc.zeroGainSessions++; }
      if (flag.unexplained) { c.unexplained++; cc.unexplainedDenialSessions++; failToday.add(p.id); }
      if (flag.eroded && !flag.gain) { c.challengeOnly++; cc.challengeOnlySessions++; }
      if (flag.takeCap) cc.takeCapSessions++;
    };
    // The service refuses a session whose day has closed (midnight plus grace).
    if (day <= lastClosedDay(rules, s.receivedMs)) {
      if (!s.retry) c.dayClosed += legit ? 1 : 0;
      flag.unexplained = true;
      finishLegit();
      continue;
    }
    const units = unitsOf(s, v);
    if (units.length > rules.maxUnitsPerSession) {
      c.tooManyUnits++;
      flag.unexplained = true;
      finishLegit();
      continue;
    }
    const events: PushEvent[] = units.map((u) => ({ eventId: `${s.id}:${u}`, unitId: u, walkerId: s.walker, day, push: { kind: "solid" } }));
    const sub = new Map<string, UnitState>();
    const subOpened = new Map<string, number>();
    for (const u of units) {
      sub.set(u, states.get(u) ?? newUnit(u, day));
      const key = challengeKey(u, s.walker);
      const o = opened.get(key);
      if (o !== undefined) subOpened.set(key, o);
    }
    const tKey = `${s.walker}|${day}`;
    const usedUnits = unitsUsed.get(tKey) ?? 0;
    const retryOfApplied = appliedSessions.has(s.id);
    const r: ServerLedgerResult = applyServerLedger({
      states: sub,
      events,
      holding: rules.holding,
      appliedEventIds: retryOfApplied ? events.map((e) => e.eventId) : [],
      takesUsed: new Map([[s.walker, takes.get(tKey) ?? 0]]),
      budget: rules.takeBudget,
      unitsRemaining: new Map([[s.walker, Math.max(0, v.unitBudget - usedUnits)]]),
      walkOrder: v.unitSource === "res10-path" ? new Map(events.map((e, i) => [e.eventId, i])) : undefined,
      secondPush: gap === null ? undefined : {
        minElapsedMs: gap, windowDays: (tk as { windowDays: number }).windowDays,
        eventReceivedMs: new Map(events.map((e) => [e.eventId, s.receivedMs])), challengeOpenedMs: subOpened,
      },
    });
    appliedSessions.add(s.id);
    for (const [u, st] of r.states) states.set(u, st);
    for (const [k, o] of r.challengeOpenedMs) opened.set(k, o);
    takes.set(tKey, r.takesUsed.get(s.walker) ?? takes.get(tKey) ?? 0);
    unitsUsed.set(tKey, usedUnits + (r.unitsUsed.get(s.walker) ?? 0));

    for (const res of r.results) {
      if (res.status === "skipped") { c.retriesSkipped++; flag.gain = true; continue; }
      if (res.status === "rejected") {
        if (res.reason === "unit_budget") {
          flag.unexplained = true;
          if (legit) { c.unitCapDenialsLegit++; cohorts[p.cohort]!.unitCapDenials++; unitCapByHour[s.localHour]!++; } else c.unitCapDenialsMal++;
        } else if (res.reason === "stale_day") { flag.unexplained = true; if (legit) c.staleDay++; } else { flag.unexplained = true; c.otherRejected++; }
      }
    }
    if (retryOfApplied) { finishLegit(); continue; }
    for (const e of r.entries) {
      const prev = e.previousHolderId;
      switch (e.outcome) {
        case "claimed":
          flag.gain = true;
          if (legit) { c.legitClaims++; inc(empty, s.walker); everLegitHeld.add(e.unitId); } else c.attackerClaims++;
          if (!firstClaim.has(`${s.walker}\u0000${e.unitId}`)) firstClaim.set(`${s.walker}\u0000${e.unitId}`, day);
          metricOpened.delete(e.unitId);
          break;
        case "reinforced":
          flag.gain = true;
          metricOpened.delete(e.unitId);
          break;
        case "flipped": {
          flag.gain = true;
          inc(won, s.walker);
          if (prev) { inc(lost, prev); inc(lostToday, prev); }
          if (!firstClaim.has(`${s.walker}\u0000${e.unitId}`)) firstClaim.set(`${s.walker}\u0000${e.unitId}`, day);
          if (legit) everLegitHeld.add(e.unitId);
          const openedAt = metricOpened.get(e.unitId)?.get(s.walker);
          if (openedAt !== undefined && s.receivedMs - openedAt < 20 * H) c.straddleFlips++;
          metricOpened.delete(e.unitId);
          if (!legit) { c.attackerFlips++; if (prev && !isMal(prev)) c.attackerFlipsFromLegit++; } else if (prev && !isMal(prev)) {
            c.legitVsLegitFlips++;
            contestedLegitUnits.add(e.unitId);
            if (s.joint && p.group && pById.get(prev)!.group === p.group) c.jointWalkFlips++;
          }
          break;
        }
        case "eroded": {
          flag.eroded = true;
          let m = metricOpened.get(e.unitId);
          if (!m) metricOpened.set(e.unitId, (m = new Map()));
          if (!m.has(s.walker)) m.set(s.walker, s.receivedMs);
          if (legit && prev && !isMal(prev)) {
            contestedLegitUnits.add(e.unitId);
            if (s.joint && p.group && pById.get(prev)!.group === p.group) c.jointWalkErodes++;
          }
          break;
        }
        case "refused_take_budget":
          flag.takeCap = true;
          flag.unexplained = true;
          if (legit) { c.takeCapDenialsLegit++; cohorts[p.cohort]!.takeCapDenials++; takeCapByHour[s.localHour]!++; } else c.takeCapDenialsMal++;
          break;
        case "refused_daily_limit":
          c.dailyLimitRefused++;
          break;
        default:
          break;
      }
      if (opts.audit && (e.outcome === "eroded" || e.outcome === "flipped")) {
        const k = `${e.unitId}|${e.walkerId}|${e.day}`;
        if (hostileSeen.has(k)) violate(`one-push rule: ${k}`);
        hostileSeen.add(k);
      }
    }
    if (opts.audit) {
      for (const st of r.states.values()) {
        const pr = unitProblems(st);
        if (pr.length) violate(`unitProblems ${st.unitId}: ${pr.join(", ")}`);
      }
      if (budget !== null && (takes.get(tKey) ?? 0) > budget) violate(`take budget exceeded ${tKey}`);
      if ((unitsUsed.get(tKey) ?? 0) > v.unitBudget) violate(`unit budget exceeded ${tKey}`);
    }
    finishLegit();
  }
  advanceTo(Number.POSITIVE_INFINITY);

  // ── end-of-run measurements ───────────────────────────────────────────
  const legitPs = sc.participants.filter((p) => !p.malicious);
  const malPs = sc.participants.filter((p) => p.malicious);
  const endTotal = [...endHeld.values()].reduce((a, b) => a + b, 0);
  const malEnd = malPs.reduce((a, p) => a + (endHeld.get(p.id) ?? 0), 0);
  const fracHolding = (ps: Participant[]) => (ps.length ? ps.filter((p) => (endHeld.get(p.id) ?? 0) > 0).length / ps.length : NaN);
  const casual = legitPs.filter((p) => p.cohort === "casual");
  const urban = legitPs.filter((p) => p.urban);
  const rural = legitPs.filter((p) => !p.urban);
  const days = sc.spec.horizonDays;

  // Districts: resolution 7 parents of held units at the end.
  const district = new Map<string, Map<string, number>>();
  for (const s of states.values()) {
    const st = s.asOfDay <= lastDay ? decayTo(s, lastDay, rules.holding) : s;
    if (st.holderId === null) continue;
    const d = cellToParent(st.unitId, 7);
    let m = district.get(d);
    if (!m) district.set(d, (m = new Map()));
    inc(m, st.holderId);
  }
  let dW = 0, dH = 0;
  for (const m of district.values()) {
    const vals = [...m.values()];
    const n = vals.reduce((a, b) => a + b, 0);
    dW += n;
    dH += hhi(vals) * n;
  }

  // Uptime: days held over days since first claim, for legit (walker, unit) pairs.
  const uptime = (filter: (p: Participant) => boolean) => {
    let sum = 0, n = 0;
    for (const [k, d0] of firstClaim) {
      const w = k.slice(0, k.indexOf("\u0000"));
      const p = pById.get(w)!;
      if (p.malicious || !filter(p)) continue;
      const span = lastDay - d0 + 1;
      if (span <= 0) continue;
      sum += Math.min(1, (heldDays.get(k) ?? 0) / span);
      n++;
    }
    return n ? sum / n : NaN;
  };

  // Won/lost/empty by intensity (sessions per week), per participant, km².
  const perWeek = new Map<string, number>();
  for (const s of sc.sessions) if (!s.retry) inc(perWeek, s.walker);
  const byInt: Record<string, { n: number; won: number; lost: number; empty: number }> = { low: { n: 0, won: 0, lost: 0, empty: 0 }, mid: { n: 0, won: 0, lost: 0, empty: 0 }, high: { n: 0, won: 0, lost: 0, empty: 0 } };
  for (const p of legitPs) {
    const active = Math.max(1, days - p.joinDay);
    const k = intensityOf(((perWeek.get(p.id) ?? 0) * 7) / active);
    byInt[k]!.n++;
    byInt[k]!.won += (won.get(p.id) ?? 0) * area;
    byInt[k]!.lost += (lost.get(p.id) ?? 0) * area;
    byInt[k]!.empty += (empty.get(p.id) ?? 0) * area;
  }
  const per = (k: string, f: "won" | "lost" | "empty") => (byInt[k]!.n ? byInt[k]![f] / byInt[k]!.n : NaN);

  // Abuse cost side: physical hours walked and devices used by malicious accounts.
  let malHours = 0, malRecordedHours = 0;
  for (const s of sc.sessions) {
    if (!pById.get(s.walker)!.malicious || s.retry) continue;
    const hrs = s.route.durationMs / H;
    malRecordedHours += hrs;
    if (s.physical) malHours += hrs;
  }
  const malDevices = new Set(malPs.map((p) => p.device)).size;
  const meanHeldPerDay = heldUnitDays / days;

  const group = (cohort: string) => legitPs.filter((p) => p.cohort === cohort);
  const meanEnd = (ps: Participant[]) => (ps.length ? ps.reduce((a, p) => a + (endHeld.get(p.id) ?? 0), 0) / ps.length : NaN);
  const legitSurvival = legitPs.map((p) => survival.get(p.id)!);
  const casualSurvival = casual.map((p) => survival.get(p.id)!);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  const ls = Math.max(1, c.legitSessions);

  const row: Record<string, number | string> = {
    variant: v.id,
    unitAreaKm2: area,
    // Attack.
    attackerFlipsPer100HeldPerDay: meanHeldPerDay > 0 ? (c.attackerFlips / days / meanHeldPerDay) * 100 : 0,
    attackerFlipsFromLegitPerDay: c.attackerFlipsFromLegit / days,
    attackerShareOfHeldEnd: endTotal ? malEnd / endTotal : 0,
    attackerClaimShareOfAcquired: c.attackerClaims + c.attackerFlips ? c.attackerClaims / (c.attackerClaims + c.attackerFlips) : NaN,
    attackerHeldKm2End: malEnd * area,
    attackerShareSeason1: mean(seasonAttackerShare[0]!),
    attackerShareSeason2: seasonAttackerShare[1]!.length ? mean(seasonAttackerShare[1]!) : NaN,
    straddleFlips: c.straddleFlips,
    abuseFlipsFromLegitPerPhysicalHour: malHours ? c.attackerFlipsFromLegit / malHours : NaN,
    abuseFlipsFromLegitPerRecordedHour: malRecordedHours ? c.attackerFlipsFromLegit / malRecordedHours : NaN,
    abuseFlipsFromLegitPerDevice: malDevices ? c.attackerFlipsFromLegit / malDevices : NaN,
    abuseHeldKm2DaysPerDevice: malDevices ? (attackerHeldUnitDays * area) / malDevices : NaN,
    abuseHeldKm2DaysPerPhysicalHour: malHours ? (attackerHeldUnitDays * area) / malHours : NaN,
    takeCapDenialsMalicious: c.takeCapDenialsMal,
    unitCapDenialsMalicious: c.unitCapDenialsMal,
    // Competition and contested ground.
    legitVsLegitFlipsPerDay: c.legitVsLegitFlips / days,
    contestedLegitShare: everLegitHeld.size ? contestedLegitUnits.size / everLegitHeld.size : 0,
    jointWalkFlipsPer100JointSessions: c.jointSessions ? (c.jointWalkFlips / c.jointSessions) * 100 : 0,
    jointWalkErodesPer100JointSessions: c.jointSessions ? (c.jointWalkErodes / c.jointSessions) * 100 : 0,
    // Holding.
    heldKm2End: endTotal * area,
    legitHoldingFracEnd: fracHolding(legitPs),
    casualHoldingFracEnd: fracHolding(casual),
    accessibilityHoldingFracEnd: fracHolding(group("accessibility")),
    householdHoldingFracEnd: fracHolding(group("household")),
    runnerHoldingFracEnd: fracHolding(group("runner")),
    urbanHoldingFracEnd: fracHolding(urban),
    ruralHoldingFracEnd: fracHolding(rural),
    ruralToUrbanHoldingRatio: fracHolding(urban) > 0 ? fracHolding(rural) / fracHolding(urban) : NaN,
    urbanMeanKm2End: meanEnd(urban) * area,
    ruralMeanKm2End: meanEnd(rural) * area,
    accessibilityMeanKm2End: meanEnd(group("accessibility")) * area,
    uptimeLegit: uptime(() => true),
    uptimeCasual: uptime((p) => p.cohort === "casual"),
    giniLegit: gini(legitPs.filter((p) => p.joinDay < days).map((p) => endHeld.get(p.id) ?? 0)),
    hhiAll: hhi([...endHeld.values()]),
    districtHhiWeighted: dW ? dH / dW : 0,
    newJoinerHolding1: joinerAt[1]!.n ? joinerAt[1]!.held / joinerAt[1]!.n : NaN,
    newJoinerHolding7: joinerAt[7]!.n ? joinerAt[7]!.held / joinerAt[7]!.n : NaN,
    newJoinerHolding30: joinerAt[30]!.n ? joinerAt[30]!.held / joinerAt[30]!.n : NaN,
    wonKm2PerLowIntensity: per("low", "won"), lostKm2PerLowIntensity: per("low", "lost"), emptyKm2PerLowIntensity: per("low", "empty"),
    wonKm2PerMidIntensity: per("mid", "won"), lostKm2PerMidIntensity: per("mid", "lost"), emptyKm2PerMidIntensity: per("mid", "empty"),
    wonKm2PerHighIntensity: per("high", "won"), lostKm2PerHighIntensity: per("high", "lost"), emptyKm2PerHighIntensity: per("high", "empty"),
    // Friction and failures (legit sessions).
    legitSessions: c.legitSessions,
    takeCapDenialsLegit: c.takeCapDenialsLegit,
    takeCapSessionRate: Object.values(cohorts).reduce((a, x) => a + x.takeCapSessions, 0) / ls,
    takeCapSessionRateRunner: cohorts.runner!.sessions ? cohorts.runner!.takeCapSessions / cohorts.runner!.sessions : NaN,
    unitCapDenialsLegit: c.unitCapDenialsLegit,
    zeroGainSessionRate: c.zeroGain / ls,
    unexplainedDenialSessionRate: c.unexplained / ls,
    challengeOnlySessionRate: c.challengeOnly / ls,
    dayClosedSessionRate: c.dayClosed / ls,
    staleDayRejectionsLegit: c.staleDay,
    dailyLimitRefusals: c.dailyLimitRefused,
    d1MismatchSessionRate: c.d1Mismatch / ls,
    retriesSkipped: c.retriesSkipped,
    otherRejected: c.otherRejected + c.tooManyUnits,
    // MODEL ASSUMPTION, kept apart from gameplay outcomes: never observed retention.
    model_survivalLegit: mean(legitSurvival),
    model_survivalCasual: mean(casualSurvival),
    invariantViolations: violations.length,
  };
  return { row, denialsByHour: { takeCap: takeCapByHour, unitCap: unitCapByHour }, cohorts, invariantViolations: violations };
}

/**
 * The illustrative review heuristic (manifest `assumptions.reviewHeuristic`):
 * not a server feature. Independent of the rule variant (it reads only the
 * sessions), so it is computed once per scenario.
 */
export function reviewFlags(sc: Scenario): Record<string, number> {
  const pById = new Map(sc.participants.map((p) => [p.id, p]));
  const flagged = new Map<string, "device" | "copresence">();
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const byDevice = new Map<string, Set<string>>();
  for (const s of sc.sessions) {
    let set = byDevice.get(s.device);
    if (!set) byDevice.set(s.device, (set = new Set()));
    set.add(s.walker);
  }
  for (const ws of byDevice.values()) {
    const xs = [...ws].sort();
    for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) flagged.set(pairKey(xs[i]!, xs[j]!), "device");
  }
  const byDay = new Map<number, Session[]>();
  for (const s of sc.sessions) {
    if (s.retry) continue;
    const d = Math.floor(s.startMs / DAY_MS);
    byDay.set(d, [...(byDay.get(d) ?? []), s]);
  }
  const copresent = new Map<string, Set<number>>();
  const unitSet = new Map<string, Set<string>>();
  const unitsOfS = (s: Session) => {
    let u = unitSet.get(s.id);
    if (!u) {
      const all = s.route.clean.res10;
      const sl = s.slice ? all.slice(Math.floor(s.slice[0] * all.length), Math.floor(s.slice[1] * all.length)) : all;
      unitSet.set(s.id, (u = new Set(sl)));
    }
    return u;
  };
  for (const [d, ss] of byDay) {
    ss.sort((a, b) => a.startMs - b.startMs);
    for (let i = 0; i < ss.length; i++) {
      for (let j = i + 1; j < ss.length && ss[j]!.startMs - ss[i]!.startMs <= 15 * 60_000; j++) {
        const a = ss[i]!, b = ss[j]!;
        if (a.walker === b.walker) continue;
        const ua = unitsOfS(a), ub = unitsOfS(b);
        let inter = 0;
        for (const u of ua) if (ub.has(u)) inter++;
        const jac = inter / Math.max(1, ua.size + ub.size - inter);
        if (jac >= 0.8) {
          const k = pairKey(a.walker, b.walker);
          let set = copresent.get(k);
          if (!set) copresent.set(k, (set = new Set()));
          set.add(d);
        }
      }
    }
  }
  for (const [k, ds] of copresent) {
    const xs = [...ds].sort((a, b) => a - b);
    for (let i = 0; i + 2 < xs.length; i++) if (xs[i + 2]! - xs[i]! <= 6) { if (!flagged.has(k)) flagged.set(k, "copresence"); break; }
  }
  let fp = 0, tp = 0, mixed = 0, fpDevice = 0, fpCopresence = 0, fpGroupCohort = 0;
  for (const [k, why] of flagged) {
    const [a, b] = k.split("|") as [string, string];
    const pa = pById.get(a)!, pb = pById.get(b)!;
    if (!pa.malicious && !pb.malicious) {
      fp++;
      if (why === "device") fpDevice++; else fpCopresence++;
      if (GROUP_COHORTS.has(pa.cohort) && pa.group === pb.group) fpGroupCohort++;
    } else if (pa.malicious && pb.malicious) tp++;
    else mixed++;
  }
  const malPairs = (() => {
    const groups = new Map<string, number>();
    for (const p of sc.participants) if (p.malicious && p.group) groups.set(p.group, (groups.get(p.group) ?? 0) + 1);
    return [...groups.values()].reduce((a, n) => a + (n * (n - 1)) / 2, 0);
  })();
  const scale = (1000 / sc.spec.population) * (30 / sc.spec.horizonDays);
  return {
    falsePositiveFlagsPer1000PerMonth: fp * scale,
    falsePositiveFlagsDevice: fpDevice,
    falsePositiveFlagsCopresence: fpCopresence,
    falsePositiveFlagsGroupMembers: fpGroupCohort,
    truePositiveFlags: tp,
    maliciousLinkedPairs: malPairs,
    mixedFlags: mixed,
    reviewStaffMinutesPer1000PerMonth: (fp + tp + mixed) * 15 * scale,
  };
}
