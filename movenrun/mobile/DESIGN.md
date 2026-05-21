# MovenRun Mobile Design System

## Color Tokens

| Token | Value | Usage |
|---|---|---|
| `--signal` | `#00FF88` | Primary action, active state, $MOVE |
| `--atmosphere` | `#7C3AED` | Zone/NFT accent, $ZONE, battles |
| `--contested` | `#FF6400` | Under-challenge state |
| `--gold` | `#F59E0B` | $MOVE coin glyph |
| `--danger` | `#EF4444` | Destructive / stop |
| `--snow` | `#F9FAFB` | Primary text |
| `--frost` | `#D1D5DB` | Secondary text |
| `--mist` | `#6B7280` | Placeholder / inactive icons |
| `--line` | `#374151` | Borders, dividers |
| `--void` | `#07070F` | Deepest background |
| `--abyss` | `#0D0D0D` | Main screen background |
| `--depth` | `#111827` | Card background |
| `--surface` | `#1F2937` | Elevated surface |
| `--glass` | `rgba(13,13,13,0.75)` | Glass panels |

## Typography

- **Headings**: Clash Display Variable (`ClashDisplay-Variable`)
- **Body / UI**: General Sans Variable (`GeneralSans-Variable`)
- **Numbers / Addresses**: Space Mono Regular (`SpaceMono-Regular`)

## Spacing Scale (4-base)

`4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64`

## Border Radius Scale

- `sm` = 12
- `md` = 16
- `lg` = 24
- `full` = 9999

## Glass Recipe

```
background: rgba(13,13,13,0.75)
backdrop-filter: blur(24px)
border: 1px solid rgba(249,250,251,0.08)
```

Use this exact recipe for all floating panels, tab bar, bottom sheets.

## Spring Config

**Standard** (buttons, cards):
```js
{ damping: 18, stiffness: 280, mass: 0.8 }
```

**Snappy** (toggles, selection indicators):
```js
{ damping: 20, stiffness: 400, mass: 0.7 }
```

**Bouncy** (celebrations, counters):
```js
{ damping: 12, stiffness: 200, mass: 0.9 }
```

## Easing Curves

- **Enter**: `cubic-bezier(0.22, 1, 0.36, 1)` — overshoot spring feel
- **Exit**: `cubic-bezier(0.55, 0, 1, 0.45)` — quick pull-away
- **Standard**: `cubic-bezier(0.4, 0, 0.2, 1)` — Material-style smooth

**Never use linear or the platform default `ease`.**

## Button Micro-interaction

1. Press down: scale → 0.96, brightness +10%, 100 ms (worklet, UI thread)
2. Release: spring back with Standard spring
3. Haptic: `ImpactFeedbackStyle.Light` on press-down
4. Disabled: 40% opacity, interaction disabled, no press animation

## Card / List Item Micro-interaction

1. Press down: scale → 0.98, `--signal` edge glow flickers in (0 → 0.4 opacity)
2. Release: spring back
3. Long-press: `ImpactFeedbackStyle.Medium` haptic + context menu

## Tab Bar

Floating glass pill, not edge-to-edge.

- Corner radius: 24
- Blur: 24
- Active tab: icon fills `--signal` + glow dot beneath + label visible
- Inactive tab: `--mist` outline icon, no label
- Active indicator: shared layout animation slides between tabs
- Center "Start Run": raised circle, `--signal → --atmosphere` gradient, breathing glow

## AnimatedNumber

- All numeric values animate on change (count-up/down)
- Font: Space Mono
- Large-number formatting: `< 1 000` → raw, `≥ 1 000` → `1,234`, `≥ 10 000` → `12.4K`, `≥ 1 000 000` → `1.2M`
- `$MOVE` always shows gold coin glyph 🪙 inline
- `$ZONE` always shows `◆` in `--atmosphere` color

## Empty States

Each empty state uses an on-brand Skia-illustrated motif, never a generic icon.

| State | Headline | Sub | Motif |
|---|---|---|---|
| No zones | "Your territory awaits." | "Start moving to claim your first zone." | Pulsing empty hex |
| No battles | "All quiet on your front." | "Your zones are secure." | Calm shield |
| No history | "Your journey starts here." | *(none)* | Dotted path |

## Accessibility

- Respect `AccessibilityInfo.isReduceMotionEnabled` — swap cinematic animations for 200 ms fades
- All text: `--snow`/`--frost` on dark backgrounds must pass WCAG AA (4.5:1)
- Minimum touch target: 44×44 pt
- Haptics respect OS haptic setting (check `AccessibilityInfo.isReduceMotionEnabled` as proxy)
