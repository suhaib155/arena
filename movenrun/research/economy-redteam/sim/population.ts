/**
 * SYNTHETIC participants and their sessions.
 *
 * Behaviour is open-loop: who walks where and when depends only on the seed
 * and the scenario, never on the state of the game. That is what lets every
 * rule variant see byte-identical participants, routes and upload times. The
 * shares, rates and timings are behaviour ASSUMPTIONS (manifest
 * `assumptions`), not observations of real people.
 */
import { DAY_MS } from "../../../backend/src/gameplay/rules.ts";
import type { SessionPathRule } from "../../../backend/src/gameplay/path.ts";
import { between, intBetween, pick, stream, type Rnd } from "./prng.ts";
import { buildRoute, loopAround, makeWorld, pointInDisc, streetPath, type Density, type Route, type World, type XY } from "./world.ts";

const H = 3_600_000;
const MIN = 60_000;

export const LEGIT_COHORTS = [
  "commuter", "recreational", "casual", "enthusiast", "accessibility", "runner", "household", "cowalker", "club", "centre_lunch",
] as const;
export const MALICIOUS_KINDS = ["opportunist", "ring", "sybil", "replay", "spoofer"] as const;
export type LegitCohort = (typeof LEGIT_COHORTS)[number];
export type MaliciousKind = (typeof MALICIOUS_KINDS)[number];
export type Cohort = LegitCohort | MaliciousKind;

export interface Participant {
  id: string;
  cohort: Cohort;
  malicious: boolean;
  urban: boolean;
  home: XY;
  joinDay: number;
  /** Local clock offset in minutes before and after the DST-like switch. */
  offsetBefore: number;
  offsetAfter: number;
  device: string;
  /** Household, co-walking pair, club, ring or sybil group, if any. */
  group: string | null;
  nightOwl: boolean;
  speedMps: number;
  fixIntervalS: number;
}

export interface Session {
  /** Upload id: the idempotency key of the session's events. A retry repeats it. */
  id: string;
  walker: string;
  device: string;
  route: Route;
  gapped: boolean;
  /** Fractions [from, to) of the route's walk-order units to push (a ring or sybil splits one walk between accounts). Null: all. */
  slice: [number, number] | null;
  startMs: number;
  endMs: number;
  receivedMs: number;
  /** Local start hour of the walker's clock (0–23). */
  localHour: number;
  /** Walker's local calendar day of the session end. */
  localDay: number;
  /** Shared walk id for sessions walked together by different accounts. */
  joint: string | null;
  /** The walk physically happened (false for spoofed and replayed uploads). */
  physical: boolean;
  /** A repeat upload of a session already sent (same id). */
  retry: boolean;
}

export interface ScenarioSpec {
  seed: number;
  population: number;
  horizonDays: number;
  maliciousShare: number;
  density: Density;
  timingNoise: boolean;
}

export interface Manifest {
  geography: { origin: { latitude: number; longitude: number }; urbanShare: number; villages: number; cbdRadiusMeters: number; areaPerUrbanParticipantKm2: Record<Density, number> };
  clock: { simDay0: number };
  assumptions: {
    cohortSharesOfLegit: Record<LegitCohort, number>;
    newJoinerShareOfLegit: number;
    nightOwlShareOfLegit: number;
    maliciousMix: Record<MaliciousKind, number>;
    gpsGapSessionShare: number;
    sparseFixDeviceShare: number;
    householdSharedDeviceShare: number;
  };
}

export interface Scenario {
  spec: ScenarioSpec;
  world: World;
  participants: Participant[];
  sessions: Session[];
  day0: number;
  dstSwitchDay: number;
}

/** Largest-remainder split of n by shares, in the order given. */
export function allocate<K extends string>(n: number, shares: Record<K, number>, order: readonly K[]): Map<K, number> {
  const total = order.reduce((s, k) => s + shares[k], 0);
  const raw = order.map((k) => (n * shares[k]) / total);
  const out = new Map(order.map((k, i) => [k, Math.floor(raw[i]!)]));
  let left = n - [...out.values()].reduce((a, b) => a + b, 0);
  const byRem = order.map((k, i) => [k, raw[i]! - Math.floor(raw[i]!)] as const).sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0]));
  for (let i = 0; left > 0; i = (i + 1) % byRem.length, left--) out.set(byRem[i]![0], out.get(byRem[i]![0])! + 1);
  return out;
}

