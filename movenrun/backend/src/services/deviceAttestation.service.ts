import { createPublicKey, createVerify } from "crypto";

// Set SKIP_DEVICE_ATTESTATION=true in .env for local development and CI
const SKIP_ATTESTATION = process.env.SKIP_DEVICE_ATTESTATION === "true";

// Apple DeviceCheck attestation endpoint
const APPLE_ATTESTATION_URL = "https://data.appattest.apple.com/v1/attestationData";

export interface AttestationResult {
  valid: boolean;
  skipped?: boolean;
  error?: string;
}

/// Verify an Apple App Attest attestation object.
/// @param attestation Base64-encoded CBOR attestation from the device
/// @param challenge   The challenge string that was sent to the device
export async function verifyAppleAttestation(
  attestation: string,
  challenge: string
): Promise<boolean> {
  if (SKIP_ATTESTATION) {
    console.warn("[DeviceAttestation] SKIP_DEVICE_ATTESTATION=true — skipping Apple check");
    return true;
  }

  try {
    const response = await fetch(APPLE_ATTESTATION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attestation,
        challenge,
      }),
    });

    if (!response.ok) {
      console.error("[DeviceAttestation] Apple attestation rejected:", response.status);
      return false;
    }

    return true;
  } catch (err) {
    console.error("[DeviceAttestation] Apple attestation error:", err);
    return false;
  }
}

/// Verify an Android SafetyNet JWS token.
/// Checks: basicIntegrity and ctsProfileMatch fields in the payload.
/// @param attestation JWS token string from SafetyNet / Play Integrity API
export async function verifyAndroidAttestation(attestation: string): Promise<boolean> {
  if (SKIP_ATTESTATION) {
    console.warn("[DeviceAttestation] SKIP_DEVICE_ATTESTATION=true — skipping Android check");
    return true;
  }

  try {
    const parts = attestation.split(".");
    if (parts.length !== 3) {
      console.error("[DeviceAttestation] Invalid JWS format");
      return false;
    }

    // Decode payload (middle part)
    const payloadB64 = parts[1];
    const paddedPayload = payloadB64 + "=".repeat((4 - (payloadB64.length % 4)) % 4);
    const payload = JSON.parse(Buffer.from(paddedPayload, "base64url").toString("utf8"));

    const basicIntegrity: boolean = payload.basicIntegrity === true;
    const ctsProfileMatch: boolean = payload.ctsProfileMatch === true;

    if (!basicIntegrity) {
      console.warn("[DeviceAttestation] Android: basicIntegrity failed");
      return false;
    }
    if (!ctsProfileMatch) {
      console.warn("[DeviceAttestation] Android: ctsProfileMatch failed");
      return false;
    }

    // Verify the JWS signature using the header's x5c certificate chain
    const headerB64 = parts[0];
    const paddedHeader = headerB64 + "=".repeat((4 - (headerB64.length % 4)) % 4);
    const header = JSON.parse(Buffer.from(paddedHeader, "base64url").toString("utf8"));

    if (!header.x5c || !Array.isArray(header.x5c) || header.x5c.length === 0) {
      console.error("[DeviceAttestation] Android: missing x5c certificate chain");
      return false;
    }

    // The leaf certificate (first in x5c) holds the signing public key
    const leafCertPem =
      "-----BEGIN CERTIFICATE-----\n" +
      (header.x5c[0] as string).match(/.{1,64}/g)!.join("\n") +
      "\n-----END CERTIFICATE-----";

    const publicKey = createPublicKey(leafCertPem);
    const signingInput = `${parts[0]}.${parts[1]}`;
    const signatureBuffer = Buffer.from(
      parts[2] + "=".repeat((4 - (parts[2].length % 4)) % 4),
      "base64url"
    );

    const verifier = createVerify("SHA256");
    verifier.update(signingInput);
    const signatureValid = verifier.verify(publicKey, signatureBuffer);

    if (!signatureValid) {
      console.error("[DeviceAttestation] Android: JWS signature invalid");
      return false;
    }

    return true;
  } catch (err) {
    console.error("[DeviceAttestation] Android attestation error:", err);
    return false;
  }
}
