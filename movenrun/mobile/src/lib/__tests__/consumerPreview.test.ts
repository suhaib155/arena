import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (path: string) => readFileSync(path, "utf8");

test("consumer Clubs uses real personal progress without fixture member or opponent claims", () => {
  const clubs = read("app/(tabs)/clubs.tsx");
  assert.doesNotMatch(clubs, /club\.memberCount|<RankRow|CityWarMap|City leaderboard/);
  assert.match(clubs, /label="Your sessions" value=\{String\(weekSessions\)\}/);
  assert.match(clubs, /heroView\.contributionLabel/);
  assert.match(clubs, /<FirstTimeGuide topic="clubs"/);
});

test("preview screens offer one-time education and intentional replay instead of caveat walls", () => {
  for (const [path, topic] of [["app/deed-showroom.tsx", "deeds"], ["app/club-territory.tsx", "clubs"]]) {
    const src = read(path);
    assert.match(src, new RegExp(`<FirstTimeGuide topic="${topic}"`));
    assert.match(src, new RegExp(`pathname: "\\/help", params: \\{ topic: "${topic}"`));
    assert.doesNotMatch(src, /No wallet<|No minting<|No real members<|No leaderboard</);
  }
});

test("account-free welcome requires affirmative legal acknowledgment without manufacturing sign-in", () => {
  const src = read("app/welcome.tsx");
  assert.match(src, /useState\(false\)/);
  assert.match(src, /const locked = busy \|\| formBusy \|\| !accepted/);
  assert.match(src, /if \(locked\) return/);
  assert.match(src, /label="Start exploring"[\s\S]*?disabled=\{locked\}[\s\S]*?onPress=\{onLocalBeta\}/);
  assert.match(src, /firstRunStage === "account" && accepted/);
});
