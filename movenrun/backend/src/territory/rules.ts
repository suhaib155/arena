/**
 * Territory game rules — the balancing numbers and the pure state machine.
 *
 * ## Why the numbers live here
 * None of these values are hardcoded inside the ownership service. They sit in
 * one exported constant so balancing is a data change with a diff, reviewable
 * on its own, rather than an archaeology exercise across service code.
 *
 * ## Deliberately simple, for now
 * The first implementation is a readable, testable scoring pass: a cell earns
 * control/defence from the quality and directness of the run that touched it,
 * loses defence to rivals, and only changes hands through an explicit
 * `contested` step. No streak multipliers, no decay curves, no market
 * mechanics — those are balancing work that needs real play data, and adding
 * them now would make the rules untestable without making them fairer.
 *
 * ## The one rule that is not negotiable
 * **Ownership never flips on a single ordinary pass.** An attack drives defence
 * down; only a cell already at zero defence (state `contested`) can transfer,
 * and only to an actor who performs another qualifying action on it. That is
 * what stops a runner sniping a well-defended cell by jogging through it once.
 */
import type {
  CellClassification,
  TerritoryEventType,
  TerritoryRecord,
  TerritoryRelationship,
  TerritoryState,
} from "./types.js";
import { isCapturableClassification } from "./types.js";

export interface TerritoryRules {
  /** Control/defence a freshly captured neutral cell starts with. */
  captureControl: number;
  captureDefence: number;

  /** Defence added when the owner encloses a cell they already hold. */
  reinforceEnclosed: number;
  /** Defence added when the owner physically runs through it. Higher: being
   *  there is stronger evidence of presence than drawing a loop around it. */
  reinforceCrossed: number;
  /** Control added alongside a reinforcement. */
  reinforceControl: number;

  /** Defence removed from a rival cell merely enclosed by the loop. */
  attackEnclosed: number;
  /** Defence removed from a rival cell the attacker ran directly through. */
  attackCrossed: number;

  /** Ceilings, so a cell cannot be farmed into invulnerability. */
  maxDefence: number;
  maxControl: number;

  /**
   * A contested cell transfers on a qualifying action. Set above 1 to require
   * several separate runs before a transfer completes.
   */
  contestedActionsToTransfer: number;

  /** Multiplier applied to every delta when the run's GPS quality was poor. */
  poorQualityMultiplier: number;

  /** ms after which an owned cell with no defence activity becomes dormant. */
  dormantAfterMs: number;
}

export const TERRITORY_RULES: TerritoryRules = {
  captureControl: 10,
  captureDefence: 10,

  reinforceEnclosed: 3,
  reinforceCrossed: 6,
  reinforceControl: 2,

  attackEnclosed: 2,
  attackCrossed: 5,

  maxDefence: 100,
  maxControl: 100,

  contestedActionsToTransfer: 1,

  poorQualityMultiplier: 0.5,

  // 30 days.
  dormantAfterMs: 30 * 24 * 60 * 60 * 1000,
};

/** How the acting run touched one cell. */
export type CellTouch =
  /** The runner physically passed through it. */
  | "crossed"
  /** The loop enclosed it, but the runner did not enter it. */
  | "enclosed";

/** Everything the rules need to know about the acting run and actor. */
export interface ActorContext {
  walletAddress: string;
  userId: string | null;
  clubId: string | null;
  /** Set when the run's GPS quality was flagged — deltas are damped. */
  degradedQuality: boolean;
}

/** The decision for one cell. Pure data; the caller performs the writes. */
export interface CellOutcome {
  cellId: string;
  eventType: TerritoryEventType;
  nextState: TerritoryState;
  nextOwnerWalletAddress: string | null;
  nextOwnerUserId: string | null;
  nextOwnerClubId: string | null;
  controlDelta: number;
  defenceDelta: number;
  /** Set when nothing happened — the cell is reported as rejected. */
  rejectionReason: CellRejectionReason | null;
}

export type CellRejectionReason =
  | "restrictedClassification"
  | "protectedTerritory"
  | "gridVersionMismatch";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function scaled(value: number, actor: ActorContext): number {
  const raw = actor.degradedQuality ? value * TERRITORY_RULES.poorQualityMultiplier : value;
  // Round away from zero so a damped delta never silently becomes a no-op.
  return raw >= 0 ? Math.ceil(raw) : Math.floor(raw);
}

function ownedBy(territory: TerritoryRecord, actor: ActorContext): boolean {
  return (
    territory.ownerWalletAddress !== null &&
    territory.ownerWalletAddress.toLowerCase() === actor.walletAddress.toLowerCase()
  );
}

