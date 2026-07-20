/**
 * Device-label sanitization (session/device management, PR #53).
 *
 * The label is a purely cosmetic, client-supplied hint ("iPhone", "Pixel 8")
 * shown back to the SAME user in their session inventory. It is NEVER trusted
 * for authorization, never logged or written into audit metadata, and never
 * fingerprint-derived — the mobile client sends only the OS-level device name
 * (no permissions) or a platform generic.
 *
 * Fail-safe policy: anything malformed (non-string, empty after whitespace
 * normalization, control characters, overlong) sanitizes to null, and the
 * public view falls back to GENERIC_DEVICE_LABEL — a bad label can only ever
 * degrade to the generic name, never break rendering or smuggle content into
 * logs.
 */

export const DEVICE_LABEL_MAX_LENGTH = 64;

/** Control characters incl. C1 range and DEL — rejected outright rather than
 *  stripped, so a hostile label can't be laundered into a clean-looking one. */
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f-\u009f]/;

/** Normalize a client-supplied device label, or return null when malformed. */
export function sanitizeDeviceLabel(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const collapsed = input.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0 || collapsed.length > DEVICE_LABEL_MAX_LENGTH) return null;
  if (CONTROL_CHARS_RE.test(collapsed)) return null;
  return collapsed;
}
