# Hermes / H3 runtime compatibility

> **Build success is not runtime initialization proof for a native JavaScript
> bundle.**

This note records one incident, the patch it produced, and the condition under
which that patch should be deleted. It is deliberately short. The tests are the
durable part; this file exists so the next person understands *why* a
third-party package is patched in a repository that otherwise patches nothing.

---

## What happened

The APK built from the V3 sealing-engine head compiled, bundled, uploaded and
installed. On a physical Android device it died during launch:

```
RangeError: Unknown encoding: utf-16le (normalized: utf-16le)
```

Every automated check had been green:

| Check | Result |
| --- | --- |
| EAS Android build (preview profile) | succeeded |
| Metro export / Hermes bytecode compilation | succeeded |
| Shared, backend and mobile suites | all passing |
| Physical device, cold launch | **crashed before the first screen** |

Nothing in that column is wrong. They were all answering a question — *does this
compile, bundle, and behave under Node?* — that is not the question the device
asked, which is *does every module in the bundle survive being initialized by
Hermes?*

---

## Root cause

`h3-js@4.5.0` ships an Emscripten-generated runtime containing this line, near
the top level of the module body:

```js
var UTF16Decoder = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-16le") : undefined;
```

Hermes implements `TextDecoder` for UTF-8 and nothing else, and rejects any
other label with a `RangeError`. The guard checks whether `TextDecoder`
*exists* — under Hermes it does — and then immediately asks it for an encoding
Hermes does not have. The throw happens while the module is initializing, so it
is unrecoverable: nothing has rendered yet, and there is no `try` anywhere up
the stack.

The line runs in every environment. It did not crash under Node, in Metro, or
during Hermes *compilation*, because compiling bytecode never executes the
module body. Only a real Hermes runtime does.

**`UTF16Decoder` is never read.** It is declared once per artifact and
referenced nowhere; there is no `UTF16ToString`, `stringToUTF16` or
`lengthBytesUTF16` in any shipped file. The clearest evidence is upstream's own
minified UMD build, where the minifier had already proved the binding dead and
deleted it — keeping only the bare `new TextDecoder("utf-16le")` call, which it
could not prove free of side effects. The app was killed at startup by a value
nothing would ever have used.

---

## The fix

A committed Yarn patch — `.yarn/patches/h3-js-npm-4.5.0-64ee667011.patch` —
removes the construction from every shipped executable artifact and leaves the
binding as:

```js
var UTF16Decoder = undefined;
```

`undefined` is not an invented value. It is exactly what the unpatched module
already assigns on any runtime with no global `TextDecoder`, so the patch
narrows h3-js to a state it already supports rather than introducing a new one.

Six artifacts carry the identical line and all six are patched:

| Artifact | Reached by |
| --- | --- |
| `dist/h3-js.js` | `main` — Node, the backend, every test run |
| `dist/browser/h3-js.js` | `main` rewritten by `browser` — **the Android bundle** |
| `dist/h3-js.es.js` | `module`, `es2015` |
| `dist/browser/h3-js.es.js` | `module` rewritten by `browser` |
| `dist/h3-js.umd.js` | `umd:main`, `unpkg` |
| `dist/libh3-browser.js` | no entry field; the raw Emscripten runtime the browser bundles were built from |

The first two are the ones this repository loads today, proven empirically
rather than reasoned: `require.resolve("h3-js")` for Node, and the `sources`
list of a `expo export --dump-sourcemap` Android bundle for Metro. The rest are
patched because they carry the same fatal line, and leaving them would mean the
package is fixed only where we happened to look — a resolver change, a web
target or a direct path import would bring the crash straight back.

The UTF-8 decoder is untouched. It is the one every H3 index string comes back
through, and the device proved Hermes accepts it: the crashing line sits *after*
`new TextDecoder("utf8")` in the same file, so the engine had already executed
that construction successfully before it reached the UTF-16 one.

### What this is not

