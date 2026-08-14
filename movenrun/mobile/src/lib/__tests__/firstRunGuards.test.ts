/**
 * First-run source guards — offline, scoped to the account/intro/bootstrap
 * files.
 *
 * The behavioural tests next door cover the transitions; these lock the
 * *structural* invariants that would silently regress the rebuild: a second
 * intro implementation reappearing, progression going back through scroll
 * momentum, a permission or backend call creeping into the intro, an identity
 * client being built inside a screen, or a raw identifier/token/address being
 * rendered during first run.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const APP = join(process.cwd(), "app");
const SRC = join(process.cwd(), "src");
const COMPONENTS = join(SRC, "components");

const WELCOME = join(APP, "welcome.tsx");
const INTRO = join(APP, "opening.tsx");
const LEGACY_INTRO = join(APP, "onboarding.tsx");
const ACCOUNT = join(APP, "account", "index.tsx");
const LAYOUT = join(APP, "_layout.tsx");
const HOME = join(APP, "(tabs)", "index.tsx");
const PROFILE = join(APP, "(tabs)", "profile.tsx");
const EMAIL_FORM = join(COMPONENTS, "EmailOtpForm.tsx");
const GAME_STORE = join(SRC, "store", "useGameStore.ts");
const AUTH_STORE = join(SRC, "store", "useAuthStore.ts");
const IDENTITY_API = join(SRC, "services", "identityApi.ts");

/** Every screen a user can see before they reach the app. */
const FIRST_RUN_FILES = [WELCOME, INTRO, LEGACY_INTRO, EMAIL_FORM];

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/**
 * Source with comments removed. These guards are about what the code *does*;
 * a doc comment that names the old `onMomentumScrollEnd` bug (or the fact that
 * auth state is never written to AsyncStorage) is documentation, not a
 * regression, and must not trip the check.
 */
function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

// ---- progression is state, not scrolling ------------------------------------

test("no first-run screen advances through scroll momentum or scrollTo()", () => {
  for (const path of [...FIRST_RUN_FILES, LAYOUT]) {
    const src = code(path);
    assert.ok(!/onMomentumScrollEnd/.test(src), `${path}: momentum must not drive the step`);
    assert.ok(!/scrollTo\(/.test(src), `${path}: scrollTo() must not drive the step`);
    assert.ok(!/contentOffset/.test(src), `${path}: scroll offset is not application state`);
    assert.ok(!/pagingEnabled/.test(src), `${path}: no swipe pager owns progression`);
  }
});

test("the intro's Next/Back go through the pure step functions", () => {
  const src = code(INTRO);
  assert.match(src, /nextIntroStep/, "Next uses the pure transition");
  assert.match(src, /previousIntroStep/, "Back uses the pure transition");
  assert.match(src, /setStep\(/, "the step is ordinary React state");
  // No layout arithmetic anywhere near progression.
  assert.ok(!/useWindowDimensions/.test(src), "no layout-width division");
});

// ---- one canonical intro ----------------------------------------------------

test("exactly one intro implementation exists across app/", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".tsx")) files.push(full);
    }
  };
  walk(APP);
  // A file "implements the intro" if it renders the intro's step content.
  const implementations = files.filter((f) => /INTRO_STEPS|introStepAnnouncement/.test(read(f)));
  assert.deepEqual(implementations, [INTRO], "only app/opening.tsx may implement the intro");
});

test("the legacy /onboarding route is a redirect and nothing else", () => {
  const src = read(LEGACY_INTRO);
  assert.match(src, /<Redirect\s+href="\/opening"\s*\/>/, "it must redirect to the canonical intro");
  assert.ok(!/useState|useEffect|StyleSheet|ScrollView|<Button/.test(src), "no UI and no state of its own");
  assert.ok(src.length < 900, "a redirect stub, not a second flow");
});

// ---- account choice honesty -------------------------------------------------

