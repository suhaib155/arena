import { ethers } from "ethers";
import * as h3 from "h3-js";
/* Deep source path, matching services/hex.service.ts: the shared package's
   `dist` is not built in this workspace, so the package root does not resolve
   at runtime, while this path does. One source of truth, no build step. */
import { H3_RESOLUTION } from "@movenrun/shared/src/constants/h3.js";
import {
  DEED_CLAIM_TTL_SECONDS,
  DEED_CLAIM_TYPES,
  DeedOracleService,
} from "./deedOracle.service.js";

/**
 * DeedClaimBridge — turns one server-verified movement session into one public
 * claim authorization for one traversed cell.
 *
 * This is an operator tool, not a product surface. It is not an HTTP endpoint,
 * not a mint API, and not a relaxation of `/gps/submit` or `/movement/verify`.
 * It exists so a human running a pilot can hand a participant the exact bundle
 * their wallet needs, and nothing else.
 *
 * ## Where eligibility comes from
 *
 * The persisted verification record, and only that. Every input the operator
 * supplies is a *selector* — which user, which session, which cell, which
 * claimant — and none of it is evidence. The record's own `status` and its
 * server-derived `traversedHexIds` are the authority.
 *
 * In particular this never reads `hex_activities` (nothing writes it), never
 * reads the mobile app's local territory simulation (it is a simulation), and
 * never accepts a caller-supplied `verified`, distance, cell list, capture, XP
 * or trust score.
 *
 * ## What rule decides which cell
 *
 * None is invented here. The operator names the cell; this signs only if that
 * cell is in the verified traversed set. There is no first-cell-wins, no
 * longest-dwell, no one-per-kilometre and no one-per-session, because no such
 * rule exists in any contract or specification in this repository, and encoding
 * one silently would make an economic decision inside a signing utility.
 *
 * `shared/constants/h3.ts` does define MIN_ACTIVITY_THRESHOLD (5 unique movers
 * over 90 days) as a *zone mint* eligibility rule, but that rule belongs to the
 * V1 ZoneNFT economy, is evaluated against `hex_activities`, and `hex_activities`
 * has no writer anywhere in the codebase. It therefore cannot be evaluated, and
 * pretending to apply it would be worse than declining to.
 */

/**
 * The narrow slice of a verification record this bridge needs.
 *
 * Declared structurally rather than imported so this module compiles against
 * `main` while the movement-verification work is still in review. The real
 * repository satisfies it exactly — same field names, same types — and the
 * integration proof runs against that real implementation rather than a stub.
 * This is a port, not a second source of truth: nothing here can invent a
 * verification, only read one.
 */
export interface VerifiedMovementRecordView {
  id: string;
  userId: string;
  clientSessionId: string;
  /** "verified" | "rejected". Anything but "verified" is refused. */
  status: string;
  /** Server-derived. The only cell authority. */
  traversedHexIds: string[];
}

export interface VerifiedMovementLookup {
  /** Scoped by userId, so one user's session can never be read as another's. */
  findByUserSession(
    userId: string,
    clientSessionId: string,
  ): Promise<VerifiedMovementRecordView | null>;
}

export interface ClaimBundleRequest {
  /** The account the verification belongs to. A selector, never authority. */
  userId: string;
  /** The session's stable client id. A selector. */
  clientSessionId: string;
  /** The H3 cell the operator intends to authorize, as an H3 index string. */
  cellId: string;
  /** The participant's own wallet. This address, and no other, may claim. */
  claimant: string;
  /** Injected clock, so deadline behaviour is testable. */
  now?: () => number;
}

/**
 * Exactly what a participant needs, and nothing else.
 *
 * No raw coordinates, no route, no full traversed-cell set, no bearer or
 * refresh token, no email, no session payload. A claim bundle is handed to
 * another person and may be pasted into a wallet UI or a chat, so it must be
 * safe at rest in someone else's hands — one cell, not a location trail.
 */
export interface DeedClaimBundle {
  chainId: number;
  registryAddress: string;
  claimant: string;
  /** The uint64 the contract takes, as a decimal string (JSON-safe). */
  cellId: string;
  /** The same cell in canonical H3 hex, for a human to check. */
  h3Cell: string;
  claimId: string;
  deadline: number;
  signature: string;
  /** The full EIP-712 payload, so a participant can verify what was signed
   *  rather than trusting the operator's summary of it. */
  typedData: {
    domain: { name: string; version: string; chainId: number; verifyingContract: string };
    types: typeof DEED_CLAIM_TYPES;
    primaryType: "DeedClaim";
    message: { cellId: string; claimant: string; claimId: string; deadline: number };
  };
}

