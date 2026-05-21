# MovenRun Design System

## Aesthetic Direction: "Cinematic Cartography"
Dark, premium, satellite-grade. The feeling of commanding a living planet from orbit.
Think: Google Earth's awe + a strategy game's territory map (Risk/Civ) + a premium
fitness wearable app (Whoop/Strava). The planet is the hero. Hexes glow like circuitry
over real terrain. Motion is weighty and cinematic, never bouncy or toy-like.

## Core Principle
The map IS the product. Chrome (UI) floats above it as translucent glass. Never let
flat panels cover the globe — everything is a floating layer with blur and depth.

## Color Tokens
--void:        #050608   (deepest background, space)
--abyss:       #0A0D12   (panel backgrounds)
--slate:       #141921   (elevated surfaces)
--slate-hi:    #1E2530   (cards, glass panels)
--line:        #2A3340   (hairline borders)
--mist:        #6B7689   (muted text)
--frost:       #A8B3C4   (secondary text)
--snow:        #EDF1F7   (primary text)

--signal:      #00E5C7   (primary accent — teal, "your" zones, active GPS)
--signal-glow: #00E5C7 at 40% (glow halos)
--ember:       #FF6B35   (contested/battle — warm orange)
--gold:        #FFB800   ($MOVE token, rewards, achievements)
--violet:      #7B61FF   ($ZONE governance, premium)
--enemy:       #FF3D6E   (enemy-owned zones, threats)
--atmosphere:  #4A9EFF   (Earth's atmospheric rim glow)

## Typography
Display:  "Clash Display" (Fontshare, free) — geometric, confident, for numbers & titles
Body:     "General Sans" (Fontshare, free) — clean, legible, for UI text
Mono:     "Space Mono" — for coordinates, hex IDs, token amounts

Scale (using react-native responsive units):
- hero: 48 / Clash Display Bold
- h1: 32 / Clash Display Semibold
- h2: 24 / Clash Display Medium
- title: 18 / General Sans Semibold
- body: 15 / General Sans Regular
- caption: 13 / General Sans Medium
- mono-sm: 12 / Space Mono (coordinates, hex IDs)

## Motion Language
Easing — use these exact curves (react-native-reanimated Easing):
- standard: Easing.bezier(0.25, 0.1, 0.25, 1)        — most transitions
- decel:    Easing.bezier(0.05, 0.7, 0.1, 1)         — entering elements
- accel:    Easing.bezier(0.3, 0, 0.8, 0.15)         — exiting elements
- cinematic:Easing.bezier(0.65, 0, 0.35, 1)          — globe fly-to, big moments
- spring:   { damping: 18, stiffness: 140, mass: 1 } — interactive feedback

Durations:
- micro: 150ms (taps, toggles)
- short: 250ms (cards, sheets)
- medium: 400ms (screen transitions)
- long: 800ms (globe movements)
- cinematic: 2200ms (launch fly-to)

Rules:
- ALL animations run on the UI thread (useNativeDriver / Reanimated worklets). Never JS-driven.
- Target 120fps on ProMotion devices, 60fps floor everywhere.
- No animation blocks interaction. User can always interrupt a fly-to by touching.
- Stagger list reveals by 40ms per item, max 8 items animated, rest appear instantly.

## Glass / Depth System
Floating panels use:
- background: --slate-hi at 72% opacity
- expo-blur: intensity 40, tint "dark"
- border: 1px --line at 50%
- border-radius: 24 (panels), 16 (cards), 12 (chips)
- shadow: { color: #000, opacity: 0.5, radius: 30, offset: {0, 12} }
- inner top highlight: 1px linear gradient white 8% → transparent

## Spacing
Base unit 4. Use 4/8/12/16/20/24/32/48/64. Screen padding: 20. Card padding: 16.

## Libraries (install these)
- @rnmapbox/maps          — 3D globe projection map (THE core)
- react-native-reanimated — all animation (v3+)
- react-native-gesture-handler
- moti                    — declarative animation wrapper over reanimated
- @shopify/react-native-skia — hex glow, particles, custom graphics, shimmer
- expo-blur               — glass panels
- expo-linear-gradient    — gradients, atmosphere
- lottie-react-native     — complex vector animations (loading, celebrations)
- @gorhom/bottom-sheet    — the floating bottom sheet
- expo-haptics            — tactile feedback on every key action
