/**
 * Local onboarding questline — Free Map Beta, on-device only.
 *
 * A deterministic, read-only guide through MovenRun's local beta loop, derived
 * from existing local state (history, zones, defends, club, route trust) plus
 * two lightweight "viewed" booleans for screen-view steps. It teaches the loop;
 * it does NOT gate XP, capture, defend, fortify, clubs, or ownership, and it
 * touches no backend, network, wallet, or chain.
 */
export type StepStatus = "locked" | "ready" | "complete";

/** Semantic CTA action — resolved to a concrete route by the screen. */
export type QuestlineAction =
  | "move"
  | "zone"
  | "clubs"
  | "review"
  | "passport"
  | "proof";

export interface QuestlineStep {
  id: string;
  title: string;
  description: string;
  /** Ionicons name. */
  icon: string;
  action: QuestlineAction;
  ctaLabel: string;
  status: StepStatus;
  progressText: string;
  /** Steps 7–8 are screen-view steps; 6–8 lean "future/preview". */
  futureAccent?: boolean;
}

export interface Questline {
  steps: QuestlineStep[];
  completedCount: number;
  total: number;
  /** First not-yet-complete step (the recommended next action), or null. */
  currentStep: QuestlineStep | null;
  allComplete: boolean;
}

export interface QuestlineInput {
  /** Any completed quest/session in local history. */
  hasHistory: boolean;
  /** Real saved routes (route-trust summaries). */
  savedRoutes: number;
  zonesOwned: number;
  timesDefended: number;
  hasClub: boolean;
  /** Any route-trust signal recorded. */
  hasTrust: boolean;
  viewedPassport: boolean;
  viewedProof: boolean;
}

interface StepDef {
  id: string;
  title: string;
  description: string;
  icon: string;
  action: QuestlineAction;
  ctaLabel: string;
  done: (i: QuestlineInput) => boolean;
  progress: (i: QuestlineInput) => string;
  futureAccent?: boolean;
}

const STEP_DEFS: StepDef[] = [
  {
    id: "start-move",
    title: "Start your first move",
    description: "Begin a movement session to put yourself on the map.",
    icon: "walk-outline",
    action: "move",
    ctaLabel: "Start Move",
    done: (i) => i.hasHistory || i.savedRoutes > 0,
    progress: (i) => (i.hasHistory || i.savedRoutes > 0 ? "Done" : "Not started"),
  },
  {
    id: "save-route",
    title: "Save a real route",
    description: "Finish and save a GPS route to log your first session.",
    icon: "bookmark-outline",
    action: "move",
    ctaLabel: "Start Move",
    done: (i) => i.savedRoutes > 0,
    progress: (i) => `${i.savedRoutes} saved`,
  },
  {
    id: "capture",
    title: "Capture your first territory",
    description: "Move through a new zone to capture it locally.",
    icon: "flag-outline",
    action: "move",
    ctaLabel: "Start Move",
    done: (i) => i.zonesOwned > 0,
    progress: (i) => `${i.zonesOwned} zone${i.zonesOwned === 1 ? "" : "s"}`,
  },
  {
    id: "defend",
    title: "Defend or fortify a zone",
    description: "Refresh a zone you own by moving over it or fortifying.",
    icon: "shield-outline",
    action: "zone",
    ctaLabel: "View Territory",
    done: (i) => i.timesDefended > 0,
    progress: (i) => `${i.timesDefended} defends`,
  },
  {
    id: "club",
    title: "Join a club",
    description: "Pick a local club — your movement strengthens it.",
    icon: "people-outline",
    action: "clubs",
    ctaLabel: "Choose Club",
    done: (i) => i.hasClub,
    progress: (i) => (i.hasClub ? "Joined" : "Not joined"),
  },
  {
    id: "review-trust",
    title: "Review your route trust",
    description: "See how clean your routes look in Route Review.",
    icon: "shield-checkmark-outline",
    action: "review",
    ctaLabel: "View Route Review",
    done: (i) => i.hasTrust || i.savedRoutes > 0,
    progress: (i) => (i.hasTrust || i.savedRoutes > 0 ? "Available" : "Save a route first"),
    futureAccent: true,
  },
  {
    id: "passport",
    title: "View your Signal Passport",
    description: "Check your local GPS-quality readiness preview.",
    icon: "shield-half-outline",
    action: "passport",
    ctaLabel: "View Passport",
    done: (i) => i.viewedPassport,
    progress: (i) => (i.viewedPassport ? "Viewed" : "Not viewed"),
    futureAccent: true,
  },
  {
    id: "proof",
    title: "Preview a Route Proof",
    description: "Open a shareable local proof of a clean route.",
    icon: "share-social-outline",
    action: "proof",
    ctaLabel: "View Route Proof",
    done: (i) => i.viewedProof,
    progress: (i) => (i.viewedProof ? "Viewed" : "Not viewed"),
    futureAccent: true,
  },
];

/** Deterministically build the questline from local state. */
export function buildQuestline(input: QuestlineInput): Questline {
  const done = STEP_DEFS.map((d) => d.done(input));
  const firstIncomplete = done.findIndex((d) => !d);

  const steps: QuestlineStep[] = STEP_DEFS.map((d, idx) => {
    let status: StepStatus;
    if (done[idx]) status = "complete";
    else if (idx === firstIncomplete) status = "ready";
    else status = "locked";
    return {
      id: d.id,
      title: d.title,
      description: d.description,
      icon: d.icon,
      action: d.action,
      ctaLabel: d.ctaLabel,
      status,
      progressText: d.progress(input),
      futureAccent: d.futureAccent,
    };
  });

  const completedCount = done.filter(Boolean).length;
  const currentStep = steps.find((s) => s.status === "ready") ?? null;
  return {
    steps,
    completedCount,
    total: steps.length,
    currentStep,
    allComplete: completedCount === steps.length,
  };
}