test("no disabled Google or Base provider controls are shown", () => {
  for (const path of [WELCOME, ACCOUNT]) {
    const src = read(path);
    assert.ok(!/logo-google|Continue with Google/.test(src), `${path}: no Google control`);
    assert.ok(!/Continue with Base|base_account/.test(src), `${path}: no Base control`);
    assert.ok(!/<Button[^>]*\sdisabled\s*(\/|>)/.test(src), `${path}: no permanently disabled button`);
  }
});

test("account choice keeps the local-beta path and a way forward when the backend is absent", () => {
  const src = read(WELCOME);
  assert.match(src, /Explore local beta/, "the local-beta choice is always offered");
  assert.match(src, /chooseLocalBeta/, "and it persists the choice");
  assert.match(src, /isBackendConfigured/, "an unconfigured build says so honestly");
  assert.match(src, /Protect your MovenRun progress/);
  // Never a fabricated success.
  assert.ok(!/status:\s*"signedIn"|setStatus\(/.test(src), "the screen never asserts a signed-in state");
});

test("first-run screens render no identifier, token, address, or backend host", () => {
  for (const path of FIRST_RUN_FILES) {
    const src = code(path);
    assert.ok(!/accessToken|refreshToken|privateKey|seedPhrase|sessionFamily/.test(src), `${path}: no secret`);
    // Covers `user.id`, `user?.id`, `getState().user?.id`, session ids, wallet ids.
    assert.ok(
      !/user\s*\??\.\s*id\b|\.sessionId\b|\bwalletId\b|\.identities\b/.test(src),
      `${path}: no internal identifier`,
    );
    assert.ok(!/wallet\.address|\.addressChecksum|shortAddress/.test(src), `${path}: no wallet address`);
    assert.ok(!/EXPO_PUBLIC_API_URL|https?:\/\//.test(src), `${path}: no infrastructure URL`);
  }
});

test("the account hub renders no raw user id or wallet address either", () => {
  const src = code(ACCOUNT);
  assert.ok(
    !/\{\s*user\s*\??\.\s*id\s*\}|shortAddress\(/.test(src),
    "identity is described in words, not identifiers",
  );
  assert.ok(!/accessToken|refreshToken|sessionId/.test(src));
});

// ---- permissions ------------------------------------------------------------

test("no permission is requested during account choice or the intro", () => {
  for (const path of [...FIRST_RUN_FILES, LAYOUT]) {
    const src = read(path);
    assert.ok(
      !/requestForegroundPermission|requestBackgroundPermission|expo-location|Permissions\./.test(src),
      `${path}: first run must not touch permissions`,
    );
  }
});

test("background/always-on location, health, contacts, camera and notifications are never requested", () => {
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "__tests__") walk(full, out);
      else if (entry.isFile() && /\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
  };
  const forbidden =
    /requestBackgroundPermissionsAsync|startLocationUpdatesAsync|expo-notifications|expo-contacts|expo-camera|expo-sensors|HealthKit/;
  for (const file of [...walk(APP), ...walk(SRC)]) {
    assert.ok(!forbidden.test(code(file)), `${file}: unnecessary permission surface`);
  }
});

// ---- bootstrap / client construction ---------------------------------------

test("the identity client is constructed once at the app boundary, never in a screen", () => {
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (entry.name.endsWith(".tsx")) out.push(full);
    }
    return out;
  };
  for (const file of walk(APP)) {
    assert.ok(!/new IdentityApiClient\(/.test(read(file)), `${file}: screens must not build a client`);
  }
  assert.match(read(AUTH_STORE), /createIdentityApiClient\(\)/, "the store owns construction");
});

test("the backend base URL is parsed in exactly one place", () => {
  const src = read(IDENTITY_API);
  const parses = src.match(/process\.env\.EXPO_PUBLIC_API_URL/g) ?? [];
  assert.equal(parses.length, 1, "one env read");
  assert.match(src, /export function readApiBaseUrl/);
});

test("session restore is typed and bounded — no polling, no unbounded retry", () => {
  const src = code(IDENTITY_API);
  assert.match(src, /kind:\s*"unavailable"/, "transient failure is its own outcome");
  assert.match(src, /kind:\s*"rejected"/, "a server rejection is distinguishable");
  assert.ok(!/setInterval|setTimeout/.test(src), "no polling or backoff loop");
  // The single transparent refresh stays single.
  assert.match(src, /retryOn401:\s*false/);
  const store = code(AUTH_STORE);
  assert.ok(!/setInterval|setTimeout/.test(store), "the store does not poll either");
});

test("the store maps restore outcomes through the pure classifier", () => {
  // The *behaviour* (credentials surviving a transient failure) is covered by
  // src/services/__tests__/sessionRestore.test.ts against a real client; this
  // only pins that the store doesn't re-derive the mapping by hand.
  const store = code(AUTH_STORE);
  assert.match(store, /restoreKindToAuthStatus/);
  assert.ok(!/status:\s*"signedOut"[\s\S]{0,80}unavailable/.test(store), "unavailable is never signed-out");
});

test("no security-relevant path swallows an error silently or undocumented", () => {
  for (const path of [AUTH_STORE, IDENTITY_API, WELCOME, ACCOUNT, EMAIL_FORM, LAYOUT]) {
    const raw = read(path);
    /* A catch block may be intentionally empty of *statements* — some cleanups
       genuinely have nothing more to do — but it must say why, in the block
       itself. A bare `catch {}` with no explanation is what hides bugs, so
       that is what fails here. The raw source is used deliberately: the
       explanation lives in a comment. */
    for (const block of raw.match(/catch\s*(\([^)]*\))?\s*\{[\s\S]{0,400}?\}/g) ?? []) {
      const body = block.slice(block.indexOf("{") + 1, block.lastIndexOf("}"));
      const statements = body
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "")
        .trim();
      if (statements.length > 0) continue; // it does something
      assert.ok(
        /\/\*|\/\//.test(body),
        `${path}: bare \`catch {}\` with no explanation:\n${block}`,
      );
    }
  }
});

