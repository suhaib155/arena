/**
 * Sealing on the phone.
 *
 * Two claims are worth more than all the rest here, and both are about what the
 * app must NOT do. The preview must not be a second implementation of the
 * geometry — the server's answer and the player's must come from one module, or
 * they will drift and the player will be told they closed a loop the server
 * never saw. And an unsealed route must not quietly claim ground, which is what
 * the app did before this change and is the exact thing the mechanic forbids.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SESSION_RULES_VERSION, type PauseInterval, type SessionMetadata } from "@movenrun/shared/session";
import { evaluateSealing } from "@movenrun/shared/sealing";

import {
  EMPTY_PREVIEW,
  UNSEALED,
  createSealPreview,
  finishedSealLabel,
  sealFinishedRoute,
  sealPreviewAnnouncement,
  sealPreviewLabel,
} from "../sealPreview";
import type { TrackPoint } from "../geo";

const MOBILE = process.cwd();
const SRC = join(MOBILE, "src");
const APP = join(MOBILE, "app");
const read = (p: string) => readFileSync(p, "utf8");
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");

const ORIGIN = { latitude: 12.9716, longitude: 77.5946 };
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((ORIGIN.latitude * Math.PI) / 180);
const T0 = 1_756_000_000_000;

function route(offsets: readonly (readonly [number, number])[]): TrackPoint[] {
  return offsets.map(([e, n], i) => ({
    latitude: ORIGIN.latitude + n / M_PER_DEG_LAT,
    longitude: ORIGIN.longitude + e / M_PER_DEG_LON,
    timestamp: T0 + i * 10_000,
    accuracy: 8,
  }));
}

function session(over: Partial<SessionMetadata> = {}): SessionMetadata {
  return {
    mode: "onFoot",
    rulesVersion: SESSION_RULES_VERSION,
    startedAt: T0 - 1_000,
    finishedAt: T0 + 600_000,
    pauses: [],
    ...over,
  };
}

/** Up, round, and back across the line you came up. */
const LASSO = [
  [0, 0],
  [0, 60],
  [60, 60],
  [60, 30],
  [-30, 30],
] as const;

/** Straight out and never back. */
const OPEN = [
  [0, 0],
  [180, 0],
  [360, 0],
  [540, 0],
] as const;

/** Out and home again, without ever cutting the trail. */
const THERE_AND_BACK = [
  [0, 0],
  [0, 400],
  [300, 400],
  [300, 40],
  [40, 40],
] as const;

/* ── one algorithm, two callers ───────────────────────────────────────────── */

test("the live preview and the whole-route evaluation agree, point for point", () => {
  /* If these ever diverge, a player watches a loop close that the server never
     sees. They agree because there is one implementation, not two that were
     checked against each other once. */
  for (const shape of [LASSO, OPEN, THERE_AND_BACK]) {
    const points = route(shape as readonly (readonly [number, number])[]);
    const tracker = createSealPreview(SESSION_RULES_VERSION, [])!;
    let closures = 0;
    for (const p of points) if (tracker.push(p)) closures += 1;

    const authoritative = evaluateSealing({ session: session(), points });
    const crossings = authoritative.events.filter((e) => e.method === "self_cross").length;
    assert.equal(closures, crossings, `preview and authority disagree on ${JSON.stringify(shape)}`);
    assert.equal(tracker.preview.sealedLoops, crossings);
  }
});

test("a pause breaks the preview exactly where it breaks the verified route", () => {
  const points = route(LASSO);
  const pauses: PauseInterval[] = [
    { startedAt: points[3]!.timestamp + 1_000, endedAt: points[4]!.timestamp - 1_000 },
  ];
  const tracker = createSealPreview(SESSION_RULES_VERSION, pauses)!;
  let closures = 0;
  for (const p of points) if (tracker.push(p)) closures += 1;
  assert.equal(closures, 0, "the preview drew a line across a pause");

  const authoritative = evaluateSealing({ session: session({ pauses }), points });
  assert.equal(authoritative.events.filter((e) => e.method === "self_cross").length, 0);
});

test("the preview reads the live pause list, so a pause mid-session still breaks it", () => {
  /* The lifecycle appends a pause while the session runs. The preview was built
     before that pause existed and must still honour it — a scanner holding a
     snapshot would keep drawing lines across a gap the player had declared. */
  const points = route(LASSO);
  const pauses: PauseInterval[] = [];
  const tracker = createSealPreview(SESSION_RULES_VERSION, pauses)!;
  let closures = 0;
  points.forEach((p, i) => {
    if (i === 4) {
      pauses.push({ startedAt: points[3]!.timestamp + 1_000, endedAt: p.timestamp - 1_000 });
    }
    if (tracker.push(p)) closures += 1;
  });
  assert.equal(closures, 0, "a pause added mid-session did not break the preview");
});

