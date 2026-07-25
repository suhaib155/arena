/**
 * Capture preview states and copy.
 *
 * The rule under test throughout: the app may estimate, never claim. Only a
 * server response may set `confirmed`, and only a server response may use the
 * word "captured" in a completed sense.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildLivePreview,
  buildResultPreview,
  describeRejections,
  formatArea,
  REJECTION_COPY,
  type CapturePreviewInput,
  type CaptureResult,
} from "../territory/capturePreview";

function live(overrides: Partial<CapturePreviewInput> = {}) {
  return buildLivePreview({
    closureDistanceMeters: 500,
    estimatedAreaSquareMeters: 60_000,
    cellsCrossed: 4,
    estimatedCells: 12,
    closureToleranceMeters: 50,
    nearClosureMeters: 150,
    distanceMeters: 1200,
    minDistanceMeters: 800,
    ...overrides,
  });
}

function result(overrides: Partial<CaptureResult> = {}): CaptureResult {
  return {
    routeStatus: "VERIFIED",
    captureEligible: true,
    capturedCells: ["892a1008943ffff", "892a100894bffff"],
    reinforcedCells: [],
    attackedCells: [],
    rejectedCells: [],
    rejectionReasons: [],
    processedAt: "2026-05-01T10:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------- live preview

test("before any fix, the preview asks the runner to start moving", () => {
  const preview = live({ closureDistanceMeters: null });
  assert.equal(preview.stage, "open");
  assert.equal(preview.confirmed, false);
  assert.equal(preview.showAreaEstimate, false);
});

test("an open route points back toward the start", () => {
  const preview = live({ closureDistanceMeters: 500 });
  assert.equal(preview.stage, "open");
  assert.match(preview.headline, /Return near your starting point/);
  assert.match(preview.detail ?? "", /500 m from where you started/);
});

test("near closure reports the remaining distance", () => {
  const preview = live({ closureDistanceMeters: 34 + 100 });
  assert.equal(preview.stage, "nearClosure");
  assert.match(preview.headline, /Loop almost closed — 134 m remaining/);
});

test("a locally closed loop reports an estimate, never a capture", () => {
  const preview = live({ closureDistanceMeters: 20 });
  assert.equal(preview.stage, "closedLocally");
  assert.match(preview.headline, /Loop detected/);
  assert.match(preview.detail ?? "", /Capture estimate: 12 zones/);
  assert.equal(preview.confirmed, false, "a local loop is never a confirmed capture");
});

test("a closed but too-short loop says so instead of promising a capture", () => {
  const preview = live({ closureDistanceMeters: 20, distanceMeters: 300 });
  assert.equal(preview.stage, "nearClosure");
  assert.match(preview.headline, /still short/);
  assert.match(preview.detail ?? "", /500 m more/);
  assert.equal(preview.confirmed, false);
});

test("an area estimate is hidden until it is geometrically meaningful", () => {
  assert.equal(live({ estimatedAreaSquareMeters: 50 }).showAreaEstimate, false);
  assert.equal(live({ estimatedAreaSquareMeters: 60_000 }).showAreaEstimate, true);
});

test("NO LIVE PREVIEW STATE IS EVER MARKED CONFIRMED", () => {
  const inputs: Partial<CapturePreviewInput>[] = [
    { closureDistanceMeters: null },
    { closureDistanceMeters: 1000 },
    { closureDistanceMeters: 100 },
    { closureDistanceMeters: 5 },
    { closureDistanceMeters: 0, estimatedCells: 400 },
  ];
  for (const input of inputs) {
    assert.equal(
      live(input).confirmed,
      false,
      `client-side preview claimed confirmation for ${JSON.stringify(input)}`,
    );
  }
});

test("no live preview headline uses completed-capture language", () => {
  for (const closureDistanceMeters of [null, 1000, 120, 30, 0]) {
    const preview = live({ closureDistanceMeters });
    const text = `${preview.headline} ${preview.detail ?? ""}`;
    assert.ok(
      !/\bcaptured\b/i.test(text),
      `live preview claimed capture: "${text}"`,
    );
  }
});

// -------------------------------------------------------- result preview

test("a submitted-but-unprocessed route shows verifying, not success", () => {
  const preview = buildResultPreview(result({ processedAt: null }));
  assert.equal(preview.stage, "submitted");
  assert.match(preview.headline, /Verifying/);
  assert.equal(preview.confirmed, false);
});

test("a missing result also shows verifying rather than failing silently", () => {
  const preview = buildResultPreview(null);
  assert.equal(preview.stage, "submitted");
  assert.equal(preview.confirmed, false);
});

test("a confirmed capture reports the server's count", () => {
  const preview = buildResultPreview(result());
  assert.equal(preview.stage, "confirmed");
  assert.equal(preview.confirmed, true);
  assert.match(preview.headline, /Territory captured — 2 zones/);
});

test("a single captured zone is not pluralised", () => {
  const preview = buildResultPreview(result({ capturedCells: ["892a1008943ffff"] }));
  assert.match(preview.headline, /1 zone\./);
});

test("reinforcements and attacks are reported alongside a capture", () => {
  const preview = buildResultPreview(
    result({ reinforcedCells: ["a", "b"], attackedCells: ["c"] }),
  );
  assert.match(preview.detail ?? "", /2 reinforced/);
  assert.match(preview.detail ?? "", /1 attacked/);
});

test("an eligible run that only held ground reads as held, not as rejected", () => {
  const preview = buildResultPreview(
    result({ capturedCells: [], reinforcedCells: ["a", "b", "c"] }),
  );
  assert.equal(preview.stage, "confirmed");
  assert.match(preview.headline, /Territory held/);
  assert.match(preview.detail ?? "", /3 reinforced/);
});

test("an ineligible result is rejected with the server's first reason", () => {
  const preview = buildResultPreview(
    result({
      captureEligible: false,
      capturedCells: [],
      rejectionReasons: ["loopNotClosed"],
    }),
  );
  assert.equal(preview.stage, "rejected");
  assert.equal(preview.confirmed, false);
  assert.equal(preview.headline, "Capture not awarded.");
  assert.equal(preview.detail, REJECTION_COPY.loopNotClosed);
});

test("an eligible result that changed nothing still reads as not awarded", () => {
  const preview = buildResultPreview(
    result({ capturedCells: [], reinforcedCells: [], attackedCells: [] }),
  );
  assert.equal(preview.stage, "rejected");
});

// ---------------------------------------------------------- rejection copy

test("every rejection reason has human-readable copy", () => {
  for (const [reason, copy] of Object.entries(REJECTION_COPY)) {
    assert.ok(copy.length > 10, `${reason} needs a real explanation`);
    assert.ok(copy.endsWith("."), `${reason} copy should read as a sentence`);
  }
});

test("the documented rejection reasons are all covered", () => {
  for (const reason of [
    "insufficientDistance",
    "loopNotClosed",
    "insufficientDuration",
    "poorGpsAccuracy",
    "impossibleSpeed",
    "selfIntersectingRoute",
    "areaBelowMinimum",
    "areaAboveMaximum",
    "restrictedTerritory",
    "duplicateRoute",
    "serverVerificationFailed",
  ]) {
    assert.ok(reason in REJECTION_COPY, `missing copy for ${reason}`);
  }
});

test("backend reason codes map to copy, and unknown ones still get an answer", () => {
  assert.deepEqual(describeRejections(["loopNotClosed", "areaBelowMinimum"]), [
    REJECTION_COPY.loopNotClosed,
    REJECTION_COPY.areaBelowMinimum,
  ]);
  // A newer backend reason the app doesn't know must not leave a blank screen.
  const unknown = describeRejections(["somethingNewFromTheBackend"]);
  assert.equal(unknown.length, 1);
  assert.match(unknown[0], /wasn't awarded/);
});

test("no rejections means no copy", () => {
  assert.deepEqual(describeRejections([]), []);
});

// --------------------------------------------------------------- formatting

test("area formats by magnitude", () => {
  assert.equal(formatArea(450), "450 m²");
  assert.equal(formatArea(62_500), "6.3 ha");
  assert.equal(formatArea(2_500_000), "2.50 km²");
});
