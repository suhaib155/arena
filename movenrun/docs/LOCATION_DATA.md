# What MovenRun does with location data

This describes the app as it is on this branch, not as it is intended to be.
Where something is unproven, it says so.

## Collection

Location is sampled only while a movement session is running in the foreground.

There is no background location permission, no foreground-service-location
permission, no background fetch and no background location task. The Android
build resolves to no such permission, and a test asserts that the *generated*
manifest — not merely the declared permission list — contains none of them.

A demo session synthesises a route and samples nothing.

## What leaves the device

**Signed out (local beta): nothing.** No route, no coordinates, no session.

**Signed in:** deliberately saving a real GPS session sends that session's
route observations — latitude, longitude, accuracy and timestamp per point,
plus the session window — to MovenRun's `POST /movement/verify`, which measures
the route and returns a verdict.

Saving is the only path that uploads. It is already gated to real GPS sessions
long enough to be worth keeping, so nothing is sent for a demo route, an
abandoned session, or a session below the save threshold.

The device's own distance figure is deliberately *not* sent as a claim. The
server measures the route itself; sending a second number would only raise the
question of which one is authoritative.

## What is stored on the device

Ordinary progress — workout history, route reviews, the passport, districts,
the weekly recap, captured zones — contains **no coordinates and no route
path**. That has always been true and remains true.

The one exception is the verification retry queue. When a save cannot reach
the server, that session's route observations are written to device storage so
the request can be retried. This is the only durable store of precise
coordinates in the app.

It is bounded deliberately:

| Bound | Value |
|---|---|
| Retention | 7 days from the session's end time, then deleted |
| Attempts | 6 total, then deleted |
| Routes held at once | 3, oldest evicted first |

Retention is measured from the session's own end time rather than from when it
was queued, so retrying cannot extend the window. The backend refuses sessions
older than 30 days; the client's own limit is deliberately far shorter, because
that backend rule is a validation limit and not a licence to hold location for
a month.

The queue is deleted on: a verdict either way, a terminal failure, the attempt
budget running out, expiry, sign-out, and a progress reset.

### Storage security — what cannot be claimed

The retry queue is stored with AsyncStorage: app-private, **unencrypted**
key/value storage. Other apps cannot read it, and full-device encryption
protects it where the user has a passcode set. A rooted or jailbroken device, a
device backup, or a forensic image can read it.

**No encrypted-at-rest claim is made.** Credentials live in the OS keystore via
`expo-secure-store` and are never written to the retry queue; nothing in the
queue is a credential. The mitigation for holding coordinates in unencrypted
storage is that they are held briefly and in small numbers, which is what the
bounds above are for.

This is a design decision with a real cost, recorded here rather than papered
over.

## Account binding

A queued route may be retried only by the account that created it, checked
against the server-derived account id before age, attempt budget or backoff are
considered. A route is never adopted by whoever signs in next, and the local
owner key is never sent to the server — the server derives the user from the
bearer token.

## What is never stored beside a route

No bearer token, refresh token, Authorization header, password, OTP, wallet key
or advertising identifier. No XP, Locked MOVE, trust score, captured or owned
zone, or deed state. Serialisation picks fields explicitly rather than
spreading, and a test asserts the exact persisted key set.

## What is never logged

No coordinates, no route payload, no request JSON, no token. Corrupt persisted
data is dropped without its contents being logged — there is nothing useful in
a malformed GPS trace and every reason not to copy it into a log buffer.

## Verified movement is not territory

A verified route reports which H3 cells it passed through. The app persists the
**count** of those cells, not their identifiers: at the resolution the backend
uses, a list of cells is a coarse trail, and keeping it beside history that
promises to hold no path would quietly break that promise.

Verified traversal is evidence of where verified movement occurred. It is not
capture, ownership, defence, a deed, or a reward, and there is no server-side
territory model for it to be evidence of.

## Known gaps

- None of the above is device-proven. The storage behaviour described here is
  the documented behaviour of AsyncStorage, not something this branch has
  observed on a handset.
- There is no hosted privacy policy or data-deletion request flow. Deletion
  happens through sign-out and progress reset, both of which are in the app.
- Sign-out clears the queue on a best-effort basis. The account check, not the
  deletion, is what actually prevents cross-account submission.
