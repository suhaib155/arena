/**
 * Local zone collections & badges — Free Map Beta, on-device only.
 *
 * Deterministic, read-only "preview achievements" derived entirely from
 * existing local state (captured/defended zones, fortify counts, route-trust
 * summaries, club selection, existing screen-view flags). They are **local
 * previews only** — not real rewards, tokens, NFTs, or ownership — and they
 * touch no backend, network, wallet, chain, or raw GPS. Badges gate nothing.
 */
export type BadgeStatus = "locked" | "in-progress" | "unlocked";

export type CollectionName =
  | "First Steps"
  | "Territory Keeper"
  | "Defender"
  | "Signal Runner"
  | "Club Starter"
  | "Cartographer";

export interface Badge {
  id: string;
  title: string;
  description: string;
  collection: CollectionName;
  status: BadgeStatus;
  current: number;
  target: number;
  /** Ionicons name. */
  icon: string;
  previewOnly: true;
}

export interface BadgeCollection {
  name: CollectionName;
  /** Daylight Cartography accent (theme palette hex). */
  accent: string;
  icon: string;
  badges: Badge[];
  unlocked: number;
  total: number;
}

export interface CollectionsOverview {
  collections: BadgeCollection[];
  unlocked: number;
  total: number;
  completionPct: number;
  /** Closest in-progress/locked badge to chase next, or null when all done. */
  nextBadge: Badge | null;
}

/** Everything badges read — all scalar/boolean, no GPS/coords/path. */
export interface BadgeInput {
  savedRoutes: number;
  cleanRoutes: number;
  hasStrongTrust: boolean;
  zonesCaptured: number;
  atRiskOrWorse: number;
  timesDefended: number;
  fortifyCount: number;
  hasClub: boolean;
  viewedPassport: boolean;
  viewedProof: boolean;
}

interface BadgeDef {
  id: string;
  title: string;
  description: string;
  collection: CollectionName;
  icon: string;
  target: number;
  current: (i: BadgeInput) => number;
}

const COLLECTION_META: Record<CollectionName, { accent: string; icon: string }> = {
  // Accents resolved against the theme palette by the screen via these hexes.
  "First Steps": { accent: "#246BFE", icon: "footsteps-outline" }, // Base Blue
  "Territory Keeper": { accent: "#18C987", icon: "flag-outline" }, // Pulse Green
  Defender: { accent: "#FF6B4A", icon: "shield-outline" }, // Heat Coral
  "Signal Runner": { accent: "#7657FF", icon: "pulse-outline" }, // Deed Violet
  "Club Starter": { accent: "#F7B955", icon: "people-outline" }, // MOVE Gold
  Cartographer: { accent: "#246BFE", icon: "map-outline" }, // Base Blue
};

