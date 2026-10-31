// Pure helpers for the read-only EAS diagnostic. No network, no secrets.
//
// Every function here works on text already captured from eas-cli into
// temporary files. Nothing in this module prints raw command output: callers
// only ever see class labels, booleans, counts and redacted one-line reasons.

export const PINNED_EAS_CLI = "24.8.0";
export const PREVIEW_ENVIRONMENT = "preview";
export const STAGING_API_URL = "https://movenrun-staging-api.onrender.com";
export const REQUIRED_PREVIEW_VARS = [
  "EXPO_PUBLIC_API_URL",
  "EXPO_PUBLIC_SUPABASE_URL",
  "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "GOOGLE_MAPS_ANDROID_API_KEY",
];

export const CLASSES = [
  "ok",
  "invalid_command",
  "project_context_missing",
  "project_not_found",
  "not_authenticated",
  "insufficient_permissions",
  "network",
  "rate_limited",
  "unknown",
];

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

/** Lines eas-cli prints on every run that never describe the failure. */
const NOISE = [
  /eas-cli@\d+\.\d+\.\d+ is now available/i,
  /^to upgrade, run:?$/i,
  /^npm install -g eas-cli/i,
  /^proceeding with outdated version/i,
  /without version control system is not recommended/i,
  /^see more help with --help$/i,
  /^-+$/,
];

export function stripAnsi(text) {
  return String(text ?? "").replace(ANSI, "");
}

/**
 * Remove anything that could identify an account or carry a credential.
 * Applied to every string that may reach a log, summary or artifact.
 */
export function redact(text) {
  return stripAnsi(text)
    .replace(/\beyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+){0,2}/g, "[redacted-jwt]")
    .replace(/\b(?:Bearer|token)\s+[^\s"']+/gi, "[redacted-auth]")
    .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => {
      try {
        const u = new URL(url);
        const host = /(^|\.)(expo\.dev|expo\.io|github\.com)$/i.test(u.hostname) ? u.host : "[host]";
        return `${u.protocol}//${host}${u.pathname === "/" ? "" : "/[path]"}`;
      } catch {
        return "[redacted-url]";
      }
    })
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted-email]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[redacted-id]")
    .replace(/@[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+/g, "[redacted-project]")
    .replace(/\b(?:sb_publishable|sb_secret|sk|pk)_[A-Za-z0-9_-]{6,}/g, "[redacted-key]")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}/g, "[redacted-key]")
    // Long opaque runs that contain a digit (tokens, keys, hashes). Plain
    // SCREAMING_CASE names such as EXPO_PUBLIC_SUPABASE_URL have no digit.
    .replace(/[A-Za-z0-9_+/=-]{24,}/g, (run) => (/\d/.test(run) && /[A-Za-z]/.test(run) ? "[redacted]" : run))
    .replace(/"[^"]*"/g, '"[redacted]"')
    .replace(/'[^']*'/g, "'[redacted]'")
    // Free-text server messages can name a user, account, owner or team.
    .replace(/\b(?:the[^\S\n]+)?(?<![\w-])[A-Za-z0-9][\w.-]*([^\S\n]+(?:account|team|organi[sz]ation))\b/gi, (m, tail) => (/^(?:the[^\S\n]+)?(?:an?|your|this|that|on|to|of|in|the)[^\S\n]/i.test(m) && !/^the[^\S\n]+\S+[^\S\n]/i.test(m) ? m : `[redacted-name]${tail}`))
    .replace(/(?<![\w-])(user|username|account|owner|team|organi[sz]ation|org)([^\S\n]*[:=]?[^\S\n]+)(?!\[redacted)(?!(?:account|team|on|to|of|in|for|with|and|or|is|was|has)\b)([A-Za-z0-9][\w.-]*)/gi, "$1$2[redacted-name]")
    .replace(/Available accounts:.*$/i, "Available accounts: [redacted]");
}

/** The last line of stderr that actually says something, redacted, ≤160 chars. */
export function lastMeaningfulLine(stderr) {
  const lines = stripAnsi(stderr)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !NOISE.some((re) => re.test(l)))
    // eas-cli's trailing "Error: <command> command failed." is a wrapper; the
    // cause is the line above it. Keep the wrapper only if nothing else exists.
    .filter((l, i, all) => !(all.length > 1 && /^error: [\w:-]+ command failed\.?$/i.test(l)));
  // Two lines: eas-cli often prints the cause ("Forbidden") above a generic
  // "GraphQL request failed." line.
  const line = lines.slice(-2).join(" / ");
  const clean = redact(line);
  return clean.length > 160 ? `${clean.slice(0, 157)}...` : clean;
}

