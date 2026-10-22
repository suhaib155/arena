/**
 * The canonical synthetic route corpus.
 *
 * SYNTHETIC / NOT LIVE. Every fixture is a seeded description of a made-up
 * walker in the open-ocean synthetic frame (see frame.ts). None is a recording
 * and none may be presented as a real walk, a real user or a real place.
 *
 * Each fixture states what really happened (`truth`), what a correct product
 * must do (`expect`) and which privacy class its data would fall in if it were
 * real. Expectations describe the PRODUCT CONTRACT, not today's behaviour: a
 * fixture whose expectation the current code misses is a finding, recorded in
 * `knownDefect`, and its test is reported as TODO rather than PASS.
 */
import { SHAPES } from "./frame";
import type { Scenario } from "./scenario";

export type PrivacyClass =
  /** No coordinates leave the device and none are stored. */
  | "none"
  /** Precise route held in memory only for the session screen. */
  | "precise-ephemeral"
  /** Precise route uploaded for verification and kept server-side. */
  | "precise-uploaded"
  /** Precise route persisted on the device in the retry queue. */
  | "precise-device-persisted";

export type Category =
  | "stationary" | "walk" | "threshold" | "acquisition" | "signal" | "integrity" | "clock"
  | "lifecycle" | "upload" | "calendar" | "social";

export interface Expectation {
  start?: "started" | "permission_denied" | "services_off" | "acquisition_timeout" | "approximate_only";
  /** No movement XP may be banked. */
  noXp?: boolean;
  /** Movement XP must be banked on Save. */
  xp?: boolean;
  /** Client distance within this fraction of the truth distance captured. */
  distanceTolerance?: number;
  /** Absolute slack in metres added to the tolerance band. */
  distanceSlackM?: number;
  /** Client distance must never exceed truth by more than this many metres. */
  maxInflationM?: number;
  /** The phone must offer Save. */
  saveable?: boolean;
  /** Expected server verdict when submitted. */
  server?: "verified" | "rejected" | "not_submitted";
  /** Server distance within this fraction of the client distance. */
  serverAgreement?: number;
  sealed?: boolean;
  /** The summary must tell the player tracking was interrupted. */
  gapNotice?: boolean;
  /** The in-session chip must flip to degraded at least once. */
  signalDegrades?: boolean;
  lost?: boolean;
}

export interface RouteFixture {
  id: string;
  title: string;
  category: Category;
  scenario: Scenario;
  truth: string;
  expect: Expectation;
  privacy: PrivacyClass;
  /** When today's code does not meet `expect`, why — a finding, not a pass. */
  knownDefect?: string;
  /** Things this fixture cannot settle without a device or a hosted service. */
  missingEvidence?: string;
  /** Run a second synthetic walker this many metres north of the first. */
  companionOffsetM?: number;
}

const EPOCH = Date.UTC(2026, 9, 22, 9, 0, 0);
const base = (seed: number, over: Partial<Scenario>): Scenario => ({
  seed, epochMs: EPOCH, legs: [], accuracyM: 8, sigmaM: 3, events: [], ...over,
});
/** Warm-up: stand still while GPS acquires, as a player does at Start. */
const warm = { kind: "still" as const, seconds: 15 };