const BADGE_DEFS: BadgeDef[] = [
  // First Steps
  { id: "first-route", title: "First Route Saved", description: "Save your first movement route.", collection: "First Steps", icon: "bookmark-outline", target: 1, current: (i) => Math.min(i.savedRoutes, 1) },
  { id: "first-capture", title: "First Zone Captured", description: "Capture your first territory zone.", collection: "First Steps", icon: "flag-outline", target: 1, current: (i) => Math.min(i.zonesCaptured, 1) },
  { id: "first-defend", title: "First Zone Defended", description: "Defend a zone by moving over it.", collection: "First Steps", icon: "shield-checkmark-outline", target: 1, current: (i) => Math.min(i.timesDefended, 1) },

  // Territory Keeper
  { id: "keep-3", title: "3 Zones Captured", description: "Hold three captured zones.", collection: "Territory Keeper", icon: "grid-outline", target: 3, current: (i) => i.zonesCaptured },
  { id: "keep-5", title: "5 Zones Captured", description: "Hold five captured zones.", collection: "Territory Keeper", icon: "grid-outline", target: 5, current: (i) => i.zonesCaptured },
  { id: "keep-10", title: "10 Zones Captured", description: "Hold ten captured zones.", collection: "Territory Keeper", icon: "apps-outline", target: 10, current: (i) => i.zonesCaptured },

  // Defender
  { id: "first-fortify", title: "First Fortify", description: "Fortify a zone for the first time.", collection: "Defender", icon: "construct-outline", target: 1, current: (i) => Math.min(i.fortifyCount, 1) },
  { id: "defend-3", title: "3 Defends", description: "Defend zones three times.", collection: "Defender", icon: "shield-half-outline", target: 3, current: (i) => i.timesDefended },
  { id: "all-healthy", title: "All Zones Healthy", description: "Keep every captured zone healthy.", collection: "Defender", icon: "checkmark-done-outline", target: 1, current: (i) => (i.zonesCaptured > 0 && i.atRiskOrWorse === 0 ? 1 : 0) },

  // Signal Runner
  { id: "strong-trust", title: "First Strong Route", description: "Record a Strong route-trust result.", collection: "Signal Runner", icon: "ribbon-outline", target: 1, current: (i) => (i.hasStrongTrust ? 1 : 0) },
  { id: "clean-3", title: "3 Clean Routes", description: "Save three routes with no risk flags.", collection: "Signal Runner", icon: "sparkles-outline", target: 3, current: (i) => i.cleanRoutes },
  { id: "passport-building", title: "Signal Passport", description: "View your Signal Passport.", collection: "Signal Runner", icon: "shield-half-outline", target: 1, current: (i) => (i.viewedPassport ? 1 : 0) },

  // Club Starter
  { id: "join-club", title: "Join a Club", description: "Pick a local club.", collection: "Club Starter", icon: "people-outline", target: 1, current: (i) => (i.hasClub ? 1 : 0) },
  { id: "club-contribution", title: "First Club Contribution", description: "Save a route while in a club.", collection: "Club Starter", icon: "trophy-outline", target: 1, current: (i) => (i.hasClub && i.savedRoutes > 0 ? 1 : 0) },

  // Cartographer
  { id: "territory-mapped", title: "Territory Mapped", description: "Build a territory of at least one zone.", collection: "Cartographer", icon: "map-outline", target: 1, current: (i) => Math.min(i.zonesCaptured, 1) },
  { id: "routes-reviewed", title: "Routes Reviewed", description: "Build your route review history.", collection: "Cartographer", icon: "list-outline", target: 1, current: (i) => Math.min(i.savedRoutes, 1) },
  { id: "proof-shared", title: "Route Proof Viewed", description: "Open a local Route Proof preview.", collection: "Cartographer", icon: "share-social-outline", target: 1, current: (i) => (i.viewedProof ? 1 : 0) },
];

const COLLECTION_ORDER: CollectionName[] = [
  "First Steps",
  "Territory Keeper",
  "Defender",
  "Signal Runner",
  "Club Starter",
  "Cartographer",
];

function statusFor(current: number, target: number): BadgeStatus {
  if (current >= target) return "unlocked";
  if (current > 0) return "in-progress";
  return "locked";
}

/** Deterministically build collections from local state. */
export function buildCollections(input: BadgeInput): CollectionsOverview {
  const badges: Badge[] = BADGE_DEFS.map((d) => {
    const current = Math.min(d.current(input), d.target);
    return {
      id: d.id,
      title: d.title,
      description: d.description,
      collection: d.collection,
      status: statusFor(current, d.target),
      current,
      target: d.target,
      icon: d.icon,
      previewOnly: true,
    };
  });

  const collections: BadgeCollection[] = COLLECTION_ORDER.map((name) => {
    const group = badges.filter((b) => b.collection === name);
    return {
      name,
      accent: COLLECTION_META[name].accent,
      icon: COLLECTION_META[name].icon,
      badges: group,
      unlocked: group.filter((b) => b.status === "unlocked").length,
      total: group.length,
    };
  });

  const unlocked = badges.filter((b) => b.status === "unlocked").length;
  const total = badges.length;
  // Next badge: closest to completion among not-yet-unlocked (in-progress first).
  const nextBadge =
    [...badges]
      .filter((b) => b.status !== "unlocked")
      .sort((a, b) => b.current / b.target - a.current / a.target)[0] ?? null;

  return {
    collections,
    unlocked,
    total,
    completionPct: total > 0 ? Math.round((unlocked / total) * 100) : 0,
    nextBadge,
  };
}
