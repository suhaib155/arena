/**
 * The sealing engine: when a route closes, and which part of it closed.
 *
 * MovenRun's core mechanic in one sentence — **nothing about a route becomes
 * claimable ground until the route seals.** This module decides whether that
 * happened, deterministically, from route evidence alone.
 *
 * ## What it is not
 *
 * It is not territory. A seal event says a loop closed; it says nothing about
 * who holds the ground inside it, whether that ground is solid or shade, or
 * whether anything is owed for it. Those are later interpretations of this
 * output and none of them exists yet. Nothing here writes, reads or implies
 * ownership, and `seal === true` is never a synonym for `owned === true`.
 *
 * ## Three ways to seal
 *
 *  - **Come home** — finish within the rules version's radius of where the
 *    session started. Evaluated at Finish.
 *  - **Cut your own line** — a new stretch of route crosses an earlier one,
 *    closing the loop between them. Evaluated as the route grows, and the
 *    session carries on afterwards.
 *  - **Come to ground** — finish on a cell already held. Fully implemented as
 *    a domain method and fully tested, but it needs a *trusted* held-cell set
 *    that no authority produces yet: the app's zone list is local preview
 *    state that no server has agreed to. With no trusted context the method is
 *    reported **unavailable**, never false — see {@link SealMethodUnavailable}.
 *
 * ## Why one module for both sides
 *
 * The phone previews sealing so the player can understand the mechanic while
 * moving; the server recomputes it from verified evidence and that is the
 * authoritative answer. Two implementations that agree on the day they are
 * written are two implementations that diverge later, so there is one:
 * {@link evaluateSealing} feeds every point to {@link createSealScanner}, and
 * the phone's live preview feeds the same scanner one point at a time. The
 * batch path is the incremental path — a parity test asserts it rather than
 * trusting it.
 *
 * ## Privacy
 *
 * **A seal event contains no coordinates.** It carries point indices and
 * fractions along segments, which the holder of the route can turn back into a
 * position and nobody else can. That is enough for the territory work that
 * consumes this — a closed polygon is reconstructible exactly — and it means a
 * seal result can be returned, stored or logged without carrying location.
 */
import { cellForCoordinate, isValidCoordinate, type GeoCoordinate, type H3Cell } from "./h3";
import {
  haversineMeters,
  projector,
  segmentCrossing,
  RouteGeometryError,
  type PlanarPoint,
  type Projector,
} from "./geo";
import type { SessionMetadata, PauseInterval } from "./session";

/* ── methods ──────────────────────────────────────────────────────────────── */

/**
 * The ways a route can seal.
 *
 * Exactly the three the design describes, and no more. There is no rival trail
 * cut, no cooperative pincer, no administrative seal, no purchased seal and no
 * timeout seal: each of those is either a later mechanic with unsettled safety
 * questions or a thing the product has never said it wants, and a value here
 * would be one the server must reject and a reader would assume was supported.
 */
export const SEAL_METHODS = ["self_cross", "return_to_start", "finish_on_held_ground"] as const;

export type SealMethod = (typeof SEAL_METHODS)[number];

export function isSealMethod(value: unknown): value is SealMethod {
  return typeof value === "string" && (SEAL_METHODS as readonly string[]).includes(value);
}

/* ── rules ────────────────────────────────────────────────────────────────── */

/**
 * The sealing parameters one rules version fixes.
 *
 * Every number here is a **gameplay rule**, which is why none of them is an
 * environment variable, a remote config value or a build flag. A per-server
 * seal radius would mean two players following the same street get different
 * answers; the world grid already learned that lesson when a dormant
 * `H3_RESOLUTION` override was removed in the H3 foundation work.
 */
