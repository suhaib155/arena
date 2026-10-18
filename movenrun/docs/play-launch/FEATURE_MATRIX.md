# Play v1 feature matrix

Scope: **Path A, Movement Game v1** (see `DECISIONS.md` D-01). The switchboard is
`mobile/src/lib/releaseScope.ts`; `mobile/src/lib/__tests__/releaseScope.test.ts`
keeps every deferred surface unreachable. Deferred screens are preserved in
source, not deleted.

**Frontend on owner hold (D-25, 2026-10-13).** This matrix describes the app
as it is. No screen, visual, navigation or copy change is made until the
owner's next design brief. Separate Google and wallet accounts were accepted by
the owner on 2026-10-13 (X-20).

| Screen / feature | Route | v1 | Authority | Data source | User-facing copy |
|---|---|---|---|---|---|
| First run: opening, welcome, onboarding | `/opening`, `/welcome`, `/onboarding` | ON | Device | Local first-run state | Movement game intro; Continue with Google, Continue with Wallet, or Start exploring as a guest |
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
| Account sign-in: Continue with Google | `/account`, `/welcome`, `movenrun://auth/callback` | ON when `EXPO_PUBLIC_API_URL` and the Supabase public settings are set; the button is hidden otherwise | Supabase Auth, then server | Supabase `/authorize` + `/token?grant_type=pkce`, then `/identity/auth/google/complete` | "Google and wallet sign-ins are separate accounts" |
| Account sign-in: Continue with Wallet | `/account`, `/welcome`, `movenrun://auth/wallet`, web `/sign-in/` | ON when `EXPO_PUBLIC_API_URL` is set | Server, then Supabase Auth Web3 | `/identity/auth/wallet/begin|complete|exchange` | One message signature, no transaction, no fee, never a recovery phrase; code entry fallback |
| Email one-time codes | — | **OFF** (D-16) | n/a | Routes not mounted without a delivery key | Not shown |
| Account security, sessions, sign out, **delete account** | `/account/security` | ON | Server (+ provider user removed at Supabase) | `/identity/sessions`, `/identity/account/delete` | "removes your Google or wallet sign-in record" |
| Help, Legal (Terms, Privacy) | `/help`, `/legal` | ON | Static | In-app copy | Deeds and Clubs guides hidden |
| Technical info | `/settings/technical` | ON | Device | Build/connection info | |
| Clubs tab, club territory, crew missions | `/clubs`, `/club-territory`, `/crew-missions` | **OFF** (`clubs`) | n/a | Seeded club catalogue | Unreachable; route guard redirects home |
| City war, rivals, city districts, district mastery, event zones, sponsor zones | `/city-war`, `/rivals`, `/city-districts`, `/district-mastery`, `/event-zones`, `/sponsor-zones` | **OFF** (`competition`) | n/a | Local simulation / seeds | Unreachable |
| Deed showroom | `/deed-showroom` | **OFF** (`deeds`) | n/a | Preview | Unreachable |
| Wallet management, network/contract status | `/account/wallets`, `/network/status` | **OFF** (`wallets`) | n/a | Testnet preview | Unreachable. A wallet is a sign-in method only |

Backend surfaces used by v1: `/health`, `/ready`,
`/identity/auth/google/complete`, `/identity/auth/wallet/begin|complete|exchange`,
`/identity/auth/refresh`, `/identity/me`, `/identity/sessions*`,
`/identity/session/*`, `/identity/account/delete`, `/movement/verify`,
`/movement/verifications`. Email-code routes are not mounted (D-16). Wallet
*linking* and embedded-wallet routes exist server-side but no v1 client path
reaches them and no wallet row is ever created in v1.

Website surfaces: `/privacy/`, `/support/`, `/account-deletion/` (Google or
wallet sign-in, then delete), `/sign-in/` (wallet sign-in for the app; no
indexing; returns codes only to `movenrun://auth/wallet`).
