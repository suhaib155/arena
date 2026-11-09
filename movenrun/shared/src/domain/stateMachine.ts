/**
 * Explicit state machines: one small vocabulary for every status union in the
 * app, backend and website code that has transitions.
 *
 * A status string with transitions is a state machine whether or not anyone
 * wrote it down. Written down here, it is a frozen table a test can walk, a
 * reviewer can read in one screen, and a tool can check before it edits a
 * call site. Nothing here performs I/O or holds state; the table is data.
 *
 * Usage:
 *
 * ```ts
 * type Light = "red" | "green" | "amber";
 * export const LIGHT_TRANSITIONS = defineTransitions<Light>({
 *   red: ["green"],
 *   green: ["amber"],
 *   amber: ["red"],
 * });
 * canTransition(LIGHT_TRANSITIONS, "red", "amber"); // false
 * ```
 *
 * The mapped type makes the table exhaustive: adding a member to the union
 * without a row is a type error, so a new state cannot appear without its
 * exits being decided. The catalogue of every machine lives in
 * `docs/STATE_MACHINES.md`.
 */

/** Every state lists the states it may move to. `[]` marks a terminal state. */
export type TransitionTable<S extends string> = { readonly [K in S]: readonly S[] };

/**
 * Freeze and validate a transition table.
 *
 * Throws at module load (never at a call site) when a row names a target that
 * is not itself a row, or repeats a target. Both are authoring mistakes a type
 * cannot always catch when the table is built from a widened string type.
 */
export function defineTransitions<S extends string>(table: TransitionTable<S>): TransitionTable<S> {
  const states = new Set(Object.keys(table));
  for (const [from, targets] of Object.entries(table) as [string, readonly string[]][]) {
    const seen = new Set<string>();
    for (const to of targets) {
      if (!states.has(to)) throw new Error(`state machine: ${from} -> ${to} names an unknown state`);
      if (seen.has(to)) throw new Error(`state machine: ${from} -> ${to} is listed twice`);
      seen.add(to);
    }
    Object.freeze(targets);
  }
  return Object.freeze(table);
}

/** Whether `from -> to` is an allowed move. A self-move is allowed only when listed. */
export function canTransition<S extends string>(table: TransitionTable<S>, from: S, to: S): boolean {
  const row = (table as Record<string, readonly S[] | undefined>)[from];
  return row !== undefined && row.includes(to);
}

/** All states of the table, in declaration order. */
export function statesOf<S extends string>(table: TransitionTable<S>): S[] {
  return Object.keys(table) as S[];
}

/** States with no exits. */
export function terminalStates<S extends string>(table: TransitionTable<S>): S[] {
  return statesOf(table).filter((s) => table[s].length === 0);
}

/** Every state reachable from `start`, including `start`. */
export function reachableFrom<S extends string>(table: TransitionTable<S>, start: S): Set<S> {
  const seen = new Set<S>([start]);
  const queue: S[] = [start];
  while (queue.length > 0) {
    const next = queue.shift() as S;
    for (const to of table[next]) {
      if (!seen.has(to)) {
        seen.add(to);
        queue.push(to);
      }
    }
  }
  return seen;
}

/**
 * Exhaustiveness check for a `switch` over a union.
 *
 * Put it in the `default` branch: the call only type-checks when every member
 * has a case, so a new state is a compile error at each consumer rather than a
 * silent fall-through. At runtime it throws, which only happens if a value
 * outside the union got past the types (for example from storage or the wire).
 */
export function assertNever(value: never, context = "state"): never {
  throw new Error(`unexpected ${context}: ${String(value)}`);
}
