/**
 * Redact a device log before it leaves the tester's phone or laptop.
 *
 *   node --import tsx tools/redactLog.ts < raw.log > redacted.log
 *
 * Removes coordinates, tokens, emails, account ids, IP addresses and sign-in
 * return parameters, and prints a count of what it removed to stderr so the
 * tester can see it worked. It is deliberately greedy: a redacted log that is
 * slightly less useful is fine, a leaked home location is not. Keep the raw
 * log on the tester's own device; share only the output.
 */
export interface RedactionCounts { [kind: string]: number }

const RULES: [string, RegExp, string][] = [
  // JWTs and bearer tokens first, so their dots are not read as coordinates.
  ["jwt", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[TOKEN]"],
  ["bearer", /\b(Bearer|bearer)\s+[A-Za-z0-9._~+/=-]{12,}/g, "$1 [TOKEN]"],
  ["secret_key", /\b(sb_(secret|publishable)_[A-Za-z0-9_-]{8,}|sk_[A-Za-z0-9]{12,}|AIza[0-9A-Za-z_-]{30,})\b/g, "[KEY]"],
  ["auth_param", /([?&#](code|access_token|refresh_token|id_token|token|state|nonce)=)[^&#\s"']+/gi, "$1[REDACTED]"],
  ["email", /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[EMAIL]"],
  ["uuid", /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[ID]"],
  ["wallet", /\b0x[0-9a-fA-F]{40}\b/g, "[WALLET]"],
  ["h3_cell", /\b8[0-9a-f]{14}\b/g, "[CELL]"],
  // Named coordinate fields in JSON or key=value form.
  ["coordinate_field", /("?(lat|lng|lon|latitude|longitude)"?\s*[:=]\s*)-?\d{1,3}\.\d+/gi, "$1[COORD]"],
  // Bare decimal pairs such as "51.50735, -0.12776" (4+ decimals: street-level precision).
  ["coordinate_pair", /-?\d{1,2}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/g, "[COORD],[COORD]"],
  ["ipv4", /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[IP]"],
  ["ipv6", /\b(?:[0-9a-f]{1,4}:){4,7}[0-9a-f]{1,4}\b/gi, "[IP]"],
];

export function redact(text: string): { text: string; counts: RedactionCounts } {
  const counts: RedactionCounts = {};
  let out = text;
  for (const [kind, pattern, replacement] of RULES) {
    out = out.replace(pattern, (...args) => {
      counts[kind] = (counts[kind] ?? 0) + 1;
      const match = args[0] as string;
      return match.replace(new RegExp(pattern.source, pattern.flags.replace("g", "")), replacement);
    });
  }
  return { text: out, counts };
}

if (require.main === module) {
  const chunks: Buffer[] = [];
  process.stdin.on("data", (c) => chunks.push(c as Buffer));
  process.stdin.on("end", () => {
    const { text, counts } = redact(Buffer.concat(chunks).toString("utf8"));
    process.stdout.write(text);
    process.stderr.write(`redacted: ${JSON.stringify(counts)}\n`);
  });
}
