/**
 * Canonical wallet-link / Base-Account challenge message (EIP-4361 "Sign-In
 * with Ethereum" compatible).
 *
 * Security property: the server BUILDS this message from the stored challenge
 * record at both issue time and verify time — it never parses a message the
 * client sends back and trusts its fields. That means every security-relevant
 * field (domain, address, uri, chainId, nonce, action, validity window) is
 * bound by the server, so a signature is only ever valid for the exact
 * challenge the server issued, on the exact domain and chain, for the exact
 * action. A signature captured for one action/domain/chain cannot be replayed
 * for another because the reconstructed message — and therefore the recovered
 * signer check — would differ.
 */
import type { WalletChallengeRecord } from "../repositories/records.js";

export interface ChallengeMessageFields {
  domain: string;
  address: string; // presentation (checksummed) address for readability
  uri: string;
  chainId: number;
  nonce: string;
  action: string;
  issuedAt: Date;
  expiresAt: Date;
  notBefore: Date;
}

/** Human-readable statement bound into the signed message per action. */
function statementFor(action: string): string {
  switch (action) {
    case "link_external_wallet":
      return "Link this wallet to your MovenRun account. This does not transfer any rewards or ownership.";
    case "base_account_login":
      return "Sign in to MovenRun with your Base Account.";
    default:
      return "Authorize a MovenRun wallet action.";
  }
}

export function buildChallengeMessage(fields: ChallengeMessageFields): string {
  // EIP-4361-shaped. `Resources` carries the MovenRun action so it is signed.
  return [
    `${fields.domain} wants you to sign in with your Ethereum account:`,
    fields.address,
    "",
    statementFor(fields.action),
    "",
    `URI: ${fields.uri}`,
    `Version: 1`,
    `Chain ID: ${fields.chainId}`,
    `Nonce: ${fields.nonce}`,
    `Issued At: ${fields.issuedAt.toISOString()}`,
    `Expiration Time: ${fields.expiresAt.toISOString()}`,
    `Not Before: ${fields.notBefore.toISOString()}`,
    `Resources:`,
    `- movenrun:action:${fields.action}`,
  ].join("\n");
}

/**
 * Rebuild the exact signed message from a persisted challenge plus the
 * presentation address. Used at verify time so the message is authoritative,
 * not attacker-supplied.
 */
export function messageFromChallenge(challenge: WalletChallengeRecord, presentationAddress: string): string {
  return buildChallengeMessage({
    domain: challenge.domain,
    address: presentationAddress,
    uri: challenge.uri,
    chainId: challenge.chainId,
    nonce: challenge.nonce,
    action: challenge.action,
    issuedAt: challenge.issuedAt,
    expiresAt: challenge.expiresAt,
    notBefore: challenge.notBefore,
  });
}
