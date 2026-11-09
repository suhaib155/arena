import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertNever, canTransition, defineTransitions, reachableFrom, statesOf, terminalStates,
  type TransitionTable,
} from "../stateMachine";

type Light = "red" | "green" | "amber" | "off";
const LIGHT = defineTransitions<Light>({
  red: ["green", "off"],
  green: ["amber", "off"],
  amber: ["red", "off"],
  off: [],
});

test("canTransition allows exactly the listed moves", () => {
  assert.equal(canTransition(LIGHT, "red", "green"), true);
  assert.equal(canTransition(LIGHT, "red", "amber"), false);
  assert.equal(canTransition(LIGHT, "red", "red"), false, "a self-move is not implied");
  assert.equal(canTransition(LIGHT, "off", "red"), false, "terminal has no exits");
});

test("canTransition is false for a value outside the table", () => {
  assert.equal(canTransition(LIGHT, "blue" as Light, "red"), false);
});

test("statesOf, terminalStates and reachableFrom read the table", () => {
  assert.deepEqual(statesOf(LIGHT), ["red", "green", "amber", "off"]);
  assert.deepEqual(terminalStates(LIGHT), ["off"]);
  assert.deepEqual([...reachableFrom(LIGHT, "red")].sort(), ["amber", "green", "off", "red"]);
  assert.deepEqual([...reachableFrom(LIGHT, "off")], ["off"]);
});

test("the table and its rows are frozen", () => {
  assert.equal(Object.isFrozen(LIGHT), true);
  assert.equal(Object.isFrozen(LIGHT.red), true);
});

test("defineTransitions rejects an unknown target and a duplicate target", () => {
  assert.throws(
    () => defineTransitions({ a: ["b"] } as unknown as TransitionTable<"a">),
    /a -> b names an unknown state/,
  );
  assert.throws(
    () => defineTransitions<"a" | "b">({ a: ["b", "b"], b: [] }),
    /a -> b is listed twice/,
  );
});

test("assertNever throws with context for a value that escaped the types", () => {
  assert.throws(() => assertNever("x" as never, "light"), /unexpected light: x/);
});
