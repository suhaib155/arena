# Play v1 feature matrix

Scope: **Path A, Movement Game v1** (see `DECISIONS.md` D-01). The switchboard is
`mobile/src/lib/releaseScope.ts`; `mobile/src/lib/__tests__/releaseScope.test.ts`
keeps every deferred surface unreachable. Deferred screens are preserved in
source, not deleted.

| Screen / feature | Route | v1 | Authority | Data source | User-facing copy |
|---|---|---|---|---|---|
| First run: opening, welcome, onboarding | `/opening`, `/welcome`, `/onboarding` | ON | Device | Local first-run state | Movement game intro; sign-in optional |
| Home task board | `/` | ON | Device | `lib/tasks.ts` from local history | No club milestone in v1 |
| Move: Free Run and quest selection | `/move` | ON | Device | Foreground GPS | Foreground location rationale before permission |
| Live session map and route | `/move/session` | ON | Device (canonical GPS acquisition, pause gaps, sealing unchanged) | expo-location foreground watch, Google Maps | Live distance, time, pause |
| Summary, share image, Back confirmation | `/move/summary` | ON | Device; server when signed in | Session in memory; verification API | Local / pending / verified / not eligible states |
| Captured ground note | `/move/captured` | ON | Device | Local zones | "Personal preview kept on this device… not ownership… never pays out" |
| Quests and quest detail | `/quests`, `/quest/[id]` | ON | Device | `data/quests.ts` | XP once per day, no XP for early finish |
| Territory map (personal ground) | `/territory/map` | ON (informational) | Device | Player's own local zones | Labelled "Preview"; no other players |
| Zone detail, alerts | `/zone/[id]`, `/territory/alerts` | ON (informational) | Device | Local zones | Deed preview card hidden |
| Collections, weekly recap, season objectives, questline | `/collections`, `/weekly-recap`, `/season-objectives`, `/questline` | ON | Device | Local history | Club items removed in v1 |
| Route passport, proof, review history | `/route/*` | ON | Device | Route summaries without coordinates | |
| Profile | `/profile` | ON | Device + account | Local + `/identity/me` | Club, district, deed rows hidden |
| Account sign-in (email OTP) | `/account` | ON when `EXPO_PUBLIC_API_URL` is set | Server | `/identity/auth/email/*` | Wallet card hidden in v1 |
| Account security, sessions, sign out, **delete account** | `/account/security` | ON | Server | `/identity/sessions`, `/identity/account/delete` | Non-custodial wallet note hidden |
| Help, Legal (Terms, Privacy) | `/help`, `/legal` | ON | Static | In-app copy | Deeds and Clubs guides hidden |
| Technical info | `/settings/technical` | ON | Device | Build/connection info | |
| Clubs tab, club territory, crew missions | `/clubs`, `/club-territory`, `/crew-missions` | **OFF** (`clubs`) | n/a | Seeded club catalogue | Unreachable; route guard redirects home |
| City war, rivals, city districts, district mastery, event zones, sponsor zones | `/city-war`, `/rivals`, `/city-districts`, `/district-mastery`, `/event-zones`, `/sponsor-zones` | **OFF** (`competition`) | n/a | Local simulation / seeds | Unreachable |
| Deed showroom | `/deed-showroom` | **OFF** (`deeds`) | n/a | Preview | Unreachable |
| Wallets, network/contract status | `/account/wallets`, `/network/status` | **OFF** (`wallets`) | n/a | Testnet preview | Unreachable |

Backend surfaces used by v1: `/health`, `/ready`, `/identity/auth/email/begin|complete`,
`/identity/auth/refresh`, `/identity/me`, `/identity/sessions*`, `/identity/session/*`,
`/identity/account/delete`, `/movement/verify`. Wallet routes exist server-side
but no v1 client path reaches them, and no provider is wired (they fail closed).