export const FIXTURES: readonly RouteFixture[] = [
  /* ── 1. stationary ─────────────────────────────────────────────────────── */
  {
    id: "S01-stationary-90s",
    title: "Phone on a bench for 90 seconds, normal jitter",
    category: "stationary",
    scenario: base(101, { legs: [{ kind: "still", seconds: 105 }], accuracyM: 10, sigmaM: 4 }),
    truth: "No movement at all.",
    expect: { start: "started", noXp: true, saveable: false, server: "not_submitted", maxInflationM: 5 },
    privacy: "precise-ephemeral",
  },
  {
    id: "S02-stationary-5min",
    title: "Phone on a bench for five minutes, normal jitter",
    category: "stationary",
    scenario: base(102, { legs: [{ kind: "still", seconds: 315 }], accuracyM: 10, sigmaM: 4 }),
    truth: "No movement at all; long enough to pass the five-minute Save rule.",
    expect: { start: "started", noXp: true, maxInflationM: 10 },
    privacy: "precise-ephemeral",
  },
  {
    id: "S03-stationary-5min-overconfident",
    title: "Five minutes still beside tall buildings: accuracy reported 6 m, real error drifts ~15 m",
    category: "stationary",
    scenario: base(103, { legs: [{ kind: "still", seconds: 315 }], accuracyM: 6, sigmaM: 15, errorCorrelation: 0.95 }),
    truth: "No movement. The phone is overconfident about its own accuracy (multipath).",
    expect: { start: "started", noXp: true, maxInflationM: 25 },
    privacy: "precise-ephemeral",
    knownDefect: "MR-A-04: a still phone whose reported accuracy is smaller than its real error accumulates phantom distance (measured 632 m, 53 XP, server verified). The anchor rule in inspectFix trusts the reported accuracy circles. Candidate P5 (60 s drift guard) only cut it to 456 m; open, needs device data.",
    missingEvidence: "How often real Android fused-location under-reports accuracy beside tall buildings needs device logs.",
  },

  /* ── 2. plausible walks ────────────────────────────────────────────────── */
  {
    id: "W01-walk-100m",
    title: "Short 100 m walk",
    category: "walk",
    scenario: base(201, { legs: [warm, { kind: "move", path: SHAPES.line(100), speedMps: 1.4 }, { kind: "still", seconds: 5 }] }),
    truth: "100 m on foot in about 70 s.",
    expect: { start: "started", distanceTolerance: 0.25, distanceSlackM: 20, saveable: false, server: "not_submitted", noXp: true },
    privacy: "precise-ephemeral",
  },
  {
    id: "W02-walk-300m",
    title: "Plausible 300 m walk, good sky view",
    category: "walk",
    scenario: base(202, { legs: [warm, { kind: "move", path: SHAPES.ell(200, 100), speedMps: 1.4 }, { kind: "still", seconds: 5 }] }),
    truth: "300 m on foot with one corner.",
    expect: { start: "started", distanceTolerance: 0.15, distanceSlackM: 20, saveable: true, xp: true, server: "verified", serverAgreement: 0.02 },
    privacy: "precise-uploaded",
  },
  {
    id: "W03-walk-750m-block",
    title: "750 m block loop that returns to its start",
    category: "walk",
    scenario: base(203, { legs: [warm, { kind: "move", path: SHAPES.block(225, 150), speedMps: 1.3 }, { kind: "still", seconds: 5 }] }),
    truth: "750 m loop on foot, ends where it started.",
    expect: { start: "started", distanceTolerance: 0.15, distanceSlackM: 25, saveable: true, xp: true, server: "verified", serverAgreement: 0.02, sealed: true },
    privacy: "precise-uploaded",
  },
  {
    id: "W04-walk-220m-urban-accuracy",
    title: "Honest 220 m walk with typical city accuracy (15 m)",
    category: "walk",
    scenario: base(204, { legs: [warm, { kind: "move", path: SHAPES.line(220), speedMps: 1.4 }, { kind: "still", seconds: 5 }], accuracyM: 15, sigmaM: 5 }),
    truth: "220 m on foot; just over the 200 m Save rule.",
    expect: { start: "started", saveable: true, xp: true, server: "verified" },
    privacy: "precise-uploaded",
    knownDefect: "MR-A-01: the server legacy anomaly MIN_POINTS = 10 (backend/src/services/gps.service.ts) rejects an honest saveable walk because the on-foot policy only keeps fixes that clear both accuracy circles (7 points for 220 m at 15 m accuracy). The player sees \"Needs review\". Candidate P1 fixes it.",
  },
  {
    id: "W05-figure-eight",
    title: "Figure-eight that crosses its own trail",
    category: "walk",
    scenario: base(205, { legs: [warm, { kind: "move", path: SHAPES.figureEight(120), speedMps: 1.4 }, { kind: "still", seconds: 5 }] }),
    truth: "About 580 m with one self-crossing and a return to start.",
    expect: { start: "started", saveable: true, xp: true, server: "verified", sealed: true, distanceTolerance: 0.15, distanceSlackM: 25 },
    privacy: "precise-uploaded",
  },
  {
    id: "W06-slow-stroll-150m-6min",
    title: "Slow 150 m stroll that takes six minutes (accessibility pace)",
    category: "walk",
    scenario: base(206, { legs: [warm, { kind: "move", path: SHAPES.line(150), speedMps: 0.42 }, { kind: "still", seconds: 5 }] }),
    truth: "150 m at 0.42 m/s (about 1.5 km/h).",
    expect: { start: "started", saveable: true, xp: true, server: "verified", distanceTolerance: 0.3, distanceSlackM: 25 },
    privacy: "precise-uploaded",
    knownDefect: "MR-A-01: slow walkers who qualify by the five-minute rule are rejected by the server MIN_POINTS = 10 floor (9 points). Candidate P1 fixes it.",
  },

  /* ── 3. thresholds, pause and stop ─────────────────────────────────────── */
  {
    id: "T01-v3-threshold-599s",
    title: "V3 source threshold boundary: 9 min 59 s at 1.25 m/s",
    category: "threshold",
    scenario: base(301, { legs: [warm, { kind: "move", path: SHAPES.line(749), speedMps: 1.25 }, { kind: "still", seconds: 5 }] }),
    truth: "Just under V3's 10 min / 750 m source intent. Play v1 has no 10-minute rule; this pins that no hidden one exists.",
    expect: { start: "started", saveable: true, xp: true, server: "verified" },
    privacy: "precise-uploaded",
  },
  {
    id: "T02-brief-pause-walked-across",
    title: "Pause, walk 80 m while paused, resume",
    category: "threshold",
    scenario: base(302, {
      legs: [warm, { kind: "move", path: SHAPES.line(150), speedMps: 1.4 },
        { kind: "move", path: SHAPES.line(80), speedMps: 1.4 }, { kind: "move", path: SHAPES.line(150), speedMps: 1.4 },
        { kind: "still", seconds: 5 }],
      events: [{ at: 15 + 107, type: "pause" }, { at: 15 + 107 + 57, type: "resume" }],
    }),
    truth: "300 m captured; 80 m walked while paused must not be bridged with a straight line.",
    expect: { start: "started", maxInflationM: 30, saveable: true, xp: true, server: "verified", serverAgreement: 0.02 },
    privacy: "precise-uploaded",
  },
  {
    id: "T03-legitimate-stop",
    title: "Walk, wait three minutes at a crossing without pressing Pause, walk on",
    category: "threshold",
    scenario: base(303, { legs: [warm, { kind: "move", path: SHAPES.line(150), speedMps: 1.4 }, { kind: "still", seconds: 180 },
      { kind: "move", path: SHAPES.line(150), speedMps: 1.4 }, { kind: "still", seconds: 5 }] }),
    truth: "300 m with a 3-minute standing stop. The stop must not add distance.",
    expect: { start: "started", distanceTolerance: 0.15, distanceSlackM: 25, saveable: true, xp: true, server: "verified" },
    privacy: "precise-uploaded",
  },

  /* ── 4. acquisition and permission ─────────────────────────────────────── */
  {
    id: "A01-delayed-acquisition",
    title: "GPS weak (35 m) for the first 20 s, then good",
    category: "acquisition",
    scenario: base(401, { legs: [{ kind: "still", seconds: 30 }, { kind: "move", path: SHAPES.line(300), speedMps: 1.4 }, { kind: "still", seconds: 5 }],
      disturbances: [{ from: 0, to: 20, type: "accuracy", accuracyM: 35, sigmaM: 12 }] }),
    truth: "Start waits for a usable fix, then 300 m on foot.",
    expect: { start: "started", saveable: true, xp: true, server: "verified" },
    privacy: "precise-uploaded",
  },
  {
    id: "A02-no-fixes",
    title: "No fixes at all (indoors / deep basement)",
    category: "acquisition",
    scenario: base(402, { legs: [{ kind: "still", seconds: 45 }], disturbances: [{ from: 0, to: 46, type: "noFixes" }] }),
    truth: "Nothing can be measured.",
    expect: { start: "acquisition_timeout", noXp: true },
    privacy: "none",
  },
  {
    id: "A03-permission-denied",
    title: "Location permission denied",
    category: "acquisition",
    scenario: base(403, { legs: [{ kind: "still", seconds: 10 }], permission: "denied" }),
    truth: "The player said no. The app must explain and offer Settings, never a blank screen.",
    expect: { start: "permission_denied", noXp: true },
    privacy: "none",
    missingEvidence: "The denial screen itself is UI; covered statically in SESSION_STATE_MACHINE.md, needs a device check.",
  },
  {
    id: "A04-approximate-only",
    title: "Approximate location only (Android 12+ 'approximate')",
    category: "acquisition",
    scenario: base(404, { legs: [{ kind: "still", seconds: 45 }], permission: "approximate", accuracyM: 1500, sigmaM: 400 }),
    truth: "Coarse fixes (~1.5 km) cannot measure a walk.",
    expect: { start: "acquisition_timeout", noXp: true },
    privacy: "none",
    missingEvidence: "Whether expo-location reports approximate as 'granted' and what the screen says needs a device.",
  },
  {
    id: "A05-services-off",
    title: "Location services switched off",
    category: "acquisition",
    scenario: base(405, { legs: [{ kind: "still", seconds: 5 }], servicesOff: true }),
    truth: "The player must be told to switch location on.",
    expect: { start: "services_off", noXp: true },
    privacy: "none",
  },

  /* ── 5. signal problems ────────────────────────────────────────────────── */
  {
    id: "G01-accuracy-spikes",
    title: "Accuracy spikes to 60 m three times during a 400 m walk",
    category: "signal",
    scenario: base(501, { legs: [warm, { kind: "move", path: SHAPES.line(400), speedMps: 1.4 }, { kind: "still", seconds: 5 }],
      disturbances: [60, 140, 220].map((from) => ({ from, to: from + 20, type: "accuracy" as const, accuracyM: 60, sigmaM: 25 })) }),
    truth: "400 m on foot; spikes must not add distance and the chip must say the signal is weak.",
    expect: { start: "started", maxInflationM: 40, signalDegrades: true, saveable: true, xp: true },
    privacy: "precise-uploaded",
    knownDefect: "MR-A-06: after an accuracy spike the reported accuracy recovers faster than the real error, adding about 10% (measured +40 m on 400 m). Moderate; no candidate yet.",
  },
  {
    id: "G02-unknown-accuracy",
    title: "Accuracy missing (null) for 30 s mid-walk",
    category: "signal",
    scenario: base(502, { legs: [warm, { kind: "move", path: SHAPES.line(350), speedMps: 1.4 }, { kind: "still", seconds: 5 }],
      disturbances: [{ from: 80, to: 110, type: "unknownAccuracy" }] }),
    truth: "350 m; fixes without accuracy are not evidence.",
    expect: { start: "started", maxInflationM: 30, saveable: true, xp: true, server: "verified" },
    privacy: "precise-uploaded",
  },
  {
    id: "G03-tracker-error",
    title: "Location provider drops out for 40 s mid-walk",
    category: "signal",
    scenario: base(503, { legs: [warm, { kind: "move", path: SHAPES.line(400), speedMps: 1.4 }, { kind: "still", seconds: 5 }],
      disturbances: [{ from: 100, to: 140, type: "noFixes" }], events: [{ at: 100, type: "trackerError" }] }),
    truth: "400 m; about 56 m walked during the dropout must not be bridged.",
    expect: { start: "started", maxInflationM: 25, gapNotice: true, signalDegrades: true, saveable: true, xp: true, server: "verified" },
    privacy: "precise-uploaded",
  },

  /* ── 6. integrity ──────────────────────────────────────────────────────── */
  {
    id: "I01-teleport",
    title: "Reported position jumps 500 m for 8 s, then returns",
    category: "integrity",
    scenario: base(601, { legs: [warm, { kind: "move", path: SHAPES.line(300), speedMps: 1.4 }, { kind: "still", seconds: 5 }],
      disturbances: [{ from: 90, to: 98, type: "teleport", eastM: 500, northM: 0 }] }),
    truth: "300 m on foot; the jump is not movement.",
    expect: { start: "started", maxInflationM: 30, saveable: true, xp: true, server: "verified" },
    privacy: "precise-uploaded",
  },
  {
    id: "I02-vehicle-speed",
    title: "Two minutes at 15 m/s (a car or bus) inside a walk",
    category: "integrity",
    scenario: base(602, { legs: [warm, { kind: "move", path: SHAPES.line(150), speedMps: 1.4 },
      { kind: "move", path: SHAPES.line(1800), speedMps: 15, onFoot: false }, { kind: "move", path: SHAPES.line(150), speedMps: 1.4 }, { kind: "still", seconds: 5 }],
      disturbances: [{ from: 15 + 107, to: 15 + 107 + 120, type: "nativeSpeed", mps: 15 }] }),
    truth: "300 m on foot plus 1.8 km in a vehicle. The vehicle leg must not count.",
    expect: { start: "started", maxInflationM: 60, saveable: true },
    privacy: "precise-uploaded",
    knownDefect: "MR-A-02: inspectFix keeps its anchor through speed rejections, so once the walker slows the whole vehicle leg is accepted as one straight segment (measured 2,103 m for 299 m on foot, 144 XP, server verified). Candidate P2 fixes it (287 m).",
    missingEvidence: "Whether the phone's native speed field is populated on real Android fused updates needs device logs.",
  },
  {
    id: "I04-slow-vehicle-under-cap",
    title: "Three minutes in slow traffic at 10 m/s (36 km/h, under the 43 km/h cap)",
    category: "integrity",
    scenario: base(604, { legs: [warm, { kind: "move", path: SHAPES.line(100), speedMps: 1.4 },
      { kind: "move", path: SHAPES.line(1800), speedMps: 10, onFoot: false }, { kind: "move", path: SHAPES.line(100), speedMps: 1.4 }, { kind: "still", seconds: 5 }] }),
    truth: "200 m on foot plus 1.8 km in a vehicle below the speed cap.",
    expect: { start: "started", maxInflationM: 60, saveable: true },
    privacy: "precise-uploaded",
    knownDefect: "MR-A-07 (known limit): movement below the 12 m/s cap is indistinguishable from fast running without activity data. Not a v1 fix target; copy must not call distance \"on foot verified\".",
    missingEvidence: "Telling a slow vehicle or a bicycle from a fast runner needs signals the app does not collect (activity recognition, cadence). Recorded as a known limit, not a fix target for v1.",
  },
  {
    id: "I03-overlap-cowalk",
    title: "Family co-walk: a second synthetic walker 2 m to the side on the same 300 m",
    category: "social",
    scenario: base(603, { legs: [warm, { kind: "move", path: SHAPES.ell(200, 100), speedMps: 1.4 }, { kind: "still", seconds: 5 }] }),
    truth: "Two honest walkers on nearly the same line. Research only: near-identical routes are expected and are NOT evidence of fraud.",
    expect: { start: "started", saveable: true, xp: true, server: "verified" },
    privacy: "precise-uploaded",
    companionOffsetM: 2,
  },

  /* ── 7. clocks ─────────────────────────────────────────────────────────── */
  {
    id: "C01-clock-rollback",
    title: "System clock set back one hour mid-walk",
    category: "clock",
    scenario: base(701, { legs: [warm, { kind: "move", path: SHAPES.line(500), speedMps: 1.4 }, { kind: "still", seconds: 5 }],
      disturbances: [{ from: 150, to: 10_000, type: "systemClock", offsetMs: -3_600_000 }] }),
    truth: "500 m on foot. GNSS time is right; the phone's own clock is wrong.",
    expect: { start: "started", maxInflationM: 30, signalDegrades: true },
    privacy: "precise-uploaded",
    knownDefect: "MR-A-05: with the phone clock behind GNSS time every fix is rejected as future_fix, which does not degrade the signal chip; the chip keeps saying usable while distance stops (measured 200 s silent). Candidate P4 fixes it.",
  },
  {
    id: "C02-clock-fast-forward",
    title: "System clock moved forward one hour mid-walk",
    category: "clock",
    scenario: base(702, { legs: [warm, { kind: "move", path: SHAPES.line(150), speedMps: 1.4 }, { kind: "still", seconds: 5 }],
      disturbances: [{ from: 80, to: 10_000, type: "systemClock", offsetMs: 3_600_000 }] }),
    truth: "150 m in under two minutes. Not a five-minute session and not 200 m.",
    expect: { start: "started", saveable: false, noXp: true, signalDegrades: true },
    privacy: "precise-ephemeral",
    knownDefect: "MR-A-03: Save and XP duration come from the wall clock, so moving the clock forward one hour turns an 82 m, two-minute walk into a saveable session worth 191 local XP. Candidate P3 fixes it.",
  },

  /* ── 8. lifecycle ──────────────────────────────────────────────────────── */
  {
    id: "L01-background-mid-walk",
    title: "App backgrounded for two minutes mid-walk (foreground-only tracking)",
    category: "lifecycle",
    scenario: base(801, { legs: [warm, { kind: "move", path: SHAPES.line(500), speedMps: 1.4 }, { kind: "still", seconds: 5 }],
      events: [{ at: 120, type: "background" }, { at: 240, type: "foreground" }] }),
    truth: "500 m walked; about 168 m walked while backgrounded is unobserved and must be shown as a gap, never bridged.",
    expect: { start: "started", maxInflationM: 25, gapNotice: true, saveable: true, xp: true, server: "verified" },
    privacy: "precise-uploaded",
  },
  {
    id: "L02-process-kill",
    title: "Process killed by the OS mid-walk",
    category: "lifecycle",
    scenario: base(802, { legs: [warm, { kind: "move", path: SHAPES.line(400), speedMps: 1.4 }],
      events: [{ at: 200, type: "processKill" }] }),
    truth: "The in-memory session is gone. Nothing may be invented or awarded on relaunch.",
    expect: { lost: true, noXp: true },
    privacy: "none",
    missingEvidence: "What the relaunch screen shows after a kill needs a device; there is no resume path in v1 (hasRecoverableMovement is false).",
  },
  {
    id: "L03-finish-while-paused",
    title: "Pause, then Finish without resuming",
    category: "lifecycle",
    scenario: base(803, { legs: [warm, { kind: "move", path: SHAPES.line(300), speedMps: 1.4 }, { kind: "still", seconds: 60 }],
      events: [{ at: 15 + 215, type: "pause" }, { at: 15 + 215 + 40, type: "finish" }] }),
    truth: "300 m, then paused, then finished. The open pause closes at finish.",
    expect: { start: "started", saveable: true, xp: true, server: "verified" },
    privacy: "precise-uploaded",
  },

  /* ── 9. calendar ───────────────────────────────────────────────────────── */
  {
    id: "D01-across-utc-midnight",
    title: "Walk that crosses 00:00 UTC",
    category: "calendar",
    scenario: { ...base(901, { legs: [warm, { kind: "move", path: SHAPES.line(400), speedMps: 1.4 }, { kind: "still", seconds: 5 }] }),
      epochMs: Date.UTC(2026, 9, 22, 23, 58, 0) },
    truth: "400 m starting at 23:58 UTC. Verification must not depend on which day it is.",
    expect: { start: "started", saveable: true, xp: true, server: "verified" },
    privacy: "precise-uploaded",
    missingEvidence: "Which local day XP lands on depends on the device time zone at Save (getLocalDateKey); measured in the state-machine harness.",
  },
];

export function fixtureById(id: string): RouteFixture {
  const f = FIXTURES.find((x) => x.id === id);
  if (!f) throw new Error(`unknown fixture ${id}`);
  return f;
}
