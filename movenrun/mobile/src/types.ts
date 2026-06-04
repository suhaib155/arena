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
