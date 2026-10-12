import { createApiApp } from "./app.js";
import { resolveApiConfig } from "./config.js";
import { closeDb } from "../db/client.js";

try {
  const config = resolveApiConfig();
  const server = createApiApp(config).listen(config.PORT, "0.0.0.0", () => {
    console.info("V3 API listening");
  });
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
