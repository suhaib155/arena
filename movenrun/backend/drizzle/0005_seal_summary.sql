-- Sealing summary for movement verifications (PR #93).
--
-- Three nullable columns, and NULL is load-bearing in a way `false` is not.
-- NULL means the sealing engine never ran on this row: it predates the engine,
-- it carried no session provenance to interpret, or the session was rejected
-- and a route the server does not believe cannot produce an authoritative seal.
-- `sealed = false` says something else entirely — the route WAS evaluated, and
-- it did not close. An unsealed route is an ordinary, valid movement session.
--
-- What is deliberately absent: any record of WHERE a loop closed. No
-- intersection coordinate, no sealed polygon, no route indices, no H3 trail.
-- That geometry is transient by design — the territory work that needs it can
-- recompute it from the route the client still holds — and a durable copy would
-- be a finer-grained trace of a player's movement than this table has ever kept.
--
-- Old rows are not backfilled. Reinterpreting a historical verification without
-- its raw route would mean inventing the answer, and the route was never stored.
ALTER TABLE "movement_verifications" ADD COLUMN "sealed" boolean;--> statement-breakpoint
ALTER TABLE "movement_verifications" ADD COLUMN "seal_methods" text[];--> statement-breakpoint
ALTER TABLE "movement_verifications" ADD COLUMN "seal_event_count" integer;
