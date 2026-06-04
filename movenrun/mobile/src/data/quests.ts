import type { Quest } from "@/types";

/**
 * Mock quest catalogue for the MVP. This module is the raw *data* only — all
 * access goes through `@/services/questService` (the seam where future
 * AI/server-generated quests will plug in). Screens should not import this
 * directly; import the service instead.
 */
export const QUESTS: Quest[] = [
  {
    id: "sunrise-sprint",
    title: "Sunrise Sprint",
    summary: "8 rounds of brisk movement to wake the body up.",
    description:
      "A short cardio burst to spike your heart rate and shake off the morning fog. Move at a pace that feels challenging but sustainable.",
    category: "Cardio",
    difficulty: "Medium",
    durationSeconds: 90,
    xpReward: 120,
    icon: "sunny-outline",
    instructions: [
      "March or jog in place to warm up for 15 seconds.",
      "Alternate 20s of high knees with 10s of rest.",
      "Keep your core tight and land softly.",
      "Finish with a slow walk to recover.",
    ],
  },
  {
    id: "desk-reset",
    title: "Desk Reset",
    summary: "Loosen tight hips, shoulders, and spine.",
    description:
      "Been sitting too long? This mobility flow undoes the damage of the chair and gets blood moving through stiff joints.",
    category: "Mobility",
    difficulty: "Easy",
    durationSeconds: 60,
    xpReward: 70,
    icon: "body-outline",
    instructions: [
      "Roll your shoulders back 10 times.",
      "Reach overhead and side-bend each way.",
      "Do 5 slow cat-cow spinal rolls.",
      "Open your hips with a deep standing lunge per side.",
    ],
  },
  {
    id: "core-forge",
    title: "Core Forge",
    summary: "A focused plank + hollow-hold circuit.",
    description:
      "Build a resilient midsection with isometric holds. Quality over speed — keep everything braced and breathe steadily.",
    category: "Strength",
    difficulty: "Hard",
    durationSeconds: 120,
    xpReward: 180,
    icon: "barbell-outline",
    instructions: [
      "Hold a forearm plank for 30 seconds.",
      "Rest 15 seconds.",
      "Hollow-body hold for 30 seconds.",
      "Rest, then repeat the plank once more.",
    ],
  },
  {
    id: "breath-anchor",
    title: "Breath Anchor",
    summary: "Box breathing to reset your nervous system.",
    description:
      "A calm, mindful reset. Slow your breathing to lower stress and sharpen focus. Sit or stand tall and relax your jaw.",
    category: "Mindful",
    difficulty: "Easy",
    durationSeconds: 80,
    xpReward: 60,
    icon: "leaf-outline",
    instructions: [
      "Inhale through the nose for 4 counts.",
      "Hold for 4 counts.",
      "Exhale slowly for 4 counts.",
      "Hold empty for 4 counts, then repeat.",
    ],
  },
  {
    id: "stair-climber",
    title: "Stair Climber",
    summary: "Power up real or imaginary stairs.",
    description:
      "Lower-body cardio that builds leg endurance. Use a staircase if you have one, or step-ups on a sturdy surface.",
    category: "Cardio",
    difficulty: "Medium",
    durationSeconds: 100,
    xpReward: 130,
    icon: "trending-up-outline",
    instructions: [
      "Step up leading with your right foot for 25s.",
      "Switch to leading with your left for 25s.",
      "Drive through the heel, stand tall at the top.",
      "Finish with 25s of easy marching.",
    ],
  },
];