export interface SealingRules {
  rulesVersion: number;
  /**
   * Finish within this many metres of the session start to seal.
   *
   * **150 m is a HYPOTHESIS**, and the design says so explicitly: it is a
   * calibration parameter meant to be replaced by measurement, not a protocol
   * constant. It lives here so a future rules version can change it without
   * reinterpreting a single session captured under this one.
   */
  returnRadiusMeters: number;
  /**
   * Beyond this straight-line jump between consecutive fixes, the line between
   * them is not evidence and the route breaks.
   *
   * The tracker samples every 4 s or 5 m and refuses jumps implying more than
   * 12 m/s, so an ordinary accepted step is under about 50 metres. A jump far
   * past that means the route between the two fixes is unknown — a tunnel, a
   * backgrounded app, a cold restart — and the straight line across it is a
   * guess. Sealing never crosses one.
   */
  continuityBreakMeters: number;
}

const RULES_BY_VERSION: ReadonlyMap<number, SealingRules> = new Map([
  [1, { rulesVersion: 1, returnRadiusMeters: 150, continuityBreakMeters: 200 }],
]);

/**
 * The rules for a session's stamped version, or null if this build does not
 * know it.
 *
 * Null rather than a fallback to the newest: a session captured under rules
 * this build has never seen must not be scored under today's, and silently
 * treating an unknown version as current is exactly the bug the version stamp
 * exists to prevent. Callers fail closed on null.
 */
export function sealingRulesFor(rulesVersion: number): SealingRules | null {
  return RULES_BY_VERSION.get(rulesVersion) ?? null;
}

/* ── route input ──────────────────────────────────────────────────────────── */

/** One accepted route observation, as sealing needs it. */
export interface SealRoutePoint extends GeoCoordinate {
  /** The device observed an interruption before this fix. No bridging segment exists. */
  breakBefore?: boolean;
  timestamp: number;
}

/* ── events ───────────────────────────────────────────────────────────────── */

/**
 * How a sealed slice closes back on itself.
 *
 * Three shapes because the three methods close differently, and pretending
 * otherwise would hand the territory work a closure edge that does not exist.
 */
export type SealClosure =
  | {
      /**
       * The slice closes at a crossing point, reachable from either segment.
       * `priorFraction` along segment `priorSegment`, and `closingFraction`
       * along `closingSegment`, describe the same point.
       */
      kind: "crossing";
      priorSegment: number;
      priorFraction: number;
      closingSegment: number;
      closingFraction: number;
    }
  | {
      /** The slice closes by joining the last point back to the first. The two
       *  are within the rules version's radius but are not the same place. */
      kind: "endpoints";
    }
  | {
      /**
       * The method sealed, but which part of the route it encloses is an open
       * product question. Finishing on ground you already hold is a safe
       * harbour rather than a loop, and the design does not say what it
       * encloses. Recorded honestly rather than guessed.
       */
      kind: "undetermined";
    };

/**
 * One closure. Ordered, deterministic, and carrying no location.
 *
 * `startIndex`/`endIndex` are indices into the route that was evaluated, so the
 * holder of that route can rebuild the enclosed path exactly and nobody else
 * can rebuild anything.
 */
export interface SealEvent {
  /** Position in this evaluation's ordered event list, from 0. */
  sequence: number;
  method: SealMethod;
  /** First route point inside the sealed slice. */
  startIndex: number;
  /** Last route point inside the sealed slice. */
  endIndex: number;
  closure: SealClosure;
  /** True for a seal decided when the session ended, false for one that
   *  happened mid-session while the player carried on. */
  atFinish: boolean;
}

/** Why a method could not be evaluated. Distinct from evaluating it and
 *  finding no seal, which is an ordinary outcome and not a failure. */
export interface SealMethodUnavailable {
  method: SealMethod;
  reason:
    /** No trusted held-territory context exists. The authority that would
     *  supply one has not been built. */
    | "no_trusted_territory"
    /** The route reaches further from its own start than the local frame is
     *  trusted for, so segment geometry would be guesswork. */
    | "route_outside_local_frame"
    /** Too few usable points to have geometry at all. */
    | "insufficient_route";
}

/**
 * What the engine concluded about one route.
 *
 * `unsupported_rules` is a refusal, not an outcome: the session was stamped
 * with a version this build cannot interpret, so it produces no events rather
 * than events under the wrong rules. An **unsealed route is not an error** —
 * it is `evaluated` with an empty event list, and it remains a perfectly valid
 * movement session.
 */
