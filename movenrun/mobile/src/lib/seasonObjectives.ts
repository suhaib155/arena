/**
 * Local season objectives — Free Map Beta, on-device only.
 *
 * Deterministic, read-only weekly gameplay goals derived entirely from existing
 * local state (movement/route summaries, captured zones + health, defend/fortify
 * counts, club selection, streak, and the existing route-screen view flags). They
 * are **local previews only** — not real rewards, tokens, NFTs, ownership, or
 * earning — and they touch no backend, network, wallet, chain, or raw GPS.
 * Objectives gate nothing: they suggest what to do next, that's all.
 *
 * The model takes plain scalar/boolean inputs (same posture as
 * `buildCollections` / `buildQuestline`) so it stays pure and testable; the
 * screen feeds it values derived from existing helpers (weekly recap, zone
 * status, collections).
 */
export type ObjectiveStatus = "locked" | "active" | "complete";

export type ObjectiveGroupKey =
  | "movement"
  | "territory"
  | "defense"
  | "signal"
  | "club"
  | "review";

/** Semantic CTA — resolved to a concrete route by the screen. */
export type ObjectiveAction =
  | "move"
  | "map"
  | "alerts"
  | "passport"
  | "review"
  | "clubs"
  | "recap"
  | "collections";

export interface SeasonObjective {
  id: string;
  title: string;
  description: string;
  group: ObjectiveGroupKey;
  status: ObjectiveStatus;
  current: number;
  target: number;
  /** Short status chip, e.g. "1/3", "Complete", "Locked". */
  progressLabel: string;
  ctaLabel: string;
  action: ObjectiveAction;
  /** Higher = surfaced sooner; drives ordering + the "next objective". */
  priority: number;
  /** Daylight Cartography accent (theme palette hex). */
  accent: string;
  /** Ionicons name. */
  icon: string;
  /** Always true — these are local previews and reward nothing. */
  previewOnly: true;
}

export interface ObjectiveGroup {
  key: ObjectiveGroupKey;
  label: string;
  accent: string;
  icon: string;
  objectives: SeasonObjective[];
  completed: number;
  total: number;
}

export interface SeasonObjectivesOverview {
  /** Static season label, e.g. "This week's season". */
  seasonLabel: string;
  /** Human date range for the week, e.g. "Jun 18 – Jun 24". */
  rangeLabel: string;
  objectives: SeasonObjective[];
  groups: ObjectiveGroup[];
  completed: number;
  total: number;
  /** 0..100. */
  progressPct: number;
  /** Highest-priority active objective, or null when all complete. */
  nextObjective: SeasonObjective | null;
  /** Whether the user has any progress to show (drives the empty state). */
  hasActivity: boolean;
  /** One-line, safe summary for compact chips. */
  summaryLine: string;
}

/** Everything objectives read — all scalar/boolean, no GPS/coords/path. */
export interface SeasonObjectivesInput {
  /** Routes saved within the recap week (e.g. weeklyRecap.routes). */
  routesThisWeek: number;
  /** Total saved route reviews (routeTrustHistory length). */
  savedRoutes: number;
  hasStrongTrust: boolean;
  zonesOwned: number;
  /** Zones that are not fully healthy (atRisk/contested/dormant). */
  atRiskOrWorse: number;
  timesDefended: number;
  fortifyCount: number;
  hasClub: boolean;
  streak: number;
  viewedPassport: boolean;
  viewedProof: boolean;
  /** Any movement logged within the recap week (weeklyRecap.hasActivity). */
  weeklyActive: boolean;
  /** Local collection badges unlocked (buildCollections().unlocked). */
  collectionsUnlocked: number;
  now?: number;
}

const GROUP_META: Record<ObjectiveGroupKey, { label: string; accent: string; icon: string }> = {
  // Accents resolved against the theme palette by the screen via these hexes.
  movement: { label: "Movement", accent: "#246BFE", icon: "walk-outline" }, // Base Blue
  territory: { label: "Territory", accent: "#18C987", icon: "flag-outline" }, // Pulse Green
  defense: { label: "Defense", accent: "#FF6B4A", icon: "shield-outline" }, // Heat Coral
  signal: { label: "Signal", accent: "#7657FF", icon: "pulse-outline" }, // Deed Violet
  club: { label: "Club", accent: "#F7B955", icon: "people-outline" }, // MOVE Gold
  review: { label: "Review", accent: "#246BFE", icon: "map-outline" }, // Base Blue
};

const GROUP_ORDER: ObjectiveGroupKey[] = [
  "movement",
  "territory",
  "defense",
  "signal",
  "club",
  "review",
];

