/**
 * The identity state machines, written down.
 *
 * Each status column below used to be described only by the code that
 * writes it. These tables are the intended moves, kept beside the types so
 * a reviewer reads one screen instead of every repository. They do not
 * change any write: the stores still guard the way they did (see the
 * per-table notes). Tests in `transitions.test.ts` drive the in-memory stores
 * and the services through the real flows and check each observed move
 * against these tables. The full catalogue, with known gaps, is
 * `docs/STATE_MACHINES.md`.
 */
import { defineTransitions } from "@movenrun/shared/state-machine";
import type {
  ProvisioningState,
  SessionStatus,
  UserStatus,
  WalletOwnershipStatus,
} from "./types.js";
import type { ProviderEventState } from "../webhooks/types.js";

/**
 * Sessions. `rotated` is a superseded refresh credential; revoking a family
 * reaches rotated rows too, which is how refresh replay ends a whole family.
 * The stores guard `active -> rotated` on `status = 'active'` and every revoke
 * on `revoked_at IS NULL`.
 */
export const SESSION_STATUS_TRANSITIONS = defineTransitions<SessionStatus>({
  active: ["rotated", "revoked"],
  rotated: ["revoked"],
  revoked: [],
});

/**
 * Embedded-wallet provisioning, as the comment on `ProvisioningState` states
 * it. `provisioning -> provisioning` is listed because `provision()` writes
 * `provisioning` again when it finds an attempt that never settled; that is
 * the only way out of a crash mid-attempt.
 */
export const PROVISIONING_TRANSITIONS = defineTransitions<ProvisioningState>({
  requested: ["provisioning"],
  provisioning: ["provisioning", "active", "failed_transient", "failed_terminal"],
  failed_transient: ["provisioning"],
  active: [],
  failed_terminal: [],
});

/** Wallet ownership. `revoked` keeps the row for history and has no exit. */
export const WALLET_OWNERSHIP_TRANSITIONS = defineTransitions<WalletOwnershipStatus>({
  unverified: ["verified", "revoked"],
  verified: ["revoked"],
  revoked: [],
});

/** Users. There is no re-enable path; deletion removes the row instead. */
export const USER_STATUS_TRANSITIONS = defineTransitions<UserStatus>({
  active: ["disabled"],
  disabled: [],
});

/**
 * Provider (webhook) events. Matches the compare-and-set in the event stores:
 * `claim` takes `received`, `retryable_failure`, or a `processing` row whose
 * lease expired; every settle requires `processing` plus the claim's token.
 * The database CHECK `provider_events_state_valid` holds the same six values.
 */
export const PROVIDER_EVENT_TRANSITIONS = defineTransitions<ProviderEventState>({
  received: ["processing"],
  processing: ["processing", "processed", "retryable_failure", "terminal_failure", "ignored"],
  retryable_failure: ["processing"],
  processed: [],
  terminal_failure: [],
  ignored: [],
});
