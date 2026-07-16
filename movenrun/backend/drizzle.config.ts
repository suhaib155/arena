import type { Config } from "drizzle-kit";

// Minimal config so the pre-existing `db:generate` / `db:migrate` scripts in
// package.json can produce and apply migrations for src/db/schema.ts. This has
// not been run against a live Postgres in this environment (no DB access
// here); the schema.ts changes in this PR are validated at the application
// level via the InMemoryRouteRepository-backed tests, not via a generated
// migration. Generating the initial migration (this schema has never been
// migrated) is a fast, low-risk follow-up once DB tooling access is available.
export default {
  // Both the original route/zone/battle tables and the identity/wallet tables
  // are listed here so drizzle-kit sees one combined schema. The runtime
  // client (db/client.ts) merges the same two modules.
  schema: ["./src/db/schema.ts", "./src/db/identity.schema.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
} satisfies Config;