function ownedByActorsClub(territory: TerritoryRecord, actor: ActorContext): boolean {
  return (
    actor.clubId !== null &&
    territory.ownerClubId !== null &&
    territory.ownerClubId === actor.clubId
  );
}

function rejection(
  cellId: string,
  territory: TerritoryRecord,
  reason: CellRejectionReason,
): CellOutcome {
  return {
    cellId,
    eventType: "restricted",
    nextState: territory.state,
    nextOwnerWalletAddress: territory.ownerWalletAddress,
    nextOwnerUserId: territory.ownerUserId,
    nextOwnerClubId: territory.ownerClubId,
    controlDelta: 0,
    defenceDelta: 0,
    rejectionReason: reason,
  };
}

/**
 * Decide what one qualifying action does to one cell.
 *
 * Pure: same inputs, same outcome, no clock, no I/O. The ownership service
 * applies the result inside a transaction with the row locked.
 */
export function resolveCellOutcome(
  territory: TerritoryRecord,
  touch: CellTouch,
  actor: ActorContext,
  rules: TerritoryRules = TERRITORY_RULES,
): CellOutcome {
  const cellId = territory.h3CellId;

  // Ground that is not playable is never captured, reinforced or attacked.
  if (!isCapturableClassification(territory.classification) || territory.state === "restricted") {
    return rejection(cellId, territory, "restrictedClassification");
  }
  // Protected cells absorb everything without changing.
  if (territory.state === "protected") {
    return rejection(cellId, territory, "protectedTerritory");
  }

  const keepOwner = {
    nextOwnerWalletAddress: territory.ownerWalletAddress,
    nextOwnerUserId: territory.ownerUserId,
    nextOwnerClubId: territory.ownerClubId,
  };
  const takeOwner = {
    nextOwnerWalletAddress: actor.walletAddress,
    nextOwnerUserId: actor.userId,
    nextOwnerClubId: actor.clubId,
  };

  // ---- Neutral (or dormant, which behaves as re-claimable): capture.
  if (
    territory.state === "neutral" ||
    territory.state === "dormant" ||
    territory.ownerWalletAddress === null
  ) {
    return {
      cellId,
      eventType: "captured",
      nextState: "owned",
      ...takeOwner,
      controlDelta: scaled(rules.captureControl, actor),
      defenceDelta: scaled(rules.captureDefence, actor),
      rejectionReason: null,
    };
  }

  // ---- Contested: this action completes the transfer.
  if (territory.state === "contested") {
    if (ownedBy(territory, actor)) {
      // The incumbent came back and re-secured their own contested cell.
      return {
        cellId,
        eventType: "reinforced",
        nextState: "owned",
        ...keepOwner,
        controlDelta: scaled(rules.reinforceControl, actor),
        defenceDelta: scaled(
          touch === "crossed" ? rules.reinforceCrossed : rules.reinforceEnclosed,
          actor,
        ),
        rejectionReason: null,
      };
    }
    return {
      cellId,
      eventType: "transferred",
      nextState: "owned",
      ...takeOwner,
      // A transferred cell starts fresh rather than inheriting the loser's
      // score, so a long-held cell isn't handed over pre-fortified.
      controlDelta: scaled(rules.captureControl, actor) - territory.controlScore,
      defenceDelta: scaled(rules.captureDefence, actor) - territory.defenceScore,
      rejectionReason: null,
    };
  }

  // ---- Owned by the actor, or by the actor's club: reinforce.
  if (ownedBy(territory, actor) || ownedByActorsClub(territory, actor)) {
    return {
      cellId,
      eventType: "reinforced",
      nextState: "owned",
      ...keepOwner,
      controlDelta: scaled(rules.reinforceControl, actor),
      defenceDelta: scaled(
        touch === "crossed" ? rules.reinforceCrossed : rules.reinforceEnclosed,
        actor,
      ),
      rejectionReason: null,
    };
  }

  // ---- Owned by a rival: attack. Crossing hits harder than enclosing.
  const damage = scaled(touch === "crossed" ? rules.attackCrossed : rules.attackEnclosed, actor);
  const nextDefence = territory.defenceScore - damage;

  if (nextDefence <= 0) {
    // Defence collapsed — the cell becomes contested. Ownership does NOT
    // change here: a second qualifying action is required to take it.
    return {
      cellId,
      eventType: "contested",
      nextState: "contested",
      ...keepOwner,
      controlDelta: 0,
      defenceDelta: -territory.defenceScore,
      rejectionReason: null,
    };
  }

  return {
    cellId,
    eventType: "attacked",
    nextState: "owned",
    ...keepOwner,
    controlDelta: 0,
    defenceDelta: -damage,
    rejectionReason: null,
  };
}

