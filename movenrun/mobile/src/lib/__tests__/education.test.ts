import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createEducationController, EDUCATION_STORAGE_KEY, LEGAL_VERSION, legalAccepted, readEducation, type EducationStorage } from "../education";

function backend(initial: string | null = null) {
  let saved = initial;
  let writes = 0;
  const storage: EducationStorage = {
    async getItem(key) { assert.equal(key, EDUCATION_STORAGE_KEY); return saved; },
    async setItem(key, value) { assert.equal(key, EDUCATION_STORAGE_KEY); saved = value; writes++; },
  };
  return { storage, saved: () => saved, writes: () => writes };
}

test("education parsing retains only three exact boolean topics and the current legal version", () => {
  assert.deepEqual(readEducation("broken-json"), readEducation(null));
  const parsed = readEducation(JSON.stringify({
    seen: { territory: true, deeds: "true", clubs: false, unknown: true },
    acceptedVersion: "old-version", coordinates: [12, 77], accountId: "unexpected",
  }));
  assert.deepEqual(parsed, { seen: { territory: true, deeds: false, clubs: false }, acceptedVersion: null });
  assert.equal(readEducation(JSON.stringify({ acceptedVersion: LEGAL_VERSION })).acceptedVersion, LEGAL_VERSION);
});

test("automatic guide waits for hydration and is claimed once across racing mounted consumers", async () => {
  const db = backend();
  const controller = createEducationController(db.storage);
  assert.equal(controller.claimAutomatic("territory"), false);
  await controller.hydrate();
  assert.equal(controller.claimAutomatic("territory"), true);
  assert.equal(controller.claimAutomatic("territory"), false);
  await controller.markSeen("territory");
  const relaunched = createEducationController(backend(db.saved()).storage);
  await relaunched.hydrate();
  assert.equal(relaunched.claimAutomatic("territory"), false);
  assert.equal(relaunched.claimAutomatic("deeds"), true);
});

test("replaying a guide does not clear seen flags or repeat automatic education", async () => {
  const db = backend();
  const controller = createEducationController(db.storage);
  await controller.hydrate();
  await controller.markSeen("clubs");
  // Help's intentional replay marks the same topic without consuming an automatic claim.
  await controller.markSeen("clubs");
  assert.equal(controller.getSnapshot().seen.clubs, true);
  assert.equal(controller.claimAutomatic("clubs"), false);
  assert.deepEqual(Object.keys(JSON.parse(db.saved()!)).sort(), ["acceptedVersion", "seen"]);
});

test("legal acknowledgment is false on cold load, requires affirmation and survives relaunch", async () => {
  const db = backend();
  const controller = createEducationController(db.storage);
  assert.equal(legalAccepted(controller.getSnapshot()), false);
  await controller.hydrate();
  assert.equal(legalAccepted(controller.getSnapshot()), false);
  await controller.acknowledge(true);
  assert.equal(legalAccepted(controller.getSnapshot()), true);
  const relaunched = createEducationController(backend(db.saved()).storage);
  assert.equal(legalAccepted(relaunched.getSnapshot()), false);
  await relaunched.hydrate();
  assert.equal(legalAccepted(relaunched.getSnapshot()), true);
  await relaunched.acknowledge(false);
  assert.equal(legalAccepted(relaunched.getSnapshot()), false);
});

test("a changed legal version requires a new acknowledgment while keeping tutorial history", async () => {
  const db = backend(JSON.stringify({ acceptedVersion: "previous-demo", seen: { deeds: true } }));
  const controller = createEducationController(db.storage);
  await controller.hydrate();
  assert.equal(legalAccepted(controller.getSnapshot()), false);
  assert.equal(controller.claimAutomatic("deeds"), false);
});

test("hydration and concurrent writes serialize without overwriting seen topics or acknowledgment", async () => {
  let release!: (raw: string | null) => void;
  const read = new Promise<string | null>(resolve => { release = resolve; });
  const records: string[] = [];
  const controller = createEducationController({
    getItem: () => read,
    async setItem(_key, raw) { records.push(raw); },
  });
  const acceptance = controller.acknowledge(true);
  const seen = controller.markSeen("territory");
  assert.equal(legalAccepted(controller.getSnapshot()), false);
  assert.equal(records.length, 0);
  release(JSON.stringify({ seen: { clubs: true } }));
  await Promise.all([acceptance, seen]);
  assert.equal(records.length, 2);
  assert.deepEqual(JSON.parse(records[1]), {
    acceptedVersion: LEGAL_VERSION, seen: { clubs: true, territory: true, deeds: false },
  });
  assert.equal(legalAccepted(controller.getSnapshot()), true);
});

test("failed storage never reports saved affirmative acceptance and can retry", async () => {
  let fail = true;
  const controller = createEducationController({
    async getItem() { return null; },
    async setItem() { if (fail) throw new Error("storage unavailable"); },
  });
  assert.equal(await controller.acknowledge(true), false);
  assert.equal(legalAccepted(controller.getSnapshot()), false);
  fail = false;
  assert.equal(await controller.acknowledge(true), true);
  assert.equal(legalAccepted(controller.getSnapshot()), true);
});

test("read failures remain unaccepted and reversing a pending choice persists the final intent", async () => {
  const failed = createEducationController({ async getItem() { throw new Error("read failed"); }, async setItem() {} });
  await failed.hydrate();
  assert.equal(legalAccepted(failed.getSnapshot()), false);
  const db = backend();
  const controller = createEducationController(db.storage);
  const accept = controller.acknowledge(true);
  const withdraw = controller.acknowledge(false);
  assert.equal(legalAccepted(controller.getSnapshot()), false);
  await Promise.all([accept, withdraw]);
  assert.equal(legalAccepted(controller.getSnapshot()), false);
  assert.equal(JSON.parse(db.saved()!).acceptedVersion, null);
});

test("Help replay, dismiss, Android Back, focus, reduced motion and legal routes are wired", () => {
  const mobile = resolve(__dirname, "../../..");
  const guide = readFileSync(resolve(mobile, "src/components/FirstTimeGuide.tsx"), "utf8");
  const help = readFileSync(resolve(mobile, "app/help.tsx"), "utf8");
  const legal = readFileSync(resolve(mobile, "app/legal.tsx"), "utf8");
  const acceptance = readFileSync(resolve(mobile, "src/components/LegalAcceptance.tsx"), "utf8");
  for (const required of ["education.claimAutomatic(topic)", "!state.hydrated || !focused", "onRequestClose={close}", "setAccessibilityFocus", 'reducedMotion ? "none" : "fade"', "useSafeAreaInsets", "Close guide"]) assert.ok(guide.includes(required), required);
  assert.ok(help.includes("topic={replay} replay"));
  assert.ok(acceptance.includes('accessibilityRole="checkbox"'));
  assert.ok(acceptance.includes("education.acknowledge(!accepted)"));
  assert.ok(acceptance.includes('pathname: "/legal"'));
  for (const required of ["seven days", "account-scoped", "Locate me", "Map providers", "Endpoint redaction", "does not replace OS permissions"]) assert.ok(legal.includes(required), required);
});