/** Why a bundle was refused. Carries no payload — the reason is a category. */
export type ClaimRefusal =
  | "verification_not_found"
  | "verification_not_verified"
  | "cell_not_traversed"
  | "cell_wrong_resolution"
  | "cell_malformed"
  | "claimant_invalid";

export class ClaimBridgeError extends Error {
  readonly reason: ClaimRefusal;
  constructor(reason: ClaimRefusal) {
    // Deliberately terse: no cell list, no user id, no route, no record.
    super(`deed claim refused: ${reason}`);
    this.name = "ClaimBridgeError";
    this.reason = reason;
  }
}

/** H3 indexes are 64-bit; the registry's token id is the same value widened. */
const MAX_UINT64 = (1n << 64n) - 1n;

function cellToUint64(cell: string): bigint {
  if (!/^[0-9a-fA-F]{1,16}$/.test(cell)) throw new ClaimBridgeError("cell_malformed");
  const value = BigInt(`0x${cell}`);
  if (value > MAX_UINT64) throw new ClaimBridgeError("cell_malformed");
  return value;
}

export class DeedClaimBridge {
  constructor(
    private readonly oracle: DeedOracleService,
    private readonly lookup: VerifiedMovementLookup,
  ) {}

  /**
   * Build one claim bundle, or refuse.
   *
   * Order matters and is the security property: the verification is fetched and
   * checked before the cell is considered, and the cell is checked against the
   * server-derived set before anything is signed. There is no arrangement of
   * inputs that reaches the signer without both having passed.
   */
  async issue(request: ClaimBundleRequest): Promise<DeedClaimBundle> {
    if (!ethers.isAddress(request.claimant) || request.claimant === ethers.ZeroAddress) {
      throw new ClaimBridgeError("claimant_invalid");
    }

    const record = await this.lookup.findByUserSession(
      request.userId,
      request.clientSessionId,
    );
    if (!record) throw new ClaimBridgeError("verification_not_found");
    if (record.status !== "verified") throw new ClaimBridgeError("verification_not_verified");

    const cell = request.cellId.toLowerCase();

    /* The cell must be one the SERVER derived for this session. An operator
       naming a cell the route never entered is the mistake this check exists
       for, and it is the one that would be least visible afterwards. */
    const traversed = record.traversedHexIds.map((c) => c.toLowerCase());
    if (!traversed.includes(cell)) throw new ClaimBridgeError("cell_not_traversed");

    /* Resolution is proven from the index itself rather than assumed from the
       constant, so a cell that is somehow in the set at another resolution
       cannot become a deed at the wrong granularity. */
    if (!h3.isValidCell(cell)) throw new ClaimBridgeError("cell_malformed");
    if (h3.getResolution(cell) !== H3_RESOLUTION) {
      throw new ClaimBridgeError("cell_wrong_resolution");
    }

    const cellId = cellToUint64(cell);
    const claimant = ethers.getAddress(request.claimant);
    const claimId = DeedOracleService.newClaimId();
    const nowMs = (request.now ?? Date.now)();
    const deadline = Math.floor(nowMs / 1000) + DEED_CLAIM_TTL_SECONDS;

    const signature = await this.oracle.signClaim(
      { cellId, claimant, claimId, deadline },
      // Established above from the persisted record, not asserted by a caller.
      true,
    );

    return {
      chainId: Number(this.oracle.chainId),
      registryAddress: this.oracle.registryAddress,
      claimant,
      cellId: cellId.toString(),
      h3Cell: cell,
      claimId,
      deadline,
      signature,
      typedData: {
        domain: {
          name: this.oracle.domain.name as string,
          version: this.oracle.domain.version as string,
          chainId: Number(this.oracle.chainId),
          verifyingContract: this.oracle.registryAddress,
        },
        types: DEED_CLAIM_TYPES,
        primaryType: "DeedClaim",
        message: {
          cellId: cellId.toString(),
          claimant,
          claimId,
          deadline,
        },
      },
    };
  }
}