const ACTION_CTA: Record<ObjectiveAction, string> = {
  move: "Start Move",
  map: "View Map",
  alerts: "Open Alerts",
  passport: "View Passport",
  review: "Open Review",
  clubs: "Choose Club",
  recap: "Open Recap",
  collections: "View Collections",
};

interface ObjectiveDef {
  id: string;
  title: string;
  description: string;
  group: ObjectiveGroupKey;
  action: ObjectiveAction;
  icon: string;
  target: number;
  priority: number;
  current: (i: SeasonObjectivesInput) => number;
  /** Prerequisite gate — false ⇒ locked until met. Defaults to always unlocked. */
  unlocked?: (i: SeasonObjectivesInput) => boolean;
  /** Optional CTA override (otherwise the action default). */
  ctaLabel?: string;
}

const OBJECTIVE_DEFS: ObjectiveDef[] = [
  // Movement
  {
    id: "move-week-1",
    title: "Complete a route this week",
    description: "Start a move and save one route to open your season.",
    group: "movement",
    action: "move",
    icon: "navigate-outline",
    target: 1,
    priority: 100,
    current: (i) => Math.min(i.routesThisWeek, 1),
  },
  {
    id: "move-week-3",
    title: "Complete 3 routes this week",
    description: "Keep moving — three saved routes this week.",
    group: "movement",
    action: "move",
    icon: "navigate-outline",
    target: 3,
    priority: 70,
    current: (i) => i.routesThisWeek,
    unlocked: (i) => i.routesThisWeek >= 1,
  },
  {
    id: "streak-3",
    title: "Build a 3-day streak",
    description: "Move on three different days to build your streak.",
    group: "movement",
    action: "move",
    icon: "flame-outline",
    target: 3,
    priority: 65,
    current: (i) => i.streak,
  },

  // Territory
  {
    id: "capture-1",
    title: "Capture your first zone",
    description: "Move through new ground to capture a local zone.",
    group: "territory",
    action: "move",
    icon: "flag-outline",
    target: 1,
    priority: 95,
    current: (i) => Math.min(i.zonesOwned, 1),
  },
  {
    id: "hold-3",
    title: "Hold 3 zones",
    description: "Grow your local territory to three zones.",
    group: "territory",
    action: "move",
    icon: "grid-outline",
    target: 3,
    priority: 60,
    current: (i) => i.zonesOwned,
    unlocked: (i) => i.zonesOwned >= 1,
  },
  {
    id: "all-healthy",
    title: "Keep all zones healthy",
    description: "Have every captured zone in good shape at once.",
    group: "territory",
    action: "map",
    icon: "checkmark-done-outline",
    target: 1,
    priority: 55,
    current: (i) => (i.zonesOwned > 0 && i.atRiskOrWorse === 0 ? 1 : 0),
    unlocked: (i) => i.zonesOwned >= 1,
  },

  // Defense
  {
    id: "defend-1",
    title: "Defend a zone",
    description: "Move over a zone you hold to refresh its defense.",
    group: "defense",
    action: "alerts",
    icon: "shield-checkmark-outline",
    target: 1,
    priority: 80,
    current: (i) => Math.min(i.timesDefended, 1),
    unlocked: (i) => i.zonesOwned >= 1,
  },
  {
    id: "fortify-1",
    title: "Fortify a zone",
    description: "Fortify a zone from its detail screen to add a buffer.",
    group: "defense",
    action: "map",
    icon: "construct-outline",
    target: 1,
    priority: 50,
    current: (i) => Math.min(i.fortifyCount, 1),
    unlocked: (i) => i.zonesOwned >= 1,
  },
  {
    id: "defend-3",
    title: "Defend 3 times",
    description: "Keep your territory strong with three defends.",
    group: "defense",
    action: "alerts",
    icon: "shield-half-outline",
    target: 3,
    priority: 45,
    current: (i) => i.timesDefended,
    unlocked: (i) => i.timesDefended >= 1,
  },

  // Signal
  {
    id: "save-review-1",
    title: "Save a route review",
    description: "Build your local route history with one review.",
    group: "signal",
    action: "move",
    icon: "bookmark-outline",
    target: 1,
    priority: 75,
    current: (i) => Math.min(i.savedRoutes, 1),
  },
  {
    id: "strong-trust",
    title: "Reach strong route trust",
    description: "Record a Strong route-trust result once.",
    group: "signal",
    action: "review",
    icon: "ribbon-outline",
    target: 1,
    priority: 40,
    current: (i) => (i.hasStrongTrust ? 1 : 0),
    unlocked: (i) => i.savedRoutes >= 1,
  },
  {
    id: "view-passport",
    title: "View your Signal Passport",
    description: "Check your local GPS-quality readiness preview.",
    group: "signal",
    action: "passport",
    icon: "shield-half-outline",
    target: 1,
    priority: 35,
    current: (i) => (i.viewedPassport ? 1 : 0),
  },

  // Club
  {
    id: "join-club",
    title: "Join a club",
    description: "Pick a local club — your movement strengthens it.",
    group: "club",
    action: "clubs",
    icon: "people-outline",
    target: 1,
    priority: 72,
    current: (i) => (i.hasClub ? 1 : 0),
  },
  {
    id: "club-contribute",
    title: "Contribute to your club",
    description: "Save a route while in a club to add local contribution.",
    group: "club",
    action: "clubs",
    icon: "trophy-outline",
    target: 1,
    priority: 38,
    current: (i) => (i.hasClub && i.savedRoutes > 0 ? 1 : 0),
    unlocked: (i) => i.hasClub,
  },

  // Review / Progress
  {
    id: "open-recap",
    title: "Open your Weekly Recap",
    description: "See your movement week summarized locally.",
    group: "review",
    action: "recap",
    icon: "bar-chart-outline",
    target: 1,
    priority: 42,
    current: (i) => (i.weeklyActive ? 1 : 0),
  },
  {
    id: "unlock-badge",
    title: "Unlock a collection badge",
    description: "Unlock one local preview badge in Collections.",
    group: "review",
    action: "collections",
    icon: "ribbon-outline",
    target: 1,
    priority: 36,
    current: (i) => Math.min(i.collectionsUnlocked, 1),
  },
  {
    id: "preview-proof",
    title: "Preview a Route Proof",
    description: "Open a shareable local proof from Route Review.",
    group: "review",
    action: "review",
    icon: "share-social-outline",
    target: 1,
    priority: 34,
    current: (i) => (i.viewedProof ? 1 : 0),
    unlocked: (i) => i.savedRoutes >= 1,
    ctaLabel: "Open Review",
  },
];

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "Jun 18" — deterministic, locale-independent. */
function shortDate(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function progressLabelFor(status: ObjectiveStatus, current: number, target: number): string {
  if (status === "complete") return "Complete";
  if (status === "locked") return "Locked";
  if (target > 1) return `${Math.min(current, target)}/${target}`;
  return "To do";
}

/** Deterministically build the season objectives from local state. */
export function buildSeasonObjectives(input: SeasonObjectivesInput): SeasonObjectivesOverview {
  const now = input.now ?? Date.now();

  const objectives: SeasonObjective[] = OBJECTIVE_DEFS.map((d) => {
    const raw = d.current(input);
    const current = Math.max(0, Math.min(raw, d.target));
    const isComplete = raw >= d.target;
    const isUnlocked = d.unlocked ? d.unlocked(input) : true;
    const status: ObjectiveStatus = isComplete
      ? "complete"
      : isUnlocked
        ? "active"
        : "locked";
    const meta = GROUP_META[d.group];
    return {
      id: d.id,
      title: d.title,
      description: d.description,
      group: d.group,
      status,
      current,
      target: d.target,
      progressLabel: progressLabelFor(status, current, d.target),
      ctaLabel: d.ctaLabel ?? ACTION_CTA[d.action],
      action: d.action,
      priority: d.priority,
      accent: meta.accent,
      icon: d.icon,
      previewOnly: true,
    };
  });

  const groups: ObjectiveGroup[] = GROUP_ORDER.map((key) => {
    const group = objectives.filter((o) => o.group === key);
    return {
      key,
      label: GROUP_META[key].label,
      accent: GROUP_META[key].accent,
      icon: GROUP_META[key].icon,
      objectives: group,
      completed: group.filter((o) => o.status === "complete").length,
      total: group.length,
    };
  });

  const completed = objectives.filter((o) => o.status === "complete").length;
  const total = objectives.length;
  const nextObjective =
    objectives
      .filter((o) => o.status === "active")
      .sort((a, b) => b.priority - a.priority)[0] ?? null;

  const summaryLine = nextObjective
    ? `${completed}/${total} done · Next · ${nextObjective.title}`
    : completed === total
      ? `All ${total} objectives complete this season`
      : `${completed}/${total} done`;

  return {
    seasonLabel: "This week's season",
    rangeLabel: `${shortDate(now - 6 * 86_400_000)} – ${shortDate(now)}`,
    objectives,
    groups,
    completed,
    total,
    progressPct: total > 0 ? Math.round((completed / total) * 100) : 0,
    nextObjective,
    hasActivity: completed > 0,
    summaryLine,
  };
}
