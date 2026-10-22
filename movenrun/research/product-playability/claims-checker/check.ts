/**
 * Forbidden-claims checker for Play v1 production-facing text.
 *
 *   node --import tsx claims-checker/check.ts [--json] [--all]
 *
 * Scans user-facing string literals and JSX text in the screens a release
 * build can reach (computed from mobile/src/lib/releaseScope.ts, so gated
 * routes drop out automatically) and the components and view helpers they
 * render. Exit 1 when an unlabelled claim is found, with a precise list.
 * `--all` also prints LABELLED hits for review. Reviewed false positives go in
 * claims-checker/allowlist.json with a reason; each entry must still match, so
 * a stale allowlist entry is itself reported.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { isRouteInRelease } from "../../../mobile/src/lib/releaseScope";
import { LABEL, RULES } from "./rules";

export const MOBILE = join(__dirname, "../../../mobile");

export interface Hit {
  file: string; line: number; rule: string; severity: "fail" | "review"; text: string; labelled: boolean;
  allowlisted: string | null; why: string;
}

/** Blank out comments, keeping line numbers, so prose in comments is never read as UI text. */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}
interface AllowEntry { file: string; rule: string; text: string; reason: string }

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { if (name !== "__tests__") walk(full, out); }
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

/** Expo Router pathname for a file under mobile/app. */
export function routeOf(file: string): string {
  const rel = relative(join(MOBILE, "app"), file).replace(/\\/g, "/").replace(/\.tsx?$/, "");
  const parts = rel.split("/").filter((p) => !/^\(.*\)$/.test(p) && p !== "_layout");
  if (parts[parts.length - 1] === "index") parts.pop();
  return "/" + parts.join("/");
}

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(MOBILE, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = join(from, "..", spec);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    try { if (statSync(candidate).isFile()) return candidate; } catch { /* next */ }
  }
  return null;
}

/**
 * The files whose text a release build can show: every screen whose route is
 * in release (from mobile/src/lib/releaseScope.ts), plus everything those
 * screens import, transitively. A helper used only by a gated screen drops out.
 */
export function releaseSurfaces(): string[] {
  const roots = walk(join(MOBILE, "app")).filter((f) => isRouteInRelease(routeOf(f)));
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      const target = resolveImport(file, m[1]!);
      if (target && target.startsWith(MOBILE) && !target.includes("__tests__")) queue.push(target);
    }
  }
  return [...seen].sort();
}

/** User-facing text on one line: string literals with a space or a capital, and JSX text. */
export function textsOn(line: string): string[] {
  const trimmed = line.trim();
  if (/^(\/\/|\*|\/\*|import |export type|type |interface )/.test(trimmed)) return [];
  const out: string[] = [];
  for (const m of line.matchAll(/"((?:[^"\\]|\\.){2,})"|'((?:[^'\\]|\\.){2,})'|`((?:[^`\\]|\\.){2,})`/g)) {
    const s = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (/\s/.test(s) || /^[A-Z][a-z]/.test(s)) out.push(s);
  }
  for (const m of line.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)) out.push(m[1]!.trim());
  if (!/[<>"'`=;(){}]/.test(trimmed) && /[a-z]{3,} [a-z]{3,}/i.test(trimmed)) out.push(trimmed); // JSX text continuation lines
  return out.filter((s) => s.length > 1 && !/^(@|\.|\/|#|rgba?\(|[a-z]+[A-Z][A-Za-z]*$)/.test(s));
}

export function scan(files = releaseSurfaces()): Hit[] {
  const allow: AllowEntry[] = JSON.parse(readFileSync(join(__dirname, "allowlist.json"), "utf8")).entries;
  const hits: Hit[] = [];
  for (const file of files) {
    const lines = stripComments(readFileSync(file, "utf8")).split("\n");
    const rel = relative(MOBILE, file).replace(/\\/g, "/");
    lines.forEach((line, i) => {
      for (const text of textsOn(line)) {
        for (const rule of RULES) {
          if (!rule.pattern.test(text)) continue;
          const nearby = lines.slice(Math.max(0, i - 2), i + 3).join(" ");
          const allowed = allow.find((a) => a.file === rel && a.rule === rule.id && text.includes(a.text));
          hits.push({ file: rel, line: i + 1, rule: rule.id, severity: rule.severity, text, labelled: LABEL.test(text) || LABEL.test(nearby),
            allowlisted: allowed?.reason ?? null, why: rule.why });
        }
      }
    });
  }
  return hits;
}

export function staleAllowEntries(hits: Hit[]): AllowEntry[] {
  const allow: AllowEntry[] = JSON.parse(readFileSync(join(__dirname, "allowlist.json"), "utf8")).entries;
  return allow.filter((a) => !hits.some((h) => h.file === a.file && h.rule === a.rule && h.text.includes(a.text)));
}

if (require.main === module) {
  const hits = scan();
  const failures = hits.filter((h) => h.severity === "fail" && !h.labelled && !h.allowlisted);
  const review = hits.filter((h) => h.severity === "review" && !h.labelled && !h.allowlisted);
  const stale = staleAllowEntries(hits);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ failures, review, labelled: hits.filter((h) => h.labelled && !h.allowlisted), allowlisted: hits.filter((h) => h.allowlisted), stale }, null, 1));
  } else {
    for (const h of failures) console.log(`FAIL ${h.file}:${h.line} [${h.rule}] "${h.text}" — ${h.why}`);
    if (process.argv.includes("--all")) for (const h of review) console.log(`REVIEW ${h.file}:${h.line} [${h.rule}] "${h.text}"`);
    if (process.argv.includes("--all")) for (const h of hits.filter((x) => x.labelled && !x.allowlisted)) console.log(`LABELLED ${h.file}:${h.line} [${h.rule}] "${h.text}"`);
    for (const a of stale) console.log(`STALE ALLOWLIST ${a.file} [${a.rule}] "${a.text}"`);
    console.log(`\n${failures.length} unlabelled failures, ${review.length} preview-vocabulary hits to review, ${hits.filter((h) => h.labelled && !h.allowlisted).length} labelled, ${hits.filter((h) => h.allowlisted).length} allowlisted, ${stale.length} stale allowlist entries`);
  }
  process.exit(failures.length || stale.length ? 1 : 0);
}
