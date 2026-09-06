/**
 * The rank table, and the one string the resource header renders.
 *
 * Two properties matter here and neither is about a specific name:
 *
 *  1. **Totality.** A rank must exist for every level a player can reach,
 *     including level 1 and including a level far past the last band. A lookup
 *     that returns `undefined` at either end would render "LV 12 · undefined"
 *     on the header of four screens.
 *  2. **Monotonicity.** Ranks never go backwards as XP goes up. That is the
 *     whole promise of a progression label, and it is the property a
 *     hand-edited band table breaks first.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { hudProgress, RANK_BANDS, rankTitle } from "../playerRank";
import { getLevelInfo, XP_PER_LEVEL } from "../leveling";

test("the band table is ordered, gapless at its start, and has distinct names", () => {
  assert.ok(RANK_BANDS.length >= 3, "a two-band table is not a progression");
  assert.equal(RANK_BANDS[0]!.from, 1, "the first band must cover level 1");

  const froms = RANK_BANDS.map((b) => b.from);
  assert.deepEqual(froms, [...froms].sort((a, b) => a - b), "bands are not ascending");
  assert.equal(new Set(froms).size, froms.length, "two bands start at the same level");

  const titles = RANK_BANDS.map((b) => b.title);
  assert.equal(new Set(titles).size, titles.length, "two bands share a title");
  for (const title of titles) {
    assert.ok(title.trim().length > 0, "a band has no title");
    assert.ok(title.split(" ").length <= 2, `"${title}" is too long to sit beside a level`);
  }
});

test("every level from 1 to well past the last band resolves to a real title", () => {
  const last = RANK_BANDS[RANK_BANDS.length - 1]!;
  for (let level = 1; level <= last.from + 100; level++) {
    const title = rankTitle(level);
    assert.ok(
      RANK_BANDS.some((b) => b.title === title),
      `level ${level} produced "${title}", which is not in the table`,
    );
  }
});

test("rank never goes backwards as level rises", () => {
  const index = (title: string) => RANK_BANDS.findIndex((b) => b.title === title);
  let previous = 0;
  for (let level = 1; level <= 60; level++) {
    const current = index(rankTitle(level));
    assert.ok(current >= previous, `rank fell at level ${level}`);
    previous = current;
  }
  assert.ok(previous > 0, "the top band is unreachable within 60 levels");
});

test("a level below or at the floor still reads as the first band", () => {
  // Defensive rather than expected: `getLevelInfo` floors at 1, but this
  // function takes a bare number and must not return undefined for a bad one.
  for (const level of [0, -3, Number.NaN]) {
    assert.equal(rankTitle(level), RANK_BANDS[0]!.title);
  }
});

/* ── the header model ─────────────────────────────────────────────────────── */

test("hudProgress reports the level the store would, never its own arithmetic", () => {
  for (const xp of [0, 1, 499, 500, 1260, 9999]) {
    assert.equal(hudProgress(xp, "Mover").level, getLevelInfo(xp).level);
    assert.equal(hudProgress(xp, "Mover").progress, getLevelInfo(xp).progress);
  }
});

test("the next-level label names the level being worked towards, and the XP owed", () => {
  const hud = hudProgress(1260, "Meera");
  const level = getLevelInfo(1260);
  assert.equal(hud.level, level.level);
  assert.equal(hud.xpToNext, XP_PER_LEVEL - level.xpIntoLevel);
  assert.match(hud.nextLevelLabel, new RegExp(`to level ${level.level + 1}$`));
  assert.match(hud.nextLevelLabel, /^\d[\d,]* XP/);
});

test("xpToNext is always within the curve, and never zero mid-level", () => {
  for (let xp = 0; xp <= XP_PER_LEVEL * 4; xp += 37) {
    const hud = hudProgress(xp, "Mover");
    assert.ok(hud.xpToNext > 0, `${xp} XP owes nothing, so the bar has nothing to fill`);
    assert.ok(hud.xpToNext <= XP_PER_LEVEL, `${xp} XP owes more than a whole level`);
  }
});

test("negative or fractional XP cannot produce a broken header", () => {
  for (const xp of [-1, -1000, 12.7]) {
    const hud = hudProgress(xp, "Mover");
    assert.ok(hud.level >= 1);
    assert.ok(hud.progress >= 0 && hud.progress <= 1);
    assert.ok(!hud.xpLabel.includes("-"), "a negative total must not be shown");
    assert.ok(!hud.xpLabel.includes("NaN"));
  }
});

test("the spoken label is one sentence carrying identity and distance to next", () => {
  const hud = hudProgress(1260, "Meera");
  assert.match(hud.accessibilityLabel, /^Meera, level \d+, \w+\./);
  assert.ok(
    hud.accessibilityLabel.includes(hud.nextLevelLabel),
    "the spoken label must carry the same next-level wording the header shows",
  );
  assert.ok(
    hud.accessibilityLabel.includes(hud.xpLabel),
    "…and the same total, so the two cannot drift",
  );
});