test("tokens never enter Zustand or AsyncStorage", () => {
  for (const path of [AUTH_STORE, GAME_STORE]) {
    const src = code(path);
    assert.ok(!/accessToken|refreshToken/.test(src), `${path}: no token in store state`);
  }
  assert.ok(!/AsyncStorage/.test(code(AUTH_STORE)), "auth state is never persisted");
});

// ---- first-run state model --------------------------------------------------

test("first-run completion has exactly one source of truth", () => {
  const src = read(GAME_STORE);
  assert.ok(!/hasOnboarded:\s*boolean|hasSeenOpeningIntro:\s*boolean/.test(src), "legacy booleans are gone from state");
  assert.match(src, /firstRun: FirstRunState/);
  assert.match(src, /migrateFirstRun\(/, "persisted state migrates into the new model");
  // The transient hydration flag stays out of storage.
  assert.match(src, /partialize:\s*\(\{\s*_hydrated,\s*\.\.\.rest\s*\}\)/);
});

test("Reset progress preserves first-run state (and never signs the user out)", () => {
  const src = code(GAME_STORE);
  const match = src.match(/reset:\s*\(\)\s*=>\s*set\(\{([\s\S]*?)\}\)/);
  assert.ok(match, "found the reset patch");
  const body = match![1];
  assert.ok(!/firstRun/.test(body), "reset must not touch firstRun");
  assert.ok(!/signOut|clearSession/.test(body), "reset must not sign the user out");
});

// ---- navigation -------------------------------------------------------------

test("every first-run route is registered and routing cannot stack replaces", () => {
  const layout = read(LAYOUT);
  for (const name of ["welcome", "opening", "onboarding"]) {
    assert.match(layout, new RegExp(`<Stack\\.Screen\\s+name="${name}"`), `${name} must be registered`);
  }
  // One decision, applied once per destination.
  assert.match(layout, /applied === route/, "a repeated decision must not re-navigate");
  assert.match(layout, /navigationPending/, "the branded cover stays up until first run is on screen");
  assert.match(layout, /useAppBootstrap\(\)/, "the layout consumes the single bootstrap decision");
});

// ---- error ownership --------------------------------------------------------

test("a restore Retry is shown only for a restore error, never for a form error", () => {
  for (const path of [WELCOME, ACCOUNT]) {
    const src = code(path);
    // The Retry block is gated on the RESTORE error, not on a generic status.
    assert.match(src, /\{restoreErrorCode \?/, `${path}: Retry is gated on restoreErrorCode`);
    assert.ok(
      !/status === "error"/.test(src),
      `${path}: no generic error status may decide which recovery is offered`,
    );
    // The form receives the form-owned code and nothing else.
    assert.match(src, /errorCode=\{authErrorCode\}/, `${path}: the form shows sign-in errors`);
    assert.ok(!/errorCode=\{restoreErrorCode\}/.test(src), `${path}: no restore error inside the form`);
  }
  // And the form itself offers no restore affordance at all.
  const form = code(EMAIL_FORM);
  assert.ok(!/retryRestore|restoreError/.test(form), "the form never invokes session restore");
});

test("the shared form's busy state comes from the auth operation, not session status", () => {
  for (const path of [WELCOME, ACCOUNT]) {
    const src = code(path);
    assert.match(src, /isAuthBusy\(operation\)/, `${path}: busy is derived from the operation`);
    assert.ok(!/status === "authenticating"/.test(src), `${path}: no overloaded status check`);
  }
});

test("one auth request at a time, gated at the state layer", () => {
  const store = code(AUTH_STORE);
  // Both OTP actions refuse to start while another operation is running.
  const guards = store.match(/get\(\)\.operation !== "idle"/g) ?? [];
  assert.ok(guards.length >= 3, `send, verify and retryRestore all guard (saw ${guards.length})`);
  // A successful send must return the operation to idle — otherwise the code
  // field stays disabled and signup cannot be completed.
  const begin = store.slice(store.indexOf("beginEmailOtp: async"), store.indexOf("completeEmailOtp: async"));
  assert.match(begin, /operation: "idle", authErrorCode: null/, "successful send ends the operation");
  assert.ok(!/status: "signedIn"/.test(begin), "sending a code never signs anyone in");
});

// ---- single-flight refresh ---------------------------------------------------

test("every refresh goes through the single-flight wrapper", () => {
  const src = code(IDENTITY_API);
  assert.match(src, /private refreshInFlight: Promise<RefreshOutcome> \| null/);
  assert.match(src, /await this\.refreshOnce\(\)/, "requests await the shared refresh");
  // performRefresh is the implementation and must never be called directly.
  const directCalls = src.match(/this\.performRefresh\(\)/g) ?? [];
  assert.equal(directCalls.length, 1, "performRefresh is invoked only by refreshOnce");
  // The slot is released so a later expiry can refresh again.
  assert.match(src, /this\.refreshInFlight === operation/);
});

test("the startup error state offers recovery and shows no raw error", () => {
  const src = read(LAYOUT);
  assert.match(src, /label="Retry"/);
  assert.match(src, /Explore local beta/);
  assert.match(src, /authErrorMessage\(/, "copy comes from the stable code map");
  assert.ok(!/errorCode\}\s*<\/Text>|\{String\(err/.test(src), "no raw code or exception rendered");
});

// ---- intro exits -------------------------------------------------------------

test("Skip and the final CTA are distinct actions decided by an explicit source", () => {
  const src = code(INTRO);
  assert.match(src, /toIntroSource\(params\.source\)/, "intent comes from a route parameter");
  assert.match(src, /resolveIntroExit\(source, action\)/, "the exit is resolved purely");
  assert.match(src, /onPress=\{skip\}/, "Skip has its own handler");
  /* Replay must not be inferred from history depth. `canGoBack` may still be
     used INSIDE the replay branch to pop back politely — what it may never do
     is decide which branch we are in. */
  const decision = src.slice(src.indexOf("const exit ="), src.indexOf('resolved === "return"'));
  assert.ok(decision.length > 0, "found the exit decision");
  assert.ok(!/canGoBack/.test(decision), "history depth must not decide replay vs first run");
  // Completing first run never depends on navigation history either.
  const completeBranch = src.slice(src.indexOf("completeIntro();"));
  assert.ok(!/canGoBack/.test(completeBranch.slice(0, 200)), "completion is unconditional");
});

test("both entry points declare which mode they open the intro in", () => {
  assert.match(code(LAYOUT), /"\/opening\?source=first-run"/, "startup opens first-run mode");
  assert.match(code(PROFILE), /\/opening\?source=replay/, "Profile opens replay mode");
});

// ---- animation safety -------------------------------------------------------

test("redesigned first-run screens stay on the native driver with safe properties", () => {
  for (const path of [WELCOME, INTRO, join(COMPONENTS, "FadeSlideIn.tsx")]) {
    const src = read(path);
    assert.ok(!/useNativeDriver:\s*false/.test(src), `${path}: the JS driver is not allowed here`);
    // No Animated.View may bind a layout property the native driver can't animate.
    for (const tag of src.match(/<Animated\.View[\s\S]*?>/g) ?? []) {
      assert.ok(
        !/\b(left|right|top|bottom|width|height|margin\w*|padding\w*)\s*:/.test(tag),
        `${path}: Animated.View binds an unsupported layout style`,
      );
    }
  }
});

// ---- home / the task board --------------------------------------------------

test("Home decides nothing — it renders one board and no second opinion", () => {
  const src = code(HOME);
  /* The board's rules ("one spotlight task", "never rendered twice", priority
     order) are proven for every input in tasks.test.ts. What must be guarded
     HERE is that the screen obeys the board instead of re-deciding with its
     own conditionals — the original defect was four independent booleans on
     this screen that disagreed with each other. */
  assert.match(src, /buildTodayBoard\(/, "the screen consumes the pure rule");
  assert.equal(
    (src.match(/buildTodayBoard\(/g) ?? []).length,
    1,
    "one board per render, not one per section",
  );
  // No section may re-derive what to show from raw state or a literal.
  assert.ok(
    !/\{true \?|\{false \?|zones\.length === 0 \?|history\.length > 0 \?/.test(src),
    "visibility comes from the board, never from an ad-hoc condition",
  );
  // The spotlight owns the only primary button, and it lives in TaskHero — so
  // the screen itself renders no button at all and cannot grow a rival CTA.
  assert.ok(!/<Button\b/.test(src), "Home renders no button of its own");
  assert.ok(!/variant="primary"/.test(src), "the only primary action is the board's");
});

test("Home reads store state but derives nothing from it itself", () => {
  const src = code(HOME);
  /* The board's inputs are computed by `boardInputFromState`, which is unit
     tested. When that derivation lived inline here it was wrong — `movedToday`
     counted any completion today, so an indoor warmup quest ticked "Move
     today" — and no test could reach it. Keep it out of the screen. */
  assert.match(src, /boardInputFromState\(\{/, "the screen consumes the pure mapping");
  assert.ok(
    !/history\s*\.\s*(filter|some|reduce)\(/.test(src),
    "history is interpreted in lib/tasks.ts, never in the screen",
  );
  assert.ok(!/completedAt/.test(src), "date bucketing belongs to the mapping");
  assert.ok(
    !/zoneStatus\(/.test(src),
    "zone health is derived in the mapping, not re-derived here",
  );
  // And the movement predicate has exactly one owner.
  assert.ok(!/"move-session"/.test(src), "no magic session id in the screen");
});

test("Home derives its state and keeps movement on the real route", () => {
  const src = code(HOME);
  // Every board input is computed from authoritative store state, so a reset
  // cannot leave a stale "you already did this" flag behind.
  assert.ok(
    !/firstMissionComplete|onboardingComplete|hasSeenHome/.test(src),
    "no redundant completion boolean",
  );
  assert.match(src, /case "move":\s*\n?\s*return router\.push\("\/move"\)/);
  assert.ok(
    !/router\.replace\("\/move"\)/.test(src),
    "Home pushes to Move, keeping the tab stack intact",
  );
  // One switch maps semantic actions to routes; screens elsewhere don't get to
  // invent a different destination for the same task.
  assert.equal((src.match(/const go = \(/g) ?? []).length, 1);
});
