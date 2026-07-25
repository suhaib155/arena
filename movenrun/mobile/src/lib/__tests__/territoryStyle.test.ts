/**
 * Territory colour mapping — offline, no React Native.
 *
 * The important guarantee here is accessibility: relationship must never be
 * distinguishable by hue alone. Every pair of relationships has to differ in at
 * least one non-colour channel (fill opacity, outline width, or dash pattern),
 * and every relationship carries a text label.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TERRITORY_LEGEND_ORDER,
  TERRITORY_STYLES,
  territoryFillColorExpression,
  territoryFillOpacityExpression,
  territoryOutlineWidthExpression,
  territoryStyle,
  toRelationship,
  type TerritoryRelationship,
} from "../territory/territoryStyle";

test("every relationship has a style and a text label", () => {
  for (const relationship of TERRITORY_LEGEND_ORDER) {
    const style = territoryStyle(relationship);
    assert.match(style.fill, /^#[0-9A-F]{6}$/i, `${relationship} fill`);
    assert.match(style.outline, /^#[0-9A-F]{6}$/i, `${relationship} outline`);
    assert.ok(style.label.length > 0, `${relationship} needs a label`);
    assert.ok(style.fillOpacity > 0 && style.fillOpacity <= 1);
    assert.ok(style.outlineWidth > 0);
  }
});

test("the legend covers every relationship exactly once", () => {
  assert.equal(TERRITORY_LEGEND_ORDER.length, Object.keys(TERRITORY_STYLES).length);
  assert.equal(new Set(TERRITORY_LEGEND_ORDER).size, TERRITORY_LEGEND_ORDER.length);
});

test("labels are unique, so state is readable without colour", () => {
  const labels = TERRITORY_LEGEND_ORDER.map((r) => TERRITORY_STYLES[r].label);
  assert.equal(new Set(labels).size, labels.length);
});

test("fill colours are unique", () => {
  const fills = TERRITORY_LEGEND_ORDER.map((r) => TERRITORY_STYLES[r].fill);
  assert.equal(new Set(fills).size, fills.length);
});

test("territory fills stay translucent so streets and parks remain readable", () => {
  for (const relationship of TERRITORY_LEGEND_ORDER) {
    assert.ok(
      TERRITORY_STYLES[relationship].fillOpacity <= 0.5,
      `${relationship} fill would hide the basemap`,
    );
  }
});

test("neutral and restricted are the most transparent states", () => {
  const claimed: TerritoryRelationship[] = ["mine", "club", "rival", "contested"];
  for (const relationship of claimed) {
    assert.ok(
      TERRITORY_STYLES[relationship].fillOpacity >
        TERRITORY_STYLES.neutral.fillOpacity,
      `${relationship} should read stronger than neutral`,
    );
    assert.ok(
      TERRITORY_STYLES[relationship].fillOpacity >
        TERRITORY_STYLES.restricted.fillOpacity,
      `${relationship} should read stronger than restricted`,
    );
  }
});

test("no two relationships are distinguishable by hue alone", () => {
  /** The non-colour channels: opacity, outline width, dash pattern. */
  const signature = (r: TerritoryRelationship) => {
    const s = TERRITORY_STYLES[r];
    return `${s.fillOpacity}|${s.outlineWidth}|${s.outlineDash.join(",")}`;
  };
  const collisions: string[] = [];
  for (let i = 0; i < TERRITORY_LEGEND_ORDER.length; i++) {
    for (let j = i + 1; j < TERRITORY_LEGEND_ORDER.length; j++) {
      const a = TERRITORY_LEGEND_ORDER[i];
      const b = TERRITORY_LEGEND_ORDER[j];
      if (signature(a) === signature(b)) collisions.push(`${a}/${b}`);
    }
  }
  assert.deepEqual(collisions, [], `colour-only distinction between: ${collisions.join(", ")}`);
});

test("contested and restricted use dashed outlines as an extra channel", () => {
  assert.ok(TERRITORY_STYLES.contested.outlineDash.length > 0);
  assert.ok(TERRITORY_STYLES.restricted.outlineDash.length > 0);
});

test("protected carries the heaviest outline", () => {
  const widths = TERRITORY_LEGEND_ORDER.map((r) => TERRITORY_STYLES[r].outlineWidth);
  assert.equal(TERRITORY_STYLES.protected.outlineWidth, Math.max(...widths));
});

test("unknown relationship strings degrade to neutral, never to owned", () => {
  assert.equal(toRelationship("mine"), "mine");
  assert.equal(toRelationship("rival"), "rival");
  assert.equal(toRelationship("nonsense"), "neutral");
  assert.equal(toRelationship(undefined), "neutral");
  assert.equal(toRelationship(42), "neutral");
  assert.equal(toRelationship(null), "neutral");
});

test("MapLibre match expressions cover every relationship plus a default", () => {
  for (const build of [
    territoryFillColorExpression,
    territoryFillOpacityExpression,
    territoryOutlineWidthExpression,
  ]) {
    const expression = build();
    assert.equal(expression[0], "match");
    assert.deepEqual(expression[1], ["get", "relationship"]);
    // ["match", input, (label, value) * n, default]
    assert.equal(expression.length, 2 + TERRITORY_LEGEND_ORDER.length * 2 + 1);
    for (let i = 0; i < TERRITORY_LEGEND_ORDER.length; i++) {
      assert.equal(expression[2 + i * 2], TERRITORY_LEGEND_ORDER[i]);
    }
  }
});
