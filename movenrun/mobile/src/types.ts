import type { ComponentProps } from "react";
import type { Ionicons } from "@expo/vector-icons";

export type QuestCategory = "Cardio" | "Mobility" | "Strength" | "Mindful";
export type QuestDifficulty = "Easy" | "Medium" | "Hard";

export type IoniconName = ComponentProps<typeof Ionicons>["name"];

export interface Quest {
  id: string;
  title: string;
  /** Short tagline shown on cards. */
  summary: string;
  /** Longer description shown on the detail screen. */
  description: string;
  category: QuestCategory;
  difficulty: QuestDifficulty;
  /** Target duration of the active timer, in seconds. */
  durationSeconds: number;
  xpReward: number;
  icon: IoniconName;
  /** Step-by-step coaching cues shown on the detail screen. */
  instructions: string[];
}

/**
 * Context passed to the quest service when requesting quests. Today the local
 * mock service only reads `date` (to anchor the daily quest to the local day).
 * The other fields are a forward-looking seam: a future server-side, AI-driven
 * implementation could use them to personalize quests — without changing the
 * screens that call the service.
 */
export interface QuestRequestContext {
  /** Anchor date for "daily" selection. Defaults to now. */
  date?: Date;
  /** Reserved for future personalization. Unused by the mock service. */
  preferredCategories?: QuestCategory[];
}

/* ── Territory (Free Map Beta — local, on-device simulation only) ── */

export type ZoneState =
  | "unclaimed"
  | "yours"
  | "contested"
  | "dormant"
  | "deedPreview";

/**
 * A mock territory zone. Ids come from the pseudo-H3 lattice in
 * `lib/zones.ts` (real H3 indexing arrives with the live map). No ownership
 * beyond this device is implied — common zones are in-app progress only.
 */
export interface Zone {
  id: string;
  name: string;
  state: ZoneState;
  /** 0..100 — how firmly the zone is held. */
  controlPercent: number;
  /** 0..100 — placeholder until the Defend loop lands. */
  defensePercent: number;
  /** ISO timestamp of the last route touch. */
  lastTouchedAt: string;
  /** ISO timestamp of the capture. */
  capturedAt: string;
  /** ISO timestamp of the last movement defend (backfilled to capturedAt). */
  lastDefendedAt: string;
  /** ISO timestamp of the last fortify, or null if never fortified. */
  lastFortifiedAt: string | null;
  /** How many times this zone has been fortified. */
  fortifyCount: number;
  /** Future Deed-tier accent only — never an ownership claim. */
  isDeedPreview: boolean;
  /** True when produced by a demo route (never persisted as progress). */
  isDemo: boolean;
}