test("an unknown rules version gives no preview at all, rather than a guess", () => {
  assert.equal(createSealPreview(999, []), null);
  assert.equal(createSealPreview(0, []), null);
  assert.equal(createSealPreview(-1, []), null);
});

/* ── coming home ──────────────────────────────────────────────────────────── */

test("the near-start hint only appears once the player has actually left", () => {
  /* Standing on the start line is not coming home. Without this the app would
     open every session by telling the player they were already there. */
  const tracker = createSealPreview(SESSION_RULES_VERSION, [])!;
  const away = route([[0, 0], [20, 0], [60, 0]]);
  for (const p of away) tracker.push(p);
  assert.equal(tracker.preview.nearStart, false, "never left, yet reported near start");

  for (const p of route([[900, 0], [1000, 0]])) tracker.push(p);
  assert.equal(tracker.preview.nearStart, false);

  tracker.push(route([[40, 0]])[0]!);
  assert.equal(tracker.preview.nearStart, true, "came back and was not told");
});

/* ── the words the player sees ────────────────────────────────────────────── */

test("every live label describes the route, never territory or reward", () => {
  const labels = [
    sealPreviewLabel(EMPTY_PREVIEW),
    sealPreviewLabel({ sealedLoops: 0, nearStart: true }),
    sealPreviewLabel({ sealedLoops: 1, nearStart: false }),
    sealPreviewLabel({ sealedLoops: 3, nearStart: true }),
    finishedSealLabel(null),
    finishedSealLabel(UNSEALED),
    finishedSealLabel({ sealed: true, loops: 2, cameHome: true }),
  ];
  assert.deepEqual(labels, [
    "Open route",
    "Finish here to seal",
    "1 loop sealed",
    "3 loops sealed · finish here to seal",
    "Route not evaluated",
    "Open route — this one stayed open",
    "2 loops sealed · finished near your start",
  ]);

  const joined = labels.join(" ").toLowerCase();
  for (const forbidden of [
    "captur", "owned", "own ", "claim", "solid", "shade", "deed", "earned",
    "reward", "token", "xp", "credits", "yield", "toll", "strength",
  ]) {
    assert.ok(!joined.includes(forbidden), `a live label claims "${forbidden.trim()}"`);
  }
  /* And no urgency: nobody should be crossing a road to close a loop. */
  for (const pressure of ["hurry", "quick", "now!", "don't lose", "expires", "failed", "missed"]) {
    assert.ok(!joined.includes(pressure), `a live label pressures the player: ${pressure}`);
  }
});

test("a screen reader hears a closure once, not on every fix", () => {
  const open = { sealedLoops: 0, nearStart: false };
  const sealed = { sealedLoops: 1, nearStart: false };
  assert.equal(sealPreviewAnnouncement(open, sealed), "Loop sealed");
  assert.equal(sealPreviewAnnouncement(sealed, sealed), null, "it repeated itself");
  assert.equal(sealPreviewAnnouncement(sealed, { sealedLoops: 2, nearStart: false }), "2 loops sealed");
  assert.equal(sealPreviewAnnouncement(open, { sealedLoops: 0, nearStart: true }), "Back near your start");
  assert.equal(
    sealPreviewAnnouncement({ sealedLoops: 0, nearStart: true }, { sealedLoops: 0, nearStart: true }),
    null,
  );
});

/* ── the finished route ───────────────────────────────────────────────────── */

test("a finished route reports what it did, and null when it cannot be read", () => {
  const lasso = sealFinishedRoute({ points: route(LASSO), session: session() })!;
  assert.deepEqual(lasso, { sealed: true, loops: 1, cameHome: true });

  const open = sealFinishedRoute({ points: route(OPEN), session: session() })!;
  assert.deepEqual(open, { sealed: false, loops: 0, cameHome: false });

  const home = sealFinishedRoute({ points: route(THERE_AND_BACK), session: session() })!;
  assert.deepEqual(home, { sealed: true, loops: 0, cameHome: true });

  /* Null is "unknown", and unknown must never read as permission. */
  assert.equal(sealFinishedRoute({ points: route(LASSO) }), null);
  assert.equal(
    sealFinishedRoute({ points: route(LASSO), session: session({ rulesVersion: 42 }) }),
    null,
  );
});