- Not a fallback to a fake or simulated grid. H3 is real everywhere.
- Not a change to Hermes, the Expo SDK, React Native, or the Android API level.
- Not a `TextDecoder` polyfill. Nothing global is monkey-patched at runtime; the
  only place a Hermes-shaped `TextDecoder` exists is inside a test probe.
- Not a substitution of UTF-8 for UTF-16 in a live code path. There is no live
  code path — that was checked before the line was touched.

---

## What holds it

`mobile/src/lib/__tests__/h3HermesRuntime.test.ts`, plus its child-process
probe in `__tests__/support/hermesH3Probe.cjs`.

The probe matters more than it looks. The failure happens **once, during module
initialization, on first load**, so an assertion made in the test runner's own
process would be inspecting an `h3` that Node had already initialized under
Node's `TextDecoder` — and would prove nothing at all. Every runtime check
therefore spawns a cold process, installs a Hermes-shaped `TextDecoder` before
anything is required, loads the real artifact the real resolver picks, and calls
real H3. No mock, and no expected value read back from the library under test.

The suite also refuses to pass vacuously: it asserts that the model actually
rejects `utf-16le` with the device's exact message, and actually accepts the
UTF-8 label h3-js still uses. If the shim silently failed to install, those two
fail first and say so.

Alongside the runtime checks it holds the boundary itself: no shipped artifact
constructs a UTF-16 decoder; the Metro-resolved entry is one the patch covers;
the patch is a committed file whose removed lines are *only* UTF-16 decoder
constructions; the lockfile resolves h3-js through it; and both dependent
workspaces point at the patched package, so `shared` and `backend` can never
drift onto different builds.

---

## Removing this patch

Delete it when upstream stops shipping the line — not before, and not by
guessing.

1. Check a candidate release: install it and search the shipped artifacts for
   `new TextDecoder("utf-16le")`. Upstream tracking is
   [uber/h3-js](https://github.com/uber/h3-js); the construction comes from the
   Emscripten runtime it vendors, so it disappears on a toolchain regeneration
   rather than on any particular feature release.
2. If it is gone, drop `.yarn/patches/h3-js-npm-4.5.0-64ee667011.patch`, restore
   a plain semver range for `h3-js` in `shared/package.json` and
   `backend/package.json`, and run `yarn install`.
3. Run `yarn workspace @movenrun/mobile test`. The artifact guards stay
   meaningful with no patch present — they assert the *installed* package is
   clean, however it got that way — but the three tests that read the patch file
   will fail, and should be deleted in the same change.
4. Rebuild the APK and cold-launch it on a physical device. The check that
   caught this cannot be replaced by any of the others.

Note that the patch protocol pins the exact version: `shared` and `backend`
declare `patch:h3-js@npm%3A4.5.0#…` rather than `^4.1.0`. That is intentional.
The patch is written against one specific generated bundle, and a version bump
must be a deliberate act that re-checks the line, not something a caret range
does quietly.

---

## The lesson worth keeping

A JavaScript bundle that compiles is not a JavaScript bundle that starts. Native
runtimes differ from Node in ways that only surface when a module body actually
executes — missing encodings, missing intrinsics, missing globals — and none of
those differences are visible to a bundler, a type checker, or a test suite
running on Node.

For anything that ships inside the app bundle, the last checkable claim is
*"a physical device cold-launched this exact artifact."* Until that has
happened, "the build is green" means the build is green.

---

## Roadmap numbering

This hotfix was not planned; it took the slot the next territory PR was going to
use. Everything after it moved up one:

| PR | Work |
| --- | --- |
| #94 | Android Hermes / H3 runtime compatibility hotfix (this one) |
| #95 | Solid territory |
| #96 | Shade territory |
| #97 | Server-authoritative territory ledger |
| #98 | Territory reconciliation / map sync |

`docs/SEALING_ENGINE.md` was written against the old numbering and its forward
references have been shifted to match. No scope moved between PRs; only the
numbers did.