const RULES = [
  ["invalid_command", /nonexistent flags?|unexpected arguments?|command .+ not found|missing required (flag|arg)|expected .+ to be one of/i],
  ["project_context_missing", /failed to resolve plugin|do you have node modules installed|cannot find module|could not find (an )?(app config|project id)|run (`)?eas init|no projectid|eas project is not configured|app\.(json|config)/i],
  ["rate_limited", /\b429\b|too many requests|rate.?limit/i],
  ["network", /ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed|network (error|request failed)|getaddrinfo/i],
  ["not_authenticated", /account is required to proceed|not logged in|\b401\b|unauthori[sz]ed|invalid (access )?token|token (has )?expired/i],
  ["insufficient_permissions", /forbidden|\b403\b|not authori[sz]ed|permission|don't have (the required )?(access|permissions)|access denied/i],
  ["project_not_found", /entity not found|experience with id .* does not exist|\b404\b|project .*not found|app .*not found|could not find (the )?project/i],
];

/** Classify one command result. Exit code wins: a zero exit is "ok". */
export function classify(exitCode, stderr) {
  if (exitCode === 0) return { class: "ok", reason: "" };
  const text = stripAnsi(stderr);
  for (const [label, re] of RULES) {
    if (re.test(text)) return { class: label, reason: lastMeaningfulLine(text) };
  }
  return { class: "unknown", reason: lastMeaningfulLine(text) || `exit ${exitCode}, no message` };
}

/**
 * Parse `eas env:list <env> --format short` output. Returns a map from name to
 * { visibility, value? }. `value` is kept only in memory so the caller can
 * compare it; it must never be printed.
 */
export function parseEnvShort(stdout) {
  const vars = new Map();
  for (const raw of stripAnsi(stdout).split(/\r?\n/)) {
    const m = raw.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    const [, name, rest] = m;
    let visibility = "plain";
    let value = rest;
    if (/^\*{5}/.test(rest)) {
      value = undefined;
      if (/sensitive env variable/i.test(rest)) visibility = "sensitive";
      else if (/secret env variable/i.test(rest)) visibility = "secret";
      else if (/file env variable/i.test(rest)) visibility = "file";
      else visibility = "hidden";
    }
    vars.set(name, { visibility, value });
  }
  return vars;
}

/** Normalise an API URL for comparison only (scheme+host, no trailing slash). */
function sameUrl(a, b) {
  try {
    const x = new URL(a.trim());
    const y = new URL(b);
    return x.protocol === y.protocol && x.host === y.host && x.pathname.replace(/\/+$/, "") === y.pathname.replace(/\/+$/, "") && !x.search && !x.username;
  } catch {
    return false;
  }
}

/**
 * Presence across project-scope and account-scope output. EAS builds see both,
 * and a project variable overrides an account variable of the same name.
 */
export function envPresence(projectStdout, accountStdout = "") {
  const vars = new Map();
  for (const [k, v] of parseEnvShort(accountStdout)) vars.set(k, { ...v, scope: "account" });
  for (const [k, v] of parseEnvShort(projectStdout)) vars.set(k, { ...v, scope: "project" });
  const rows = REQUIRED_PREVIEW_VARS.map((name) => {
    const v = vars.get(name);
    return { name, present: Boolean(v), visibility: v ? v.visibility : null, scope: v ? v.scope : null };
  });
  const api = vars.get("EXPO_PUBLIC_API_URL");
  let apiUrlMatchesStaging;
  if (!api) apiUrlMatchesStaging = "missing";
  else if (api.value === undefined) apiUrlMatchesStaging = "unknown";
  else apiUrlMatchesStaging = sameUrl(api.value, STAGING_API_URL) ? "yes" : "no";
  return { rows, apiUrlMatchesStaging, totalNames: vars.size };
}

/** Parse `eas project:info`. Returns the project id and owner (owner stays in memory). */
export function parseProjectInfo(stdout) {
  const text = stripAnsi(stdout);
  const full = text.match(/^\s*fullName\s+@?([^\s/]+)\/(\S+)\s*$/m);
  const id = text.match(/^\s*ID\s+([0-9a-f-]{36})\s*$/im);
  return {
    owner: full ? full[1] : null,
    slug: full ? full[2] : null,
    projectId: id ? id[1].toLowerCase() : null,
  };
}

/** Summarise `eas build:list --json` without ids, URLs or commit hashes. */
export function summarizeBuilds(stdout) {
  let list;
  try {
    list = JSON.parse(stdout);
  } catch {
    return { readable: false };
  }
  if (!Array.isArray(list)) return { readable: false };
  const byStatus = {};
  for (const b of list) {
    const s = String(b?.status ?? "unknown").toLowerCase();
    byStatus[s] = (byStatus[s] ?? 0) + 1;
  }
  return {
    readable: true,
    count: list.length,
    byStatus,
    previewProfileBuilds: list.filter((b) => b?.buildProfile === PREVIEW_ENVIRONMENT).length,
  };
}

/** Summarise `eas account:usage --json`: plan name and build counts only. */
export function summarizeUsage(stdout) {
  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    return { readable: false };
  }
  const total = data?.builds?.plan ?? data?.builds?.total ?? null;
  const android = data?.builds?.android?.plan ?? data?.builds?.android ?? null;
  const pick = (m) =>
    m && Number.isFinite(m.used) && Number.isFinite(m.limit) ? { used: m.used, limit: m.limit, remaining: Math.max(0, m.limit - m.used) } : null;
  const plan = typeof data?.account?.plan === "string" ? data.account.plan.replace(/[^\w .-]/g, "").slice(0, 40) : null;
  return {
    readable: true,
    plan,
    total: pick(total),
    android: pick(android),
    daysRemaining: Number.isFinite(data?.account?.billingPeriod?.daysRemaining) ? data.account.billingPeriod.daysRemaining : null,
  };
}

/**
 * Decide the CLI-checkable part of the gate. Owner-only rows (keystore SHA-1,
 * Maps key restriction) are always UNKNOWN here: the CLI cannot read them
 * without the interactive credentials manager, which this workflow never runs.
 */
export function evaluate({ results, env, project, expectedProjectId, easJsonPreviewEnv, builds, usage, cliVersion }) {
  const rows = [];
  const push = (id, status, detail) => rows.push({ id, status, detail });

  push("cli_pinned", cliVersion === PINNED_EAS_CLI ? "PASS" : "FAIL", `eas-cli ${cliVersion ?? "unknown"}`);
  for (const [cmd, r] of Object.entries(results)) {
    push(`query_${cmd}`, r.class === "ok" ? "PASS" : "BLOCKED", r.class === "ok" ? "exit 0" : `${r.class}: ${r.reason}`);
  }
  const pi = results.project_info?.class === "ok";
  push(
    "project_id_matches_app_json",
    !pi ? "BLOCKED" : project?.projectId && project.projectId === String(expectedProjectId).toLowerCase() ? "PASS" : "FAIL",
    !pi ? "project:info did not succeed" : project?.projectId ? (project.projectId === String(expectedProjectId).toLowerCase() ? "yes" : "no") : "unparsed",
  );
  push("eas_json_preview_selects_preview", easJsonPreviewEnv === PREVIEW_ENVIRONMENT ? "PASS" : "FAIL", `environment=${easJsonPreviewEnv ?? "unset"}`);

  const envOk = results.env_list?.class === "ok" && (results.env_list_account ? results.env_list_account.class === "ok" : true);
  for (const row of env?.rows ?? REQUIRED_PREVIEW_VARS.map((name) => ({ name, present: false, visibility: null }))) {
    push(`env_${row.name}`, !envOk ? "BLOCKED" : row.present ? "PASS" : "BLOCKED", !envOk ? "unknown (env:list failed)" : row.present ? `present (${row.scope} scope, ${row.visibility})` : "missing at project and account scope");
  }
  const m = env?.apiUrlMatchesStaging;
  push("env_api_url_is_staging", !envOk ? "BLOCKED" : m === "yes" ? "PASS" : m === "no" ? "FAIL" : "BLOCKED", !envOk ? "unknown" : m);

  if (results.build_list?.class === "ok") {
    push("recent_builds_readable", builds?.readable ? "PASS" : "FAIL", builds?.readable ? `${builds.count} android builds listed` : "output not JSON");
  }
  const quota = usage?.android ?? usage?.total;
  if (results.account_usage) {
    push(
      "build_quota_available",
      results.account_usage.class !== "ok" || !usage?.readable || !quota ? "BLOCKED" : quota.remaining >= 1 ? "PASS" : "BLOCKED",
      results.account_usage.class !== "ok" ? "unknown (account:usage failed)" : quota ? `${quota.remaining} of ${quota.limit} left${usage.plan ? `, plan ${usage.plan}` : ""}` : "not reported",
    );
  }
  push("signing_keystore_sha1_matches", "UNKNOWN", "owner check in the Expo dashboard (CLI only exposes it interactively)");
  push("maps_key_restricted_to_package_and_sha1", "UNKNOWN", "owner check in Google Cloud console");

  const cliRows = rows.filter((r) => r.status !== "UNKNOWN");
  const cli = cliRows.some((r) => r.status === "FAIL") ? "FAIL" : cliRows.every((r) => r.status === "PASS") ? "PASS" : "BLOCKED";
  // The overall gate can never be GO from CI alone: owner rows stay UNKNOWN.
  const gate = cli === "PASS" ? "BLOCKED_ON_OWNER_CHECKS" : cli;
  return { rows, cli, gate };
}
