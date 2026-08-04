/**
 * The canonical three-step intro — pure step machine + copy.
 *
 * The previous onboarding advanced by asking a horizontal `ScrollView` to
 * scroll and then *learning* its new index from `onMomentumScrollEnd`. Scroll
 * offset is not application state: a cancelled fling, a slow device, or a
 * reduced-motion setting could leave the logical index behind the visible
 * page, which is how users ended up pressing "Next" with nothing happening and
 * fell back on Skip.
 *
 * Here the step is ordinary state, advanced synchronously by pure functions.
 * Nothing in this module knows about layout, gestures, animation, or
 * navigation, so every transition is exhaustively testable off-device.
 */

/** Hard product cap — three steps, no fourth educational step. */
export const INTRO_STEP_COUNT = 3;
export const LAST_INTRO_STEP = INTRO_STEP_COUNT - 1;

/** The only legal step values. Arithmetic below keeps them safe integers. */
export type IntroStep = 0 | 1 | 2;

export const FIRST_INTRO_STEP: IntroStep = 0;

/** Clamp any number onto a legal step (defends against a bad restore). */
export function toIntroStep(value: number): IntroStep {
  if (!Number.isFinite(value)) return FIRST_INTRO_STEP;
  const clamped = Math.min(Math.max(Math.trunc(value), 0), LAST_INTRO_STEP);
  return clamped as IntroStep;
}

/** Next step — saturating at the last step, so repeated Next cannot overshoot. */
export function nextIntroStep(step: IntroStep): IntroStep {
  return Math.min(step + 1, LAST_INTRO_STEP) as IntroStep;
}

/** Previous step — saturating at 0, so Back at step 0 is a no-op. */
export function previousIntroStep(step: IntroStep): IntroStep {
  return Math.max(step - 1, 0) as IntroStep;
}

export function isLastIntroStep(step: IntroStep): boolean {
  return step === LAST_INTRO_STEP;
}

/** Back is offered on steps 2 and 3 only. */
export function canGoBack(step: IntroStep): boolean {
  return step > 0;
}

/** UI-only progress fraction (0 < p <= 1). Never used for money or chain math. */
export function introProgress(step: IntroStep): number {
  return (step + 1) / INTRO_STEP_COUNT;
}

/** Visible position label — "1 of 3". */
export function introPositionLabel(step: IntroStep): string {
  return `${step + 1} of ${INTRO_STEP_COUNT}`;
}

export interface IntroStepContent {
  title: string;
  body: string;
  /** Primary CTA for this step. The last step's CTA enters the first mission. */
  ctaLabel: string;
  /** Ionicon name — resolved by the screen, kept as a plain string here. */
  icon: string;
}

/**
 * The three concepts a new user must leave with: movement, capture/defend, and
 * an honest account of what progress is (local beta, no wallet, no raw routes
 * kept). Wording avoids move-to-earn, ownership, minting, and market language.
 */
export const INTRO_STEPS: readonly IntroStepContent[] = Object.freeze([
  {
    title: "Move with purpose",
    body: "Start a foreground movement session. MovenRun measures distance, pace, and activity while the session is open.",
    ctaLabel: "See how territory works",
    icon: "walk-outline",
  },
  {
    title: "Capture and defend",
    body: "Moving through a zone can capture or strengthen it. Return before control fades to defend your ground.",
    ctaLabel: "See your progress",
    icon: "shield-half-outline",
  },
  {
    title: "Build your local legacy",
    body: "Grow XP, streaks, and territory in the local beta. Raw routes are not stored in your progress history. No wallet or minting is required.",
    ctaLabel: "Start my first move",
    icon: "flag-outline",
  },
]);

/* ── How the intro was opened, and what each exit therefore means ── */

/**
 * Why the intro is on screen. Passed as an explicit route parameter rather
 * than inferred from `router.canGoBack()`: navigation history is not intent,
 * and the two cases need genuinely different exits.
 */
export type IntroSource = "first-run" | "replay";

/** What an exit should do. Never depends on history depth. */
export type IntroExit =
  /** Mark first run complete and enter the app (Home). */
  | "complete-home"
  /** Mark first run complete and start the first movement session. */
  | "complete-move"
  /** Return to whoever pushed the intro; persisted state is untouched. */
  | "return";

/** Normalise an unknown/absent route parameter. Anything unrecognised is
 *  treated as first run, which is the only mode that can safely *complete*
 *  onboarding — a mislabelled replay would otherwise strand the user. */
export function toIntroSource(value: unknown): IntroSource {
  return value === "replay" ? "replay" : "first-run";
}

/**
 * Resolve what an exit does.
 *
 * Skip means "let me into the app", not "start a workout": in first run it
 * completes the intro and lands on Home. The final CTA is labelled
 * "Start my first move", so it does exactly that. A replay changes nothing and
 * simply returns to its caller.
 */
export function resolveIntroExit(source: IntroSource, action: "skip" | "finish"): IntroExit {
  if (source === "replay") return "return";
  return action === "skip" ? "complete-home" : "complete-move";
}

/** Whether this exit should write first-run completion. */
export function exitCompletesIntro(exit: IntroExit): boolean {
  return exit !== "return";
}

/** Screen-reader announcement when the step changes. */
export function introStepAnnouncement(step: IntroStep): string {
  const content = INTRO_STEPS[step];
  return `Step ${step + 1} of ${INTRO_STEP_COUNT}. ${content.title}. ${content.body}`;
}
