# Google Play store listing (draft, English)

Describes only what the v1 build does. No tokens, payouts, ownership, wallets,
NFTs, clubs or multiplayer competition.

**App name (30):** MovenRun

**Short description (80):** Turn everyday walks and runs into missions and real-world progress.
(67 characters)

**Full description (≤ 4000):**

> MovenRun turns your everyday walks and runs into a game played on the real map.
>
> Start a Free Run or pick a mission, head outside, and watch your route draw itself on the map as you move. Pause when you need to and pick up where you left off: paused time and distance never count. When you finish, MovenRun shows an honest summary of your session: distance, time and the route you actually took.
>
> MISSIONS AND PROGRESS
> • Daily missions that reward real movement with XP
> • Levels, streaks and badges that grow with every session you complete
> • Standing still or ending a mission early earns nothing, so progress always means you moved
>
> YOUR GROUND
> • See the parts of your neighbourhood you have explored, as a personal map preview on your phone
> • Revisit your history and route summaries at any time
>
> SHARE YOUR ROUTE
> • Create a route image to share with friends; your start and end points are hidden by default
>
> PRIVACY FIRST
> • Location is used only while the app is open and a session is running. MovenRun never tracks you in the background
> • Play without an account, or sign in with your email to save verified sessions
> • Delete your account and its data at any time, in the app or on the web
> • No ads
>
> MovenRun is a game. Distances and timers are estimates for play, not medical or navigation advice. Always move safely and stay aware of your surroundings.

**Release notes (v1.0.0):**

> Welcome to MovenRun 1.0. Turn walks and runs into missions, track real routes on the map, earn XP and badges, and share your route.

**Tags (choose up to 5 in the console):** Adventure, Walking, Running, Outdoor, Casual. REQUIRES_OWNER/CONSOLE_CONFIRMATION (pick from Play's list).

## Graphics

| Asset | File | Spec | Status |
|---|---|---|---|
| App icon | `store-assets/play-icon-512.png` | 512×512 PNG, 32-bit, < 1 MB | Ready (validated by `nativeAssets.test.ts`) |
| Feature graphic | `store-assets/feature-graphic-1024x500.png` | 1024×500 PNG, no alpha, < 1 MB | Ready (validated) |
| Phone screenshots | `store-assets/screenshots/` | 2–8, 16:9 or 9:16, 320–3840 px sides | **BLOCKED_EXTERNAL**: must be captured from the Play-bound build on a phone. Checklist below |

Artwork source: `store-assets/render-artwork.mjs` (Daylight Cartography palette, Sora and Plus Jakarta Sans fonts from the app).

## Screenshot capture checklist (from the production or Play internal-test build)

Use a phone at 1080×2340 or similar, light mode, no notifications, battery and clock tidy. Do not show a home address, an email, or real coordinates of a private place: walk in a public park or street. Never fabricate history.

1. Home task board after one real session (mission card visible).
2. Live session: route drawing on the Google map with distance and time.
3. Session summary with the route and the verified/pending state.
4. Share image preview (endpoints hidden).
5. Quests list.
6. Profile with level, streak and badges.
7. Territory map showing the personal "Preview" ground.
8. Account security with the Delete account section (optional).

Save as `store-assets/screenshots/01-home.png` … in that order.
