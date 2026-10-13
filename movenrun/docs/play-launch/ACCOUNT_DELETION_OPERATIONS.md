# Account deletion by email: operations runbook

**Status: BLOCKED_OWNER_PROOF.** The public sentence "We complete the deletion
within 30 days and reply when it is done." on `/account-deletion/` is marked in
the page source with a `BLOCKED_OWNER_PROOF` comment. It may be published only
after every item in the proof checklist below has evidence attached. Until
then, publishing is not approved (X-21 is not approved).

In-app deletion (Profile → Account → Account security → Delete account) and
web deletion (`/account-deletion/`, signing in with Google or the wallet) are
the primary routes. Email is the fallback for people who can no longer sign in.

## Runbook: handling one email request

1. **Receive.** Requests arrive at `info@movenrun.xyz`, usually with the
   subject "Delete my MovenRun account".
2. **Open a ticket.** Give the request a ticket id (for example
   `DEL-2026-0001`) and record it in the deletion log the same working day.
3. **Acknowledge.** Reply from `info@movenrun.xyz`, signed "Team MovenRun",
   quoting the ticket id. Do not promise a date in the reply until the 30-day
   commitment is approved.
4. **Verify ownership** (see rules below). Never ask for a password, recovery
   phrase, private key, a signed message, a signature or a sign-in code, and
   never accept one if it is sent anyway: tell the person to treat it as
   compromised.
5. **Delete** the account so that the result matches in-app deletion: the
   account row, its sign-in identity at the provider, every session and every
   saved session summary are removed. The repository has no operator-side
   deletion command today; the owner must define and test one (or a written
   database procedure) as part of checklist item (c) before relying on it.
6. **Confirm.** Reply that the account and its data have been deleted, quoting
   the ticket id.
7. **Log** the completion date against the ticket.

### Ownership rules

- **Google accounts.** The request must come from the same Google email
  address that is on the account. Check the actual sender and the reply-to
  header; if they differ, or the sender is not the account's address, reply
  to the account's address (not the sender) asking the owner to confirm, or
  point them to in-app or web deletion. Never ask for the Google password.
- **Wallet-only accounts.** These have no email address, so an email can never
  prove ownership. Do not delete on the strength of an email that names a
  wallet address. Direct the person to in-app deletion or to
  `/account-deletion/`, where they sign in with their wallet and delete it
  themselves. Never ask them to send a recovery phrase, private key, a
  signature, a signed message or a sign-in code.
- If ownership cannot be established, close the ticket as "not verified",
  with the reason, and tell the person which self-service route to use.

## Proof checklist (owner must complete before the 30-day line is published)

| # | Item | Evidence required | Status |
|---|---|---|---|
| a | `info@movenrun.xyz` receives mail | A test message sent from an outside address, received, with date and headers (redact personal data) | Open |
| b | Every request gets a ticket id and an acknowledgement | The ticket id format, where tickets live, and one test request acknowledged end to end | Open |
| c | Ownership verification works as above | Written procedure adopted by the mailbox staff; one Google test request verified by sender/reply-to; one wallet-only test request redirected to in-app/web deletion without any secret requested | Open |
| d | Deletion log exists | A log with: ticket id, date received, date completed, outcome. No personal data beyond what is needed (no email bodies, no wallet secrets) | Open |
| e | Named staff coverage and escalation | Named primary owner of the mailbox, a named backup, and what happens when the owner is away (out-of-office handover, escalation contact) | Open |
| f | Legal deadlines | Confirmation that any shorter legal deadline (for example a data-protection law that requires a faster answer in the person's country) overrides the 30-day window, and how staff are told | Open |

When all six rows have evidence, the owner removes the `BLOCKED_OWNER_PROOF`
comment from `website/account-deletion/index.html` and records the decision.
If the proof cannot be completed, remove the 30-day sentence instead and keep
the rest of the email option.

## Dependencies

Web deletion only works once the hosted API and auth configuration exist
(X-06 API URL, X-07 and X-05). Until then the page shows "Online deletion is
not available right now" and points to the app or email, which makes this
email process the only web-reachable route and raises the importance of the
checklist above.