export interface SealEvaluation {
  status: "evaluated" | "unsupported_rules";
  rulesVersion: number | null;
  events: readonly SealEvent[];
  /** Distinct methods that produced at least one event, in first-event order. */
  methods: readonly SealMethod[];
  unavailable: readonly SealMethodUnavailable[];
  /** How many continuous stretches the route was split into. One means the
   *  route was never interrupted. */
  subpathCount: number;
}

/** True when the route closed at least once. */
export function isSealed(evaluation: SealEvaluation): boolean {
  return evaluation.events.length > 0;
}

/* ── the incremental scanner ──────────────────────────────────────────────── */

/**
 * Grid cell size for the segment index, in metres.
 *
 * Sized against the route it indexes rather than picked round: an accepted step
 * is a few metres to a few tens of metres, so most segments fall inside one or
 * two cells and a query touches a handful. Small enough that a query is cheap,
 * large enough that a segment is not shredded across dozens of buckets.
 */
export const GRID_CELL_M = 64;

/**
 * Hard cap on indexed segments in one evaluation.
 *
 * At the tracker's 2 m minimum step this is well past a hundred kilometres of
 * movement, so no real session reaches it. It exists so a malformed or hostile
 * route cannot make the index grow without bound; past it the scanner stops
 * looking for crossings and says so, rather than degrading quietly.
 */
export const MAX_SCAN_SEGMENTS = 50_000;

interface Segment {
  /** Index of this segment's first route point. Its second is `start + 1`. */
  start: number;
  a: PlanarPoint;
  b: PlanarPoint;
}

/**
 * Feeds route points in, gets closures out.
 *
 * The live preview owns one of these for the duration of a session and drops it
 * when the session ends; the batch evaluator builds one, feeds it everything,
 * and throws it away. There is no module-level state, no cache that outlives a
 * scanner and nothing serialisable — a session's geometry cannot leak into the
 * next one because there is nowhere for it to live.
 */
export interface SealScanner {
  /** Transient index accounting, for bounded-work regression tests. No geometry. */
  readonly indexedReferences: number;
  /**
   * Extend the route by one accepted point.
   *
   * Returns the closures this point created — usually none, occasionally more
   * than one when a single long step cuts two earlier stretches. Events are
   * ordered along the incoming segment, so the order is a property of the
   * route rather than of iteration.
   */
  push(point: SealRoutePoint): readonly SealEvent[];
  /** Every self-cross closure so far, in order. */
  readonly events: readonly SealEvent[];
  /** Continuous stretches seen so far. */
  readonly subpathCount: number;
  /** Set when the route left the trusted local frame or outgrew the index.
   *  Self-cross stops being evaluated; nothing already emitted is withdrawn. */
  readonly unavailable: SealMethodUnavailable | null;
  /** Points accepted into the geometry so far. */
  readonly length: number;
}

/**
 * Build a scanner for one session.
 *
 * `pauses` come from the session's immutable provenance. They matter because a
 * pause is a stretch the app deliberately did not observe: the player may have
 * walked, driven or stood still, and the straight line from the last fix before
 * to the first fix after is not evidence of anything. The scanner breaks the
 * route there and never draws that line.
 *
 * A live caller supplies a getter for the current immutable pause array.
 * A finished caller supplies the final array. Both are read on every step.
 */
export type PauseSource = readonly PauseInterval[] | (() => readonly PauseInterval[]);