export function buildScenario(spec: ScenarioSpec, manifest: Manifest, pathRule: SessionPathRule): Scenario {
  const A = manifest.assumptions;
  const G = manifest.geography;
  const day0 = manifest.clock.simDay0;
  const nMal = Math.round(spec.population * spec.maliciousShare);
  const nLegit = spec.population - nMal;
  const nUrbanLegit = Math.round(nLegit * G.urbanShare);
  const world = makeWorld({
    origin: G.origin, urbanParticipants: nUrbanLegit + nMal, density: spec.density, areaPerUrbanParticipantKm2: G.areaPerUrbanParticipantKm2,
    villages: G.villages, cbdRadiusMeters: G.cbdRadiusMeters,
  }, stream(spec.seed, "world"));
  const pr = stream(spec.seed, "participants");
  const participants: Participant[] = [];
  const cbd: XY = [0, 0];

  const homeFor = (urban: boolean): XY => (urban ? pointInDisc(pr, cbd, world.urbanRadius) : pointInDisc(pr, pick(pr, world.villages), world.villageRadius));
  const base = (id: string, cohort: Cohort, malicious: boolean, urban: boolean, home: XY, group: string | null, device = `dev-${id}`): Participant => {
    const offsetBefore = pr() < 0.5 ? 0 : 60;
    return {
      id, cohort, malicious, urban, home, group, device, joinDay: 0, offsetBefore,
      // The DST-like switch moves the +60 clock to +0; the +0 clock is unchanged.
      offsetAfter: 0,
      nightOwl: false, speedMps: 1.35, fixIntervalS: pr() < A.sparseFixDeviceShare ? 25 : 10,
    };
  };

  // Legit cohorts; urban/rural is drawn per household so a household shares it.
  const counts = allocate(nLegit, A.cohortSharesOfLegit, LEGIT_COHORTS);
  let urbanLeft = nUrbanLegit;
  let legitLeft = nLegit;
  const drawUrban = () => {
    const u = pr() < urbanLeft / Math.max(1, legitLeft);
    return u;
  };
  let n = 0;
  for (const cohort of LEGIT_COHORTS) {
    let k = counts.get(cohort)!;
    while (k > 0) {
      const size = cohort === "household" ? Math.min(k, pr() < 0.6 ? 2 : 3) : cohort === "cowalker" ? Math.min(k, 2) : cohort === "club" ? Math.min(k, 8) : 1;
      const urban = cohort === "cowalker" || cohort === "club" || cohort === "centre_lunch" ? true : drawUrban();
      const group = size > 1 ? `${cohort}-g${n}` : null;
      const shared = cohort === "household" && pr() < A.householdSharedDeviceShare ? `dev-hh-${n}` : null;
      const home = homeFor(urban);
      for (let m = 0; m < size; m++) {
        const id = `p${String(n).padStart(4, "0")}`;
        const h = cohort === "household" ? home : m === 0 ? home : homeFor(urban);
        const p = base(id, cohort, false, urban, h, group, shared ?? `dev-${id}`);
        if (cohort === "accessibility") p.speedMps = 0.8;
        if (cohort === "runner") p.speedMps = 3.0;
        participants.push(p);
        if (urban) urbanLeft--;
        legitLeft--;
        n++;
      }
      k -= size;
    }
  }
  for (const p of participants) {
    p.nightOwl = pr() < A.nightOwlShareOfLegit;
    if (spec.horizonDays >= 7 && pr() < A.newJoinerShareOfLegit) p.joinDay = intBetween(pr, 1, spec.horizonDays - 1);
  }
  // Malicious participants: urban, joined from day 0.
  const mal = allocate(nMal, A.maliciousMix, MALICIOUS_KINDS);
  for (const kind of MALICIOUS_KINDS) {
    let k = mal.get(kind)!;
    while (k > 0) {
      const size = kind === "ring" ? Math.min(k, 4) : kind === "sybil" ? Math.min(k, 3) : 1;
      const group = size > 1 ? `${kind}-g${n}` : null;
      const device = kind === "sybil" ? `dev-sybil-${n}` : null;
      const home = homeFor(true);
      for (let m = 0; m < size; m++) {
        const id = `m${String(n).padStart(4, "0")}`;
        const p = base(id, kind, true, true, home, group, device ?? `dev-${id}`);
        p.fixIntervalS = 10;
        if (kind === "spoofer") p.speedMps = 3.0;
        participants.push(p);
        n++;
      }
      k -= size;
    }
  }

  const sessions = scheduleSessions(spec, manifest, world, participants, pathRule, day0);
  return { spec, world, participants, sessions, day0, dstSwitchDay: day0 + 20 };
}

