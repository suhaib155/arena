// Polls the local bench cluster every 15 s: per-database size, WAL position, and per-table size and
// n_dead_tup from pg_stat_user_tables (live counters, taken BEFORE the bench's own measurement VACUUMs).
import pg from "pg";
const out = process.argv[2];
import { writeFileSync, appendFileSync } from "node:fs";
const base = process.env.MOVENRUN_BENCH_DATABASE_URL!;
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(base)) throw new Error("local only");
writeFileSync(out, "t_s,database,relation,total_bytes,live_tup,dead_tup,n_ins,n_upd,n_del,n_hot_upd,autovacuum_count,wal_bytes_cluster\n");
const t0 = Date.now();
async function main() {
for (;;) {
  try {
    const admin = new pg.Client({ connectionString: base }); await admin.connect();
    const dbs = (await admin.query("SELECT datname FROM pg_database WHERE datname LIKE 'gameplay_bench%'")).rows;
    const wal = (await admin.query("SELECT pg_wal_lsn_diff(pg_current_wal_lsn(),'0/0') AS w")).rows[0].w;
    await admin.end();
    for (const d of dbs) {
      const u = new URL(base); u.pathname = "/" + d.datname;
      const c = new pg.Client({ connectionString: u.toString() });
      try {
        await c.connect();
        const r = await c.query(`SELECT relname, pg_total_relation_size(relid) AS b, n_live_tup, n_dead_tup, n_tup_ins, n_tup_upd, n_tup_del, n_tup_hot_upd, autovacuum_count FROM pg_stat_user_tables WHERE relname LIKE 'gameplay\\_%' OR relname='movement_verifications'`);
        const t = Math.round((Date.now() - t0) / 1000);
        for (const x of r.rows) appendFileSync(out, `${t},${d.datname},${x.relname},${x.b},${x.n_live_tup},${x.n_dead_tup},${x.n_tup_ins},${x.n_tup_upd},${x.n_tup_del},${x.n_tup_hot_upd},${x.autovacuum_count},${wal}\n`);
      } catch { /* database may be dropped mid-poll */ } finally { await c.end().catch(() => {}); }
    }
  } catch { /* cluster not up yet */ }
  await new Promise((r) => setTimeout(r, 15000));
}
}
main();