export function createSealScanner(rules: SealingRules, pauses: PauseSource = []): SealScanner {
  const segments: Segment[] = [];
  const grid = new Map<string, number[]>();
  const events: SealEvent[] = [];

  let frame: Projector | null = null;
  let previous: { point: SealRoutePoint; planar: PlanarPoint; index: number } | null = null;
  let index = -1;
  let subpathCount = 0;
  let unavailable: SealMethodUnavailable | null = null;
  /**
   * The first segment still eligible to be crossed.
   *
   * After a closure the loop behind it is banked, and the trail in front of the
   * crossing is the live one. Advancing past the closing segment is what stops
   * the same geometric closure from sealing again on the next sample — no
   * cooldown timer, no time-based state the replay cannot see, just a route
   * structure that cannot produce the same event twice.
   */
  let anchor = 0;

  function key(gx: number, gy: number): string {
    return `${gx},${gy}`;
  }

  function cellRange(a: PlanarPoint, b: PlanarPoint) {
    return {
      x0: Math.floor(Math.min(a.x, b.x) / GRID_CELL_M),
      x1: Math.floor(Math.max(a.x, b.x) / GRID_CELL_M),
      y0: Math.floor(Math.min(a.y, b.y) / GRID_CELL_M),
      y1: Math.floor(Math.max(a.y, b.y) / GRID_CELL_M),
    };
  }

  function insert(segmentIndex: number, a: PlanarPoint, b: PlanarPoint): void {
    const r = cellRange(a, b);
    for (let gx = r.x0; gx <= r.x1; gx++) {
      for (let gy = r.y0; gy <= r.y1; gy++) {
        const k = key(gx, gy);
        const bucket = grid.get(k);
        if (bucket) bucket.push(segmentIndex);
        else grid.set(k, [segmentIndex]);
      }
    }
  }

  function candidates(a: PlanarPoint, b: PlanarPoint): number[] {
    const r = cellRange(a, b);
    const seen = new Set<number>();
    for (let gx = r.x0; gx <= r.x1; gx++) {
      for (let gy = r.y0; gy <= r.y1; gy++) {
        const bucket = grid.get(key(gx, gy));
        if (!bucket) continue;
        for (const s of bucket) seen.add(s);
      }
    }
    /* Sorted so the candidate set is a function of the route and not of the
       grid's insertion order — the same route must always produce the same
       events in the same order. */
    return [...seen].sort((x, y) => x - y);
  }

  /**
   * Does a declared pause overlap the span between two fixes?
   *
   * Resolve the current immutable lifecycle list on every step. A retained
   * start-time array would miss pauses closed by later resume transitions.
   * A linear scan is right here: the submission schema caps a session at a
   * hundred pauses, and the alternative — a sorted copy — would have frozen the
   * list at the moment the scanner was built.
   */
  function pausedBetween(from: number, to: number): boolean {
    for (const pause of typeof pauses === "function" ? pauses() : pauses) {
      if (pause.startedAt < to && pause.endedAt > from) return true;
    }
    return false;
  }

  function push(point: SealRoutePoint): readonly SealEvent[] {
    /* Advanced for every point the caller pushes, valid or not, because an
       event's indices address the caller's route — a dropped point that
       silently shifted them would make a seal describe the wrong stretch. */
    index += 1;
    /* A point that is not a coordinate is not evidence. It is dropped and it
       breaks the route, because whatever happened between its neighbours is
       unknown — the same treatment a gap gets, for the same reason. */
    if (!isValidCoordinate(point) || !Number.isFinite(point.timestamp)) {
      previous = null;
      return [];
    }

    if (frame === null) {
      try {
        frame = projector(point);
      } catch (err) {
        if (!(err instanceof RouteGeometryError)) throw err;
        unavailable = { method: "self_cross", reason: "route_outside_local_frame" };
        return [];
      }
    }
    if (unavailable !== null) return [];

    let planar: PlanarPoint;
    try {
      planar = frame.project(point);
    } catch (err) {
      if (!(err instanceof RouteGeometryError)) throw err;
      unavailable = { method: "self_cross", reason: "route_outside_local_frame" };
      return [];
    }

    const prior = previous;
    previous = { point, planar, index };

    if (prior === null) {
      subpathCount += 1;
      return [];
    }
    /* Two reasons the line between these fixes is not evidence: the player
       deliberately paused, or the jump is too large for the sampling to have
       followed. Either way the segment is not created — not shortened, not
       flagged, simply absent, because a segment that was never observed must
       not be available to cross. */
    if (
      point.breakBefore === true ||
      pausedBetween(prior.point.timestamp, point.timestamp) ||
      haversineMeters(prior.point, point) > rules.continuityBreakMeters
    ) {
      subpathCount += 1;
      return [];
    }

    if (segments.length >= MAX_SCAN_SEGMENTS) {
      unavailable = { method: "self_cross", reason: "route_outside_local_frame" };
      return [];
    }

    const closing = segments.length;
    const seg: Segment = { start: prior.index, a: prior.planar, b: planar };

    const found: SealEvent[] = [];
    for (const j of candidates(seg.a, seg.b)) {
      if (j < anchor) continue;
      const other = segments[j]!;
      /* Segments meeting at a shared vertex are the route continuing, not the
         route crossing itself, and they are excluded by the vertex they share
         rather than by ignoring an arbitrary last N points.
         This is an early-out, not the rule. The rule is that a crossing must be
         strictly interior to both segments, which already rejects a shared
         endpoint — removing this line changes nothing but the number of
         `segmentCrossing` calls. It stays because it says what is meant, and
         because it becomes load-bearing the moment endpoint contact is ever
         allowed to seal. Both facts are asserted in the suite. */
      if (other.start + 1 === seg.start) continue;
      const crossing = segmentCrossing(other.a, other.b, seg.a, seg.b);
      if (!crossing) continue;
      found.push({
        sequence: 0,
        method: "self_cross",
        /* The loop runs from the fix after the crossed segment's start, round
           to the fix before the crossing closes it. */
        startIndex: other.start + 1,
        endIndex: seg.start,
        closure: {
          kind: "crossing",
          priorSegment: j,
          priorFraction: crossing.s,
          closingSegment: closing,
          closingFraction: crossing.t,
        },
        atFinish: false,
      });
    }

    segments.push(seg);
    insert(closing, seg.a, seg.b);

    if (found.length === 0) return [];
    /* One long step can cut two earlier stretches. They are emitted in the
       order the player crossed them — by position along the incoming segment —
       and each one advances the anchor, so a later crossing on the same step
       may no longer be eligible. */
    found.sort((x, y) => closingFractionOf(x) - closingFractionOf(y));
    const emitted: SealEvent[] = [];
    for (const candidate of found) {
      const closure = candidate.closure;
      if (closure.kind !== "crossing") continue;
      if (closure.priorSegment < anchor) continue;
      const event: SealEvent = { ...candidate, sequence: events.length };
      events.push(event);
      emitted.push(event);
      anchor = closing + 1;
    }
    // Every indexed segment now precedes the open-trail anchor. Keeping those
    // buckets would make repeated loops query thousands of ineligible segments.
    // Segment indices remain stable for events; only the dead search index goes.
    if (emitted.length > 0) grid.clear();
    return emitted;
  }

  return {
    push,
    get indexedReferences() {
      let references = 0;
      for (const bucket of grid.values()) references += bucket.length;
      return references;
    },
    get events() {
      return events;
    },
    get subpathCount() {
      return subpathCount;
    },
    get unavailable() {
      return unavailable;
    },
    get length() {
      return index + 1;
    },
  };
}

