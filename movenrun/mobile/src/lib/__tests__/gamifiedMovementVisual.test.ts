import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (path: string) => readFileSync(path, "utf8");

test("Free Run staging uses a mission identity without painted geography", () => {
  const source = read("app/move/index.tsx");
  assert.match(source, /<GroundPanel[^>]*title="Free Run"/);
  assert.doesNotMatch(source, /styles\.(?:road|roadV|mapHexA|mapHexB|mapPin)|canvas\.road/);
  assert.match(source, /onPress=\{onPrimary\}/);
});

test("quest result earns only actual XP and incomplete results retain a neutral crest", () => {
  const source = read("app/result.tsx");
  const incomplete = source.slice(source.indexOf('if (!quest || !outcome?.completionSatisfied)'), source.indexOf('const onShare'));
  assert.match(incomplete, /<GameBadge[^>]*tone="neutral"/);
  assert.doesNotMatch(incomplete, /<GameBadge[^>]*tone="green"/);
  assert.match(incomplete, /\{view\.xpLabel\}/);
  assert.match(source, /value=\{outcome\.xpGained\}/);
  assert.doesNotMatch(source, />Locked MOVE<|\+\{lockedMoveGained\}/);
});

test("visual share keeps real route conditions and endpoint privacy intact", () => {
  const source = read("app/route/proof.tsx");
  assert.match(source, /hideEnds \? redactEndpoints\(session\.points\) : session\.points/);
  assert.match(source, /\{hasRoute \? "Route complete" : "Not enough movement"\}/);
  assert.match(source, /<RouteMotif size=\{38\}/);
  assert.doesNotMatch(source, /styles\.road|styles\.mapHex/);
});

test("gamified live controls retain isolated clock and cell-keyed geometry", () => {
  const source = read("app/move/session.tsx");
  assert.match(source, /<SessionClock readElapsed=\{readElapsed\}/);
  assert.match(source, /contextCells\(head\), \[cellKey\]/);
  assert.match(source, /onPauseResume=\{togglePause\}/);
  assert.match(source, /onFinish=\{confirmFinish\}/);
  assert.doesNotMatch(source, /<ScrollView|<Animated\.ScrollView/);
});
