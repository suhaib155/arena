import { createApiApp } from "./app.js";
import { resolveApiConfig } from "./config.js";
import { closeDb } from "../db/client.js";
import { tokenTrustSummary } from "../identity/providers/supabaseAuth.js";

try {
  const config = resolveApiConfig();
  const server = createApiApp(config).listen(config.PORT, "0.0.0.0", () => {
    // Which proxies may name the client, so a deploy log shows the rate-limit keying.
    const proxies = config.TRUST_PROXY === "render-cloudflare" ? "trusted by network (Cloudflare, private)" : `${config.TRUST_PROXY_HOPS} trusted hop(s)`;
    console.info(`V3 API listening; Supabase tokens: ${tokenTrustSummary(config.supabase)}; proxies: ${proxies}`);
  });
  // A client must finish sending its request (headers in 20 s, all of it in
  // 30 s), so a slow or stalled sender cannot hold connections open on the
  // single free instance. Handler time is bounded separately by the 10 s
  // provider and database timeouts.
  server.headersTimeout = 20_000;
  server.requestTimeout = 30_000;
  server.on("error", () => { console.error("V3 API listener failed"); process.exit(1); });
  const shutdown = () => {
    const timeout = setTimeout(() => process.exit(1), 10000);
    timeout.unref();
    server.close(() => {
      void closeDb().then(() => process.exit(0), () => process.exit(1));
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
} catch {
  console.error("V3 API startup failed; check required environment configuration");
  process.exit(1);
}
