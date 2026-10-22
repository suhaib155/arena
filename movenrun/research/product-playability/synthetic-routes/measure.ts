/**
 * Run one fixture through the phone and the server and compare with the truth.
 */
import { offset, SYNTHETIC_ORIGIN } from "./frame";
import { runClient, truthDistance, type CandidateOptions, type ClientResult } from "./clientPipeline";
import { createServer, verifyOnServer, type ServerCandidateOptions, type ServerOutcome } from "./serverPipeline";
import type { Expectation, RouteFixture } from "./fixtures";

export interface Measurement {
  id: string;
  truthM: number;
  client: Omit<ClientResult, "points" | "submission"> & { points: number };
  server: ServerOutcome | { status: "not_submitted" };
  /** Duplicate upload of the same session (idempotency). */
  duplicate: ServerOutcome | null;
  companion: { client: number; server: string } | null;
}

export interface Check { name: keyof Expectation | "invariant"; pass: boolean; detail: string }

const NOT_SUBMITTED = { status: "not_submitted" as const };

export async function measure(fixture: RouteFixture, options: CandidateOptions & ServerCandidateOptions = {}): Promise<Measurement> {
  const client = runClient(fixture.scenario, options);
  const truthM = truthDistance(fixture.scenario, client);
  const id = `synthetic-${fixture.scenario.seed}`;
  // The server clock is real (GNSS) time, a few seconds after the finish.
  const serverNow = () => (client.metadata?.finishedAt ?? fixture.scenario.epochMs) + 5_000 -
    clockOffsetAtFinish(fixture);
  let server: Measurement["server"] = NOT_SUBMITTED;
  let duplicate: ServerOutcome | null = null;
  if (client.submission) {
    const s = createServer(serverNow, options);
    server = await verifyOnServer(s, id, client.submission);
    duplicate = await verifyOnServer(s, id, client.submission);
  }
  let companion: Measurement["companion"] = null;
  if (fixture.companionOffsetM) {
    const other = runClient({ ...fixture.scenario, seed: fixture.scenario.seed + 7,
      origin: offset(SYNTHETIC_ORIGIN, 0, fixture.companionOffsetM) }, options);
    let status = "not_submitted";
    if (other.submission) {
      const s = createServer(serverNow, options);
      status = (await verifyOnServer(s, `${id}-b`, other.submission, "synthetic-user-b")).status;
    }
    companion = { client: Math.round(other.distanceM), server: status };
  }
  const { points, submission: _s, ...rest } = client;
  return { id: fixture.id, truthM, client: { ...rest, points: points.length }, server, duplicate, companion };
}

function clockOffsetAtFinish(fixture: RouteFixture): number {
  const d = (fixture.scenario.disturbances ?? []).find((x) => x.type === "systemClock");
  return d && d.type === "systemClock" ? d.offsetMs : 0;
}

export function evaluate(fixture: RouteFixture, m: Measurement): Check[] {
  const e = fixture.expect;
  const c = m.client;
  const checks: Check[] = [];
  const add = (name: Check["name"], pass: boolean, detail: string) => checks.push({ name, pass, detail });
  if (e.start) add("start", c.start === e.start, `start=${c.start}`);
  if (e.lost !== undefined) add("lost", c.lostToProcessKill === e.lost, `lost=${c.lostToProcessKill}`);
  if (e.noXp) add("noXp", c.xpBankedOnSave === 0, `xpBankedOnSave=${c.xpBankedOnSave}`);
  if (e.xp) add("xp", c.xpBankedOnSave > 0, `xpBankedOnSave=${c.xpBankedOnSave}`);
  if (e.saveable !== undefined) add("saveable", c.saveable === e.saveable, `saveable=${c.saveable}`);
  if (e.distanceTolerance !== undefined) {
    const slack = e.distanceSlackM ?? 0;
    const lo = m.truthM * (1 - e.distanceTolerance) - slack, hi = m.truthM * (1 + e.distanceTolerance) + slack;
    add("distanceTolerance", c.distanceM >= lo && c.distanceM <= hi,
      `client=${c.distanceM.toFixed(1)} truth=${m.truthM.toFixed(1)} band=[${lo.toFixed(0)},${hi.toFixed(0)}]`);
  }
  if (e.maxInflationM !== undefined) {
    add("maxInflationM", c.distanceM <= m.truthM + e.maxInflationM,
      `client=${c.distanceM.toFixed(1)} truth=${m.truthM.toFixed(1)} limit=+${e.maxInflationM}`);
  }
  if (e.server) add("server", m.server.status === e.server, `server=${m.server.status}${"reasons" in m.server && m.server.reasons.length ? ` (${m.server.reasons.join("; ")})` : ""}`);
  if (e.serverAgreement !== undefined && "distanceMeters" in m.server && m.server.distanceMeters !== null) {
    const diff = Math.abs(m.server.distanceMeters - c.distanceM) / Math.max(1, c.distanceM);
    add("serverAgreement", diff <= e.serverAgreement, `server=${m.server.distanceMeters} client=${c.distanceM.toFixed(1)} diff=${(diff * 100).toFixed(2)}%`);
  }
  if (e.sealed !== undefined) add("sealed", c.sealed === e.sealed, `sealed=${c.sealed}`);
  if (e.gapNotice !== undefined) add("gapNotice", (c.gapNotice !== null) === e.gapNotice, `gapNotice=${JSON.stringify(c.gapNotice)}`);
  if (e.signalDegrades !== undefined) add("signalDegrades", (c.degradedSignals > 0) === e.signalDegrades,
    `degradedSignals=${c.degradedSignals} silentRejectSeconds=${c.silentRejectSeconds}`);

  /* Global invariants that hold for every fixture. */
  add("invariant", !(m.truthM < 30 && c.xpBankedOnSave > 0), "no movement XP when the walker did not move 30 m");
  add("invariant", m.duplicate === null || (m.duplicate.created === false && m.duplicate.status === m.server.status),
    `duplicate upload is idempotent (created=${m.duplicate?.created ?? "n/a"})`);
  add("invariant", !(c.saveable && c.movedOverGround && c.willSubmit === false), "a saveable moving session is submitted");
  return checks;
}
