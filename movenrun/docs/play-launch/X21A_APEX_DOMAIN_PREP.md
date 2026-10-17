# X-21a: make `movenrun.xyz` the primary website domain (prepared, not applied)

Written 17 Oct 2026 under A4 of the owner's continuation document. This is
the apex correction only. It does not publish the review website, change what
the live site shows, add `www` to the API's allowed origins, or change DNS.

## What is live now (read only, 17 Oct, E-59)

| Address | Result |
|---|---|
| `https://movenrun.xyz/` | 308 → `https://www.movenrun.xyz/` |
| `http://movenrun.xyz/` | 308 → `https://movenrun.xyz/` |
| `https://www.movenrun.xyz/` | 200, served by Vercel, HSTS on |
| `https://movenrun.xyz/sign-in/` | 308 → `www` |
| `https://www.movenrun.xyz/privacy/` | 404 (the live site is an older version than the review draft) |
| Apex certificate | `CN=movenrun.xyz`, valid to 7 Dec 2026 |

The API allows only `https://movenrun.xyz` (E-55), and wallets check that
the sign-in message's domain matches the page. With `www` as the primary
domain, web sign-in and deletion would fail from the page people land on.
The fix is the redirect direction, not a wider CORS list.

## The change (owner, in Vercel; about two minutes)

1. Vercel → the project serving `movenrun.xyz` → Settings → Domains. Check
   it is the MovenRun website project and that both `movenrun.xyz` and
   `www.movenrun.xyz` are listed there with valid configuration.
2. On `movenrun.xyz`: remove its redirect so it serves the project
   (Edit → "No redirect"), and make it the primary domain if offered.
3. On `www.movenrun.xyz`: Edit → Redirect to `movenrun.xyz`, status
   **308 Permanent Redirect**.
4. If Vercel asks for a DNS record change, stop and send me what it shows;
   no DNS record is changed in this step.

This changes only which name serves the same deployment; the content
(including the missing privacy page) stays exactly as it is today.

## Checks afterwards (read only, from here)

- `https://movenrun.xyz/` 200; `https://www.movenrun.xyz/` 308 → apex,
  paths kept (`/sign-in/` → `https://movenrun.xyz/sign-in/`).
- HSTS still sent; apex certificate valid.
- API preflight from `https://movenrun.xyz` allowed, from `www` still none.

## Rollback

Reverse steps 2 and 3 (apex redirects 308 to `www`, `www` serves). No DNS
change, so it takes effect at once.

## Not part of X-21a

Publishing the review website (#108, #113, A5 repairs), filling the API and
Supabase values in the site, and the HTTPS App Link (X-23) remain X-21 and
need their own approval.
