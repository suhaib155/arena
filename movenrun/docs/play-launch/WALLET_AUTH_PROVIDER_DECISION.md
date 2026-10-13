# Wallet sign-in: provider decision

**Date:** 13 Oct 2026 · **Decision:** keep **Supabase Web3 Auth (EIP-4361)** behind the
MovenRun API, with the wallet's own browser and EIP-6963 discovery on the web.
Do not add Reown AppKit, WalletConnect or Privy to Play v1. **Status:** engineering
decision, open to owner review. It changes nothing live.

## What was compared

Prices and limits were read from the vendors' public pages on 13 Oct 2026. They
change, so re-check them before any future switch.

| | Supabase Web3 Auth (current) | Reown AppKit React Native (WalletConnect) | Privy React Native |
|---|---|---|---|
| Source | Supabase Auth, part of the project we already use. Docs: https://supabase.com/docs/guides/auth/auth-web3 | Official Reown SDK, https://github.com/reown-com/appkit-react-native. Docs: https://docs.reown.com/appkit/react-native/core/installation | Official Privy SDK, https://docs.privy.io/ |
| Free tier | Inside Supabase Free: 50,000 monthly active auth users for the whole project | **Starter $0: 500 MAU** "for embedded wallets or SIWX"; **at the limit RPC and MAUs are cut off**. Pro $89/month for 7,500 MAU (https://reown.com/pricing) | **Free: up to 500 MAU**; Core $299/month for 500–2,499 MAU (https://www.privy.io/pricing). The page does not say whether external-wallet logins count |
| Fits 1,000 accounts at $0? | Yes | **No**: SIWX sign-in for more than 500 monthly users needs a paid plan | **No**: more than 500 monthly users needs $299/month |
| Licence | Supabase platform terms (already accepted for the project) | "Reown AppKit Community License": non-commercial use permitted, RPC and MAU thresholds for commercial licensing, a required connection to Reown's infrastructure, binding arbitration | Proprietary service terms |
| Identity model | Supabase user id, the key MovenRun already uses (D-16) | Wallet session in Reown, then still needs Supabase or our API to issue the account; a second identity system | Privy issues its own users and JWTs. Supabase third-party auth lists Clerk, Firebase, Auth0, Cognito and WorkOS, **not Privy** (https://supabase.com/docs/guides/auth/third-party/overview), so the account model would have to change |
| Expo SDK 54 / RN 0.81 | No new native module: `expo-web-browser`, `expo-crypto` (first-party, already in the build) | Needs `@walletconnect/react-native-compat`, `react-native-get-random-values`, `react-native-svg`, netinfo, a chain adapter (wagmi 2 + viem 2 or ethers). The install page names Expo SDK 53+ only, nothing for SDK 54 / RN 0.81 | Needs a development build plus `react-native-webview`, passkeys and native extensions; "React Native 0.81+ (or Expo SDK 54+)" is mentioned for optional packages |
| Who verifies the signature | Supabase Auth (EIP-4361 parse, signature, URI and domain against the redirect list, issued within 10 minutes). The MovenRun API also checks its own single-use nonce, the exact message it wrote and the signature (`ethers.verifyMessage`) **before** calling Supabase | Reown SIWX, then our server again | Privy |
| Abuse controls | Per-IP rate limit, the Before User Created hook (account cap and hourly quota, 0009), optional CAPTCHA | Vendor limits, plus ours | Vendor limits, plus ours |
| New permissions or data processors | None (Supabase is already a processor) | Reown relay and RPC: a new processor to declare in Data safety and the privacy policy | Privy: a new processor that holds user records |

A wallet-specific SDK (MetaMask SDK, Coinbase Wallet SDK) was not evaluated in
depth. Each would cover one wallet only and add native code. The selection
rule allows them only if the broader options fail.

## Why Supabase Web3 stays

1. **It is the narrowest maintained integration.** Cryptographic checks are
   done by Supabase Auth and by `ethers`, both maintained libraries. MovenRun
   writes no signature cryptography of its own. Its own code is the nonce
   store, the exact-message check and the PKCE-bound one-time code that hands
   a finished sign-in back to the app. That code is reviewed in
   `AUTH_SECURITY_REVIEW.md` and tested.
2. **It is the only option that stays at $0 for 1,000 accounts.** Reown
   Starter and Privy Free both stop at 500 monthly users.
3. **No second identity system and no new processor.** The account stays keyed
   to the Supabase user id.
4. **No new native dependency** in an app that must pass a phone gate by 24 Oct.

## What the current wallet flow is, and its limits

- **App:**
  - The app opens `https://movenrun.xyz/sign-in/?challenge=<PKCE S256>` inside MetaMask, Coinbase Wallet or Trust Wallet, using each wallet's own published HTTPS link (`metamask.app.link/dapp/…`, `go.cb-w.com/dapp?cb_url=…`, `link.trustwallet.com/open_url?…`). These are the vendors' verified app links, not links assembled from a custom scheme, and they carry only the public challenge.
  - The page asks the wallet for its address and one `personal_sign` of the message the API wrote.
  - The API returns a 12-character single-use code (about 59 bits, 5 minutes) that only the verifier held in the app's keystore can redeem.
  - The code goes back by `movenrun://auth/wallet?code=…`, or the person types it.
- **Web (deletion page):** EIP-6963 discovery picks the wallet. The person chooses when there are several, and `window.ethereum` is used only when no wallet announces itself.
- **Limits:**
  - Contract wallets (EIP-1271/6492) are refused.
  - The return link is a custom scheme. Interception yields nothing without the verifier, but see F-06 for a flow an attacker starts.
  - Whether each wallet's browser hands `movenrun://` back to the app is unproven until the phone gate (X-10).

## Fallback and cut-off

- **If wallet sign-in fails on the phone by 24 Oct (D-19):**
  - report `WALLET_LOGIN_BLOCKED`;
  - hide **Continue with Wallet** in the app, which is a one-line release-scope switch; don't fake it working;
  - keep Google and guest play;
  - ask the owner to authorise a Google-only v1 before any merge.
- **If Supabase's free limits are reached:**
  - Supabase Free counts 50,000 monthly auth users, far above the 1,000 cap.
  - The hourly quota (default 50) and the orphan sweep keep scripted wallet users from piling up.
  - No paid plan is started automatically. Any upgrade is an owner decision.
- **Revisit Reown or Privy only if** the owner approves their paid plans, or a later version needs WalletConnect-only wallets.