function closingFractionOf(event: SealEvent): number {
  return event.closure.kind === "crossing" ? event.closure.closingFraction : 0;
}

/* ── the whole-route evaluation ───────────────────────────────────────────── */

export interface SealInput {
  /** The session's immutable provenance. Supplies the rules version the route
   *  must be interpreted under, and the pauses that break it. */
  session: SessionMetadata;
  /** The accepted route, in time order. */
  points: readonly SealRoutePoint[];
  /**
   * Ground the player is *trusted* to hold, or null when no authority can say.
   *
   * Null is the production value today and will be until a server-authoritative
   * territory ledger exists. It is not "holds nothing" — it is "nobody who can
   * be believed has been asked", and the difference is why the method comes
   * back unavailable rather than false.
   */
  heldCells?: ReadonlySet<H3Cell> | null;
}

/**
 * Evaluate a finished route.
 *
 * Order of the returned events is a property of the route: self-cross closures
 * as they happened, then the two finish-time methods, return-to-start before
 * finish-on-held-ground. Nothing collapses them into a single winning method —
 * a session that cut its own line twice and then came home closed three times,
 * and later territory work needs all three slices, not the last one.
 */
export function evaluateSealing(input: SealInput): SealEvaluation {
  const rules = sealingRulesFor(input.session.rulesVersion);
  if (rules === null) {
    return {
      status: "unsupported_rules",
      rulesVersion: null,
      events: [],
      methods: [],
      unavailable: [],
      subpathCount: 0,
    };
  }

  const scanner = createSealScanner(rules, input.session.pauses);
  for (const point of input.points) scanner.push(point);

  const events: SealEvent[] = [...scanner.events];
  const unavailable: SealMethodUnavailable[] = [];
  if (scanner.unavailable) unavailable.push(scanner.unavailable);

  /* The endpoints the finish-time methods use are the first and last points
     that are actually coordinates, carried with their index in the caller's
     route so an event addresses the route it was given. */
  let firstAt = -1;
  let lastAt = -1;
  for (let i = 0; i < input.points.length; i++) {
    const p = input.points[i]!;
    if (!isValidCoordinate(p) || !Number.isFinite(p.timestamp)) continue;
    if (firstAt < 0) firstAt = i;
    lastAt = i;
  }
  const first = firstAt >= 0 ? input.points[firstAt]! : null;
  const last = lastAt >= 0 ? input.points[lastAt]! : null;

  if (!first || !last || firstAt === lastAt) {
    if (!scanner.unavailable) {
      unavailable.push({ method: "self_cross", reason: "insufficient_route" });
    }
    unavailable.push({ method: "return_to_start", reason: "insufficient_route" });
    unavailable.push({
      method: "finish_on_held_ground",
      reason: input.heldCells == null ? "no_trusted_territory" : "insufficient_route",
    });
    return finish(rules, events, unavailable, scanner.subpathCount);
  }

  /* Come home. Geodesic, because "within 150 metres of where you started" is a
     claim about the ground and a planar approximation of it would be a
     different rule wearing the same number. Inclusive at the boundary: the
     natural reading of "within 150 metres" includes 150. */
  if (haversineMeters(first, last) <= rules.returnRadiusMeters) {
    events.push({
      sequence: 0,
      method: "return_to_start",
      startIndex: firstAt,
      endIndex: lastAt,
      closure: { kind: "endpoints" },
      atFinish: true,
    });
  }

  /* Come to ground. */
  if (input.heldCells == null) {
    unavailable.push({ method: "finish_on_held_ground", reason: "no_trusted_territory" });
  } else {
    const cell = safeCell(last);
    if (cell !== null && input.heldCells.has(cell)) {
      events.push({
        sequence: 0,
        method: "finish_on_held_ground",
        startIndex: firstAt,
        endIndex: lastAt,
        closure: { kind: "undetermined" },
        atFinish: true,
      });
    }
  }

  return finish(rules, events, unavailable, scanner.subpathCount);
}

function finish(
  rules: SealingRules,
  events: SealEvent[],
  unavailable: SealMethodUnavailable[],
  subpathCount: number,
): SealEvaluation {
  const sequenced = events.map((event, sequence) => ({ ...event, sequence }));
  const methods: SealMethod[] = [];
  for (const event of sequenced) {
    if (!methods.includes(event.method)) methods.push(event.method);
  }
  return {
    status: "evaluated",
    rulesVersion: rules.rulesVersion,
    events: sequenced,
    methods,
    unavailable,
    subpathCount,
  };
}

/** The gameplay cell a coordinate falls in, or null if it has none. Never
 *  throws: a route that reaches here has already been validated, and a seal
 *  evaluation failing on one malformed fix would be the wrong failure. */
function safeCell(coordinate: GeoCoordinate): H3Cell | null {
  try {
    return cellForCoordinate(coordinate);
  } catch {
    return null;
  }
}