function scheduleSessions(spec: ScenarioSpec, manifest: Manifest, world: World, ps: Participant[], rule: SessionPathRule, day0: number): Session[] {
  const A = manifest.assumptions;
  const origin = manifest.geography.origin;
  const out: Session[] = [];
  const routeCache = new Map<string, Route>();
  const route = (key: string, waypoints: XY[], speed: number, fix: number) => {
    const id = `${key}|${speed}|${fix}`;
    let r = routeCache.get(id);
    if (!r) {
      r = buildRoute(origin, { id, waypoints, speedMps: speed, fixIntervalS: fix }, rule, stream(spec.seed, `route:${id}`));
      routeCache.set(id, r);
    }
    return r;
  };
  const tr = stream(spec.seed, "timing");
  const cbd: XY = [0, 0];
  const legit = ps.filter((p) => !p.malicious);
  const byGroup = new Map<string, Participant[]>();
  for (const p of ps) if (p.group) byGroup.set(p.group, [...(byGroup.get(p.group) ?? []), p]);

  // Per-participant repertoires (fixed for the run).
  const rr = stream(spec.seed, "repertoire");
  const repertoire = new Map<string, XY[][]>();
  const work = new Map<string, XY>();
  const radius: Record<string, [number, number, number]> = {
    commuter: [300, 600, 2], recreational: [400, 700, 3], casual: [200, 400, 2], enthusiast: [500, 900, 4], accessibility: [120, 250, 2],
    runner: [1300, 2200, 3], household: [300, 600, 2], cowalker: [300, 500, 2], club: [250, 450, 2], centre_lunch: [250, 400, 2],
  };
  for (const p of legit) {
    const [lo, hi, k] = radius[p.cohort]!;
    const centre = p.cohort === "centre_lunch" ? pointInDisc(rr, cbd, manifest.geography.cbdRadiusMeters) : p.home;
    repertoire.set(p.id, Array.from({ length: k }, () => loopAround(rr, centre, between(rr, lo, hi))));
    if (p.cohort === "commuter") work.set(p.id, p.urban ? pointInDisc(rr, cbd, manifest.geography.cbdRadiusMeters) : pointInDisc(rr, p.home, 1500));
  }
  const groupLoops = new Map<string, XY[]>();
  for (const [g, members] of byGroup) {
    const c = members[0]!.cohort;
    if (c === "household") groupLoops.set(g, loopAround(rr, members[0]!.home, between(rr, 300, 600)));
    if (c === "cowalker") groupLoops.set(g, loopAround(rr, [(members[0]!.home[0] + members[1]!.home[0]) / 2, (members[0]!.home[1] + members[1]!.home[1]) / 2], between(rr, 350, 600)));
    if (c === "club") groupLoops.set(g, loopAround(rr, pointInDisc(rr, cbd, world.urbanRadius * 0.6), between(rr, 600, 900)));
  }

  const dstDay = day0 + 20;
  let seq = 0;
  const emit = (p: Participant, d: number, localStartH: number, r: Route, extra: Partial<Session> = {}) => {
    const day = day0 + d;
    const offset = day >= dstDay ? p.offsetAfter : p.offsetBefore;
    const startMs = day * 86_400_000 + localStartH * H - offset * MIN;
    const endMs = startMs + r.durationMs;
    const gapped = tr() < A.gpsGapSessionShare;
    let delay = between(tr, 0.5, 5) * MIN;
    if (spec.timingNoise) {
      const u = tr();
      if (u < 0.04) delay = between(tr, 2, 10) * H;
      else if (u < 0.14) delay = between(tr, 10, 90) * MIN;
    }
    const id = `s${String(seq++).padStart(7, "0")}`;
    const s: Session = {
      id, walker: p.id, device: p.device, route: r, gapped, slice: null, startMs, endMs, receivedMs: endMs + delay,
      localHour: Math.floor(((localStartH % 24) + 24) % 24), localDay: Math.floor((endMs + offset * MIN) / DAY_MS),
      joint: null, physical: true, retry: false, ...extra,
    };
    out.push(s);
    if (spec.timingNoise && !p.malicious) {
      const v = tr();
      if (v < 0.02) out.push({ ...s, receivedMs: s.receivedMs + between(tr, 1, 30) * MIN, retry: true });
      else if (v < 0.05) out.push({ ...s, id: `s${String(seq++).padStart(7, "0")}`, device: `${p.device}-b`, receivedMs: s.receivedMs + between(tr, 5, 60) * MIN });
    }
    return s;
  };
  const startHour = (p: Participant, lo: number, hi: number) => (p.nightOwl && tr() < 0.5 ? between(tr, 23, 23.9) : between(tr, lo, hi));

  // Attack targets: legit homes, rotated weekly.
  const legitHomes = legit.map((p) => p.home);
  const tourOf = (r: Rnd, from: XY, k: number): XY[] => {
    const pts = Array.from({ length: k }, () => (legitHomes.length ? pick(r, legitHomes) : pointInDisc(r, cbd, world.urbanRadius)));
    return [from, ...pts, from];
  };

  for (let d = 0; d < spec.horizonDays; d++) {
    const weekday = d % 7 < 5;
    // Groups walking together (one decision per group per day).
    for (const [g, members] of byGroup) {
      const c = members[0]!.cohort;
      if (c !== "household" && c !== "cowalker" && c !== "club") continue;
      const go = c === "household" ? tr() < 0.5 : c === "cowalker" ? tr() < 0.3 : d % 7 === 5 && tr() < 0.95;
      if (!go) continue;
      const h = c === "club" ? 9 : between(tr, 9, 19);
      const joint = `${g}:${d}`;
      for (const m of members) {
        if (d < m.joinDay) continue;
        if (members.length > 1 && tr() > (c === "club" ? 0.75 : 0.85)) continue;
        emit(m, d, h + between(tr, 0, 0.05), route(`grp:${g}`, groupLoops.get(g)!, Math.min(...members.map((x) => x.speedMps)), m.fixIntervalS), { joint });
      }
    }
    for (const p of legit) {
      if (d < p.joinDay) continue;
      const rep = repertoire.get(p.id)!;
      const loopRoute = (i: number) => route(`loop:${p.id}:${i}`, rep[i]!, p.speedMps, p.fixIntervalS);
      switch (p.cohort) {
        case "commuter": {
          if (weekday && tr() < 0.85) {
            const w = work.get(p.id)!;
            const path = streetPath(stream(spec.seed, `commute:${p.id}`), p.home, w);
            emit(p, d, between(tr, 7.5, 8.5), route(`commute:${p.id}`, path, p.speedMps, p.fixIntervalS));
            emit(p, d, startHour(p, 17, 18.5), route(`commuteback:${p.id}`, [...path].reverse(), p.speedMps, p.fixIntervalS));
          } else if (!weekday && tr() < 0.3) emit(p, d, between(tr, 9, 18), loopRoute(intBetween(tr, 0, rep.length - 1)));
          break;
        }
        case "recreational": if (tr() < 0.55) emit(p, d, startHour(p, 9, 19), loopRoute(intBetween(tr, 0, rep.length - 1))); break;
        case "casual": if (tr() < 0.35) emit(p, d, startHour(p, 8, 20), loopRoute(intBetween(tr, 0, rep.length - 1))); break;
        case "enthusiast": {
          if (tr() < 0.95) emit(p, d, between(tr, 6, 12), loopRoute(intBetween(tr, 0, rep.length - 1)));
          if (tr() < 0.3) emit(p, d, startHour(p, 15, 21), loopRoute(intBetween(tr, 0, rep.length - 1)));
          break;
        }
        case "accessibility": if (tr() < 0.55) emit(p, d, between(tr, 10, 16), loopRoute(intBetween(tr, 0, rep.length - 1))); break;
        case "runner": if (tr() < 0.7) emit(p, d, tr() < 0.5 ? between(tr, 6, 8) : startHour(p, 18, 20), loopRoute(intBetween(tr, 0, rep.length - 1))); break;
        case "household": case "cowalker": case "club":
          if (tr() < 0.2) emit(p, d, startHour(p, 8, 20), loopRoute(intBetween(tr, 0, rep.length - 1)));
          break;
        case "centre_lunch": if (weekday && tr() < 0.7) emit(p, d, between(tr, 12, 13), loopRoute(intBetween(tr, 0, rep.length - 1))); break;
      }
    }
    scheduleMalicious(spec, ps, byGroup, d, tr, emit, route, tourOf, legitHomes, world);
  }
  // Server receipt order; ties broken by id so the order is total.
  return out.sort((a, b) => a.receivedMs - b.receivedMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

type Emit = (p: Participant, d: number, h: number, r: Route, extra?: Partial<Session>) => Session;
type RouteFn = (key: string, waypoints: XY[], speed: number, fix: number) => Route;

function scheduleMalicious(
  spec: ScenarioSpec, ps: Participant[], byGroup: Map<string, Participant[]>, d: number, tr: Rnd, emit: Emit, route: RouteFn,
  tourOf: (r: Rnd, from: XY, k: number) => XY[], legitHomes: XY[], world: World,
) {
  const week = Math.floor(d / 7);
  for (const p of ps) {
    if (!p.malicious) continue;
    const wr = stream(spec.seed, `targets:${p.group ?? p.id}:${week}`);
    switch (p.cohort) {
      case "opportunist": case "replay": {
        // A daytime tour through 4–6 targets (same targets all week).
        const tour = tourOf(wr, p.home, intBetween(wr, 4, 6));
        const s = emit(p, d, between(tr, 10, 16), route(`tour:${p.id}:${week}`, tour, p.speedMps, p.fixIntervalS));
        if (p.cohort === "replay") {
          // The same upload again (skipped), a copy under a new id an hour later, and yesterday's walk resubmitted as today's.
          emit(p, d, 0, s.route, { ...pick1(s), id: `${s.id}`, receivedMs: s.receivedMs + 5 * MIN, retry: true });
          emit(p, d, 0, s.route, { ...pick1(s), id: `${s.id}-dup`, receivedMs: s.receivedMs + H, physical: false });
          if (d + 1 < spec.horizonDays) {
            const shift = DAY_MS;
            emit(p, d + 1, 0, s.route, { ...pick1(s), id: `${s.id}-replay`, startMs: s.startMs + shift, endMs: s.endMs + shift, receivedMs: s.receivedMs + shift, localDay: s.localDay + 1, physical: false });
          }
        }
        // Midnight straddle on one target for two nights, then a new target.
        if (p.cohort === "opportunist" && legitHomes.length) {
          const sr = stream(spec.seed, `straddle:${p.id}:${Math.floor(d / 2)}`);
          const r = route(`straddle:${p.id}:${Math.floor(d / 2)}`, loopAround(sr, pick(sr, legitHomes), 300), p.speedMps, p.fixIntervalS);
          emit(p, d, 23.35, r);
          if (d + 1 < spec.horizonDays) emit(p, d + 1, 0.05, r);
        }
        break;
      }
      case "ring": {
        // The ring walks one long tour each day at noon, each member pushing one quarter of it,
        // plus a midnight straddle (23:24, then 00:36 the next day) on even days.
        const members = byGroup.get(p.group!) ?? [p];
        const i = members.indexOf(p);
        const r = route(`ring:${p.group}:${week}`, tourOf(wr, members[0]!.home, 8), p.speedMps, p.fixIntervalS);
        const slice: [number, number] = [i / members.length, (i + 1) / members.length];
        emit(p, d, 12 + i * 0.01, r, { slice });
        if (d % 2 === 0) {
          const sr = stream(spec.seed, `ringstraddle:${p.group}:${d}`);
          const sl = route(`ringstraddle:${p.group}:${d}`, loopAround(sr, pick(sr, legitHomes.length ? legitHomes : [members[0]!.home]), 450), p.speedMps, p.fixIntervalS);
          const s2: [number, number] = [i / members.length, (i + 1) / members.length];
          emit(p, d, 23.4 + i * 0.01, sl, { slice: s2 });
          if (d + 1 < spec.horizonDays) emit(p, d + 1, 0.6 + i * 0.01, sl, { slice: s2 });
        }
        break;
      }
      case "sybil": {
        // One device, one physical walk, split between the linked accounts.
        const members = byGroup.get(p.group!) ?? [p];
        const i = members.indexOf(p);
        const r = route(`sybil:${p.group}:${week}`, tourOf(wr, members[0]!.home, 6), p.speedMps, p.fixIntervalS);
        const slice: [number, number] = [i / members.length, (i + 1) / members.length];
        emit(p, d, 12, r, { slice, physical: i === 0 });
        break;
      }
      case "spoofer": {
        // Fabricated long tours at running pace anywhere in the city, three a day, never walked.
        for (let k = 0; k < 3; k++) {
          const sr = stream(spec.seed, `spoof:${p.id}:${d}:${k}`);
          const r = route(`spoof:${p.id}:${d}:${k}`, tourOf(sr, pointInDisc(sr, [0, 0], world.urbanRadius), 7), p.speedMps, p.fixIntervalS);
          emit(p, d, [9, 15, 23.5][k]!, r, { physical: false });
        }
        break;
      }
    }
  }
}

function pick1(s: Session): Partial<Session> {
  return { startMs: s.startMs, endMs: s.endMs, localHour: s.localHour, localDay: s.localDay, gapped: s.gapped };
}