test("the finished result carries no coordinate and no route slice", () => {
  const seal = sealFinishedRoute({ points: route(LASSO), session: session() });
  const serialized = JSON.stringify(seal);
  for (const fragment of ["12.97", "77.59", "latitude", "longitude", "Index", "closure", "fraction"]) {
    assert.ok(!serialized.includes(fragment), `the summary seal carries ${fragment}`);
  }
  assert.deepEqual(Object.keys(seal!).sort(), ["cameHome", "loops", "sealed"]);
});

/* ── the contradiction this PR closes ─────────────────────────────────────── */

test("an unsealed route cannot create new local territory", () => {
  /* Before this change, saving any qualifying session claimed the first
     untouched cell it passed through — no closure of any kind. That is the one
     thing the mechanic says does not happen, and the app was doing it on every
     save. */
  const screen = code(join(APP, "move", "summary.tsx"));
  const captures = screen.match(/captureZone\(/g) ?? [];
  assert.equal(captures.length, 1, "there must be exactly one place a zone is claimed");
  assert.match(
    screen,
    /if \(candidate && evidenceComplete && seal\?\.sealed === true\) \{\s*const outcome = captureZone\(/,
    "the claim is not gated on the route having sealed",
  );
  assert.match(
    screen,
    /captureEligible =\s*saveable && evidenceComplete && !alreadySavedToday && candidate !== null && seal\?\.sealed === true;/,
    "the eligibility the screen shows is not gated on sealing either",
  );

  /* And the gate closes for a real open route: the evaluation the screen asks
     for says `sealed: false`, so `seal?.sealed === true` is false. */
  const open = sealFinishedRoute({ points: route(OPEN), session: session() });
  assert.equal(open?.sealed, false);
  assert.notEqual(open?.sealed, true);
});

test("saving an unsealed route still banks everything that is not territory", () => {
  /* XP, the quest completion, route trust, the history record and the server
     submission are all outside the gate. An open route is a valid session. */
  const screen = code(join(APP, "move", "summary.tsx"));
  const save = screen.slice(screen.indexOf("const save = ("), screen.indexOf("const done = ("));
  const gate = save.indexOf("seal?.sealed === true");
  assert.ok(gate > 0, "the sealing gate was not found inside save()");
  const beforeGate = save.slice(0, gate);
  for (const kept of ["completeQuest(", "submitCompletedSession(", "setRouteTrust(", "successFeedback("]) {
    assert.ok(beforeGate.includes(kept), `${kept} moved behind the sealing gate`);
  }
});

test("no solid, shade, ownership or economy mechanic arrived with sealing", () => {
  for (const file of [
    join(SRC, "lib", "sealPreview.ts"),
    join(APP, "move", "session.tsx"),
    join(APP, "move", "summary.tsx"),
  ]) {
    const src = code(file);
    for (const absent of [
      "solidCells", "shadeCells", "solidTerritory", "shadeTerritory", "erosion",
      "upkeep", "toll", "charge", "recharge", "settlement", "fortif",
    ]) {
      assert.ok(!src.includes(absent), `${file} introduced ${absent}`);
    }
  }
});

test("no rival trail cutting, and no other player's location, anywhere near sealing", () => {
  for (const file of [
    join(SRC, "lib", "sealPreview.ts"),
    join(APP, "move", "session.tsx"),
  ]) {
    const src = code(file);
    for (const absent of ["rivalTrail", "otherPlayer", "opponentRoute", "trailCut", "cutRival", "pincer"]) {
      assert.ok(!src.includes(absent), `${file} introduced ${absent}`);
    }
  }
});

/* ── one implementation, and it is the shared one ─────────────────────────── */

test("the phone has no sealing geometry of its own", () => {
  /* A second implementation is how the preview and the authority start
     disagreeing. Every geometric decision must come from the shared module. */
  const adapter = code(join(SRC, "lib", "sealPreview.ts"));
  assert.match(adapter, /from "@movenrun\/shared\/sealing"/);
  for (const ownMath of [
    "Math.atan2", "segmentCrossing", "denominator", "crossProduct", "intersect",
    "* Math.PI / 180", "6371000", "6_371_000",
  ]) {
    assert.ok(!adapter.includes(ownMath), `the preview does its own geometry: ${ownMath}`);
  }
  /* The radius comes from the session's rules, never from a literal here. A
     second copy of 150 is how the phone and the server start disagreeing about
     what "coming home" means. */
  assert.ok(
    (adapter.match(/rules\.returnRadiusMeters/g) ?? []).length >= 2,
    "the preview does not read the radius from the rules",
  );
  assert.ok(!/\b150\b/.test(adapter), "the preview hardcodes a seal radius");

  for (const file of [join(APP, "move", "session.tsx"), join(APP, "move", "summary.tsx")]) {
    const src = code(file);
    /* Not only the shared module's own names: a second algorithm written from
       scratch would use none of them, so the vocabulary of segment geometry is
       forbidden here too. A screen that needs a crossing asks the domain. */
    for (const ownMath of [
      "segmentCrossing", "createSealScanner", "evaluateSealing", "denominator",
      "crossProduct", "Math.atan2", "intersect", "haversine", "6371000", "6_371_000",
    ]) {
      assert.ok(!src.includes(ownMath), `${file} does its own route geometry: ${ownMath}`);
    }
    /* And the one shape a hand-rolled scan always has: a pair of nested loops
       walking the route against itself. */
    assert.ok(
      !/for \([^)]*\b(points|pts|route)\w*\.length[\s\S]{0,200}for \([^)]*\b(points|pts|route)\w*\.length/.test(src),
      `${file} walks the route against itself`,
    );
  }
});

test("the screen evaluates geometry only when the route grows", () => {
  /* Not on the clock tick, not on a re-render, not on pause or resume. A
     closure is a property of the route, so only the route can create one. */
  const screen = code(join(APP, "move", "session.tsx"));
  const pushes = screen.match(/previewRef\.current\?\.push\(/g) ?? [];
  assert.equal(pushes.length, 1, "the preview is fed from more than one place");
  const acceptBlock = screen.slice(screen.indexOf("acceptPoint(prev, p)"));
  assert.ok(
    acceptBlock.indexOf("previewRef.current?.push(") < acceptBlock.indexOf("shouldRefreshPreview("),
    "the preview must be fed from the accepted-fix path",
  );
});

test("a session's geometry does not outlive the session", () => {
  /* No module-level cache, no global index, and the tracker is dropped when the
     screen unmounts — one session's route can never leak into the next. */
  const adapter = read(join(SRC, "lib", "sealPreview.ts"));
  assert.ok(
    !/^(const|let|var)\s+\w+\s*(:[^=]+)?=\s*(new (Map|Set|WeakMap)|\[\]|\{\})/m.test(adapter),
    "the preview module holds mutable state at module scope",
  );
  const screen = code(join(APP, "move", "session.tsx"));
  assert.match(screen, /previewRef\.current = null;/, "the tracker is not released on cleanup");

  /* Behaviourally: two trackers share nothing. */
  const first = createSealPreview(SESSION_RULES_VERSION, [])!;
  for (const p of route(LASSO)) first.push(p);
  assert.equal(first.preview.sealedLoops, 1);
  assert.deepEqual(createSealPreview(SESSION_RULES_VERSION, [])!.preview, EMPTY_PREVIEW);
});

/* ── what the screens may say ─────────────────────────────────────────────── */

test("the live seal state never claims capture, and never uses a warning colour", () => {
  const screen = read(join(APP, "move", "session.tsx"));
  /* From where the state's colour is decided through to the end of the card,
     because the tone is derived just above the JSX that uses it. */
  const card = screen.slice(
    screen.indexOf("const sealed = preview.sealedLoops"),
    screen.indexOf("Large, unmistakable controls"),
  );
  for (const overclaim of ["Captured", "captured", "Owned", "owned", "Solid", "Shade", "Claimed", "Territory won"]) {
    assert.ok(!card.includes(overclaim), `the live seal card claims "${overclaim}"`);
  }
  assert.ok(!card.includes("rivalRed"), "an open route is shown as a problem");
  assert.ok(!card.includes("danger"), "an open route is shown as a problem");
  /* State is carried by an icon as well as a colour. */
  assert.match(card, /<Ionicons/);
  assert.match(card, /palette\.pulseGreen/);
  assert.match(card, /palette\.baseBlue/);
});

test("no screen prints a raw cell id or any geometry debug value", () => {
  for (const file of [join(APP, "move", "session.tsx"), join(APP, "move", "summary.tsx")]) {
    const src = read(file);
    for (const raw of ["8860", "priorSegment", "closingSegment", "priorFraction", "startIndex", "endIndex"]) {
      assert.ok(!src.includes(raw), `${file} shows ${raw}`);
    }
  }
});

test("the sealing path logs nothing", () => {
  for (const file of [join(SRC, "lib", "sealPreview.ts"), join(APP, "move", "session.tsx")]) {
    const src = code(file);
    for (const sink of [/\bconsole\s*\./, /\banalytics\b/i, /\bSentry\b/, /\btrack\s*\(/]) {
      assert.ok(!sink.test(src), `${file} reaches a logging sink (${sink})`);
    }
  }
});

test("the log scan can see a log, so an empty result means something", () => {
  assert.ok(/\bconsole\s*\./.test("console.log(intersection)"));
});