/** Apply an outcome's deltas to a record, clamped to the configured ceilings. */
export function applyOutcomeScores(
  territory: TerritoryRecord,
  outcome: CellOutcome,
  rules: TerritoryRules = TERRITORY_RULES,
): { controlScore: number; defenceScore: number } {
  return {
    controlScore: clamp(territory.controlScore + outcome.controlDelta, 0, rules.maxControl),
    defenceScore: clamp(territory.defenceScore + outcome.defenceDelta, 0, rules.maxDefence),
  };
}

/**
 * How a cell relates to the requesting user. Computed per request; never
 * stored, because the same cell is `mine` to one runner and `rival` to another.
 */
/**
 * Who is asking (D2).
 *
 * `walletAddresses` is a list because one account can link several wallets, and
 * territory captured from any of them is still *theirs*. It is populated only
 * from a verified session — there is deliberately no field here a client could
 * set directly.
 */
export interface TerritoryViewer {
  /** Verified user id, or null for an anonymous caller. */
  userId: string | null;
  /** Every wallet address the verified user owns, lowercased. */
  walletAddresses: string[];
  clubId: string | null;
  /** False for an anonymous caller. Drives the `claimed` answer below. */
  authenticated: boolean;
}

/** An anonymous viewer. The only viewer that can be constructed without auth. */
export const ANONYMOUS_VIEWER: TerritoryViewer = {
  userId: null,
  walletAddresses: [],
  clubId: null,
  authenticated: false,
};

export function relationshipFor(
  territory: Pick<
    TerritoryRecord,
    "state" | "ownerWalletAddress" | "ownerClubId" | "classification"
  >,
  viewer: TerritoryViewer,
): TerritoryRelationship {
  if (territory.state === "restricted" || !isCapturableClassification(territory.classification)) {
    return "restricted";
  }
  if (territory.state === "protected") return "protected";
  if (territory.state === "contested") return "contested";
  if (!territory.ownerWalletAddress || territory.state === "neutral") return "neutral";

  // An anonymous caller gets `claimed`, never `rival`. `rival` asserts the cell
  // belongs to somebody *other than the viewer*, and that is not knowable
  // without an identity — asserting it anyway is what made a runner's own
  // territory render in rival colours (D2).
  if (!viewer.authenticated) return "claimed";

  const owner = territory.ownerWalletAddress.toLowerCase();
  if (viewer.walletAddresses.includes(owner)) return "mine";
  if (viewer.clubId && territory.ownerClubId && territory.ownerClubId === viewer.clubId) {
    return "club";
  }
  return "rival";
}

/** Whether a viewer may attack or reinforce a cell as it currently stands. */
export function actionEligibility(
  territory: Pick<
    TerritoryRecord,
    "state" | "ownerWalletAddress" | "ownerClubId" | "classification"
  >,
  viewer: TerritoryViewer,
): { canCapture: boolean; canReinforce: boolean; canAttack: boolean } {
  const relationship = relationshipFor(territory, viewer);
  switch (relationship) {
    case "restricted":
    case "protected":
      return { canCapture: false, canReinforce: false, canAttack: false };
    case "neutral":
      return { canCapture: true, canReinforce: false, canAttack: false };
    case "claimed":
      // Anonymous: the ground is held by someone, but we cannot say by whom
      // relative to this caller, so we promise them no action at all.
      return { canCapture: false, canReinforce: false, canAttack: false };
    case "mine":
    case "club":
      return { canCapture: false, canReinforce: true, canAttack: false };
    case "contested":
      return { canCapture: true, canReinforce: true, canAttack: false };
    case "rival":
      return { canCapture: false, canReinforce: false, canAttack: true };
  }
}

/** A default record for a cell that has never been touched. */
export function neutralTerritory(
  h3CellId: string,
  gridVersion: number,
  resolution: number,
  classification: CellClassification = "playable",
  now: Date = new Date(),
): TerritoryRecord {
  return {
    h3CellId,
    h3Resolution: resolution,
    gridVersion,
    ownerWalletAddress: null,
    ownerUserId: null,
    ownerClubId: null,
    state: isCapturableClassification(classification) ? "neutral" : "restricted",
    classification,
    controlScore: 0,
    defenceScore: 0,
    capturedAt: null,
    lastDefendedAt: null,
    contestedAt: null,
    expiresAt: null,
    version: 0,
    createdAt: now,
    updatedAt: now,
  };
}
