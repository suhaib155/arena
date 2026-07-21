/**
 * Accessibility labels for icon-only controls — offline source guard.
 *
 * Icon-only buttons carry no visible text, so screen-reader users depend on an
 * `accessibilityLabel`. This test fails if the redesigned icon-only controls
 * ever drop their label (the notification bell, the custom tab bar's buttons,
 * and the shared press wrapper that forwards the prop). It is a lightweight
 * source check — no renderer — scoped to the exact files that own these
 * controls, mirroring the opening-animation source guard.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "src", "components");

test("ScalePress forwards an accessibilityLabel prop to its Pressable", () => {
  const src = readFileSync(join(SRC, "ScalePress.tsx"), "utf8");
  assert.match(src, /accessibilityLabel/, "ScalePress must accept + forward accessibilityLabel");
  assert.match(src, /accessibilityRole/, "ScalePress must forward accessibilityRole");
});

test("NotificationBell (icon-only) sets an accessibilityLabel", () => {
  const src = readFileSync(join(SRC, "NotificationBell.tsx"), "utf8");
  assert.match(src, /accessibilityLabel=/, "the bell must label itself");
  assert.match(src, /accessibilityRole="button"/);
});

test("MovenTabBar icon buttons (Home/Territory/Move/Clubs/Profile) are all labelled", () => {
  const src = readFileSync(join(SRC, "MovenTabBar.tsx"), "utf8");
  // Every navigation control here is icon-forward; each must be labelled.
  const labels = src.match(/accessibilityLabel=/g) ?? [];
  assert.ok(
    labels.length >= 2,
    "TabButton and MoveButton must each declare an accessibilityLabel",
  );
  assert.match(src, /accessibilityLabel="Move — start a movement session"/);
});
