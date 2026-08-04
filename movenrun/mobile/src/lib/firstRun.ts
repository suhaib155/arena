/**
 * First-run state — one versioned, persisted source of truth.
 *
 * The app used to answer "has this user finished first run?" with two
 * independent booleans (`hasSeenOpeningIntro`, `hasOnboarded`) that could
 * disagree and could not express *how* the user entered the product. This
 * module replaces both with a single versioned record plus total, pure
 * transitions, so startup routing is decidable off-device and exhaustively
 * testable.
 *
 * Nothing here touches storage, navigation, auth, or secrets: it is plain data
 * in, plain data out. The persisted record contains no identifier, token, or
 * server value — only the stage the user reached and how they chose to play.
 *
 * Legacy fields: `hasSeenOpeningIntro` / `hasOnboarded` are read ONCE by
 * {@link migrateFirstRun} out of previously-persisted state and are never
 * written again. They are not part of `GameState` any more, so no runtime code
 * can read them; they disappear from a device's storage the first time the
 * migrated state is written back. Remove the two fields from
 * {@link LegacyFirstRunFlags} once the store's persisted `version` floor is
 * raised past 9 (i.e. when pre-v10 installs are no longer supported).
 */

/** Bumped whenever the shape or the meaning of a field changes. */
export const CURRENT_FIRST_RUN_VERSION = 2;

/** Where the user is in first run. Exactly one of these is true at a time. */
export type FirstRunStage =
  /** Has not chosen how to enter the product yet. */
  | "account"
  /** Chose a path (sign-in or local beta); still owes the 3-step intro. */
  | "intro"
  /** Finished first run — normal app from here on. */
  | "ready";

/** How the user chose to enter. Never fabricated: `signed_in` is only ever set
 *  after the server confirmed an authentication. */
export type ExperienceMode = "undecided" | "signed_in" | "local_beta";

export interface FirstRunState {
  version: number;
  stage: FirstRunStage;
  mode: ExperienceMode;
}

/** A genuinely fresh install: choose an account path before anything else. */
export const FRESH_FIRST_RUN: FirstRunState = Object.freeze({
  version: CURRENT_FIRST_RUN_VERSION,
  stage: "account",
  mode: "undecided",
});

/**
 * The state a *full app reset* (an explicitly labelled destructive action, not
 * "Reset progress") would restore. Exported so the distinction is explicit in
 * code rather than implied — "Reset progress" must never use this.
 */
export const FULL_APP_RESET_FIRST_RUN: FirstRunState = FRESH_FIRST_RUN;

/** Pre-v2 persisted booleans, read once during migration. */
export interface LegacyFirstRunFlags {
  hasSeenOpeningIntro?: unknown;
  hasOnboarded?: unknown;
}

const STAGES: readonly FirstRunStage[] = ["account", "intro", "ready"];
const MODES: readonly ExperienceMode[] = ["undecided", "signed_in", "local_beta"];

function isStage(value: unknown): value is FirstRunStage {
  return typeof value === "string" && (STAGES as readonly string[]).includes(value);
}

function isMode(value: unknown): value is ExperienceMode {
  return typeof value === "string" && (MODES as readonly string[]).includes(value);
}

/**
 * Coerce anything persisted (or hand-edited, or half-written) into a valid,
 * self-consistent state. Returns null when the value carries no usable
 * first-run information at all, so callers can fall back to migration.
 *
 * Deterministic repairs — chosen so a corrupt record can never *grant*
 * anything (it never invents `signed_in`) and can never trap an established
 * user back in signup:
 *  - unknown stage/mode → the safe default for that field;
 *  - `account` + a decided mode → the user already chose: advance to `intro`;
 *  - `intro`/`ready` + `undecided` → they progressed without a recorded
 *    choice: record the unprivileged `local_beta`.
 */
export function normalizeFirstRunState(value: unknown): FirstRunState | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (!isStage(raw.stage) && !isMode(raw.mode)) return null;

  let stage: FirstRunStage = isStage(raw.stage) ? raw.stage : "account";
  let mode: ExperienceMode = isMode(raw.mode) ? raw.mode : "undecided";

  if (stage === "account" && mode !== "undecided") stage = "intro";
  if (stage !== "account" && mode === "undecided") mode = "local_beta";

  return { version: CURRENT_FIRST_RUN_VERSION, stage, mode };
}

/**
 * Resolve the first-run state for a store that is being rehydrated.
 *
 * A recognisable record wins (normalised). Otherwise the two legacy booleans
 * decide: a user who completed the old onboarding is `ready` and is never
 * shown the new intro; a user who only saw the old cinematic still owes the
 * intro but has already chosen to play locally, so they skip account choice.
 */
export function migrateFirstRun(
  persisted: unknown,
  legacy: LegacyFirstRunFlags = {},
): FirstRunState {
  const normalized = normalizeFirstRunState(persisted);
  if (normalized) return normalized;

  if (legacy.hasOnboarded === true) {
    return { version: CURRENT_FIRST_RUN_VERSION, stage: "ready", mode: "local_beta" };
  }
  if (legacy.hasSeenOpeningIntro === true) {
    return { version: CURRENT_FIRST_RUN_VERSION, stage: "intro", mode: "local_beta" };
  }
  return { ...FRESH_FIRST_RUN };
}

/** The user chose "Explore local beta". Never demotes an already-ready user
 *  and never overwrites a confirmed `signed_in` mode. */
export function chooseLocalBeta(state: FirstRunState): FirstRunState {
  const mode: ExperienceMode = state.mode === "signed_in" ? "signed_in" : "local_beta";
  if (state.stage === "ready") return { ...state, version: CURRENT_FIRST_RUN_VERSION, mode };
  return { version: CURRENT_FIRST_RUN_VERSION, stage: "intro", mode };
}

/** The SERVER confirmed an authentication. Moves to the intro unless this
 *  install already completed it (an established user is not re-onboarded). */
export function signInFirstRun(state: FirstRunState): FirstRunState {
  return {
    version: CURRENT_FIRST_RUN_VERSION,
    stage: state.stage === "ready" ? "ready" : "intro",
    mode: "signed_in",
  };
}

/** The intro's final CTA. Idempotent: replaying the intro from Profile calls
 *  nothing, and even if it did, a `ready` user stays exactly as they are. */
export function completeIntro(state: FirstRunState): FirstRunState {
  return {
    version: CURRENT_FIRST_RUN_VERSION,
    stage: "ready",
    mode: state.mode === "undecided" ? "local_beta" : state.mode,
  };
}

/**
 * "Reset progress" clears gameplay only. It does not sign the user out and
 * does not push an established user back through signup, so first-run state
 * passes through untouched (normalised, never rebuilt).
 */
export function firstRunAfterProgressReset(state: FirstRunState): FirstRunState {
  return normalizeFirstRunState(state) ?? { ...FRESH_FIRST_RUN };
}
