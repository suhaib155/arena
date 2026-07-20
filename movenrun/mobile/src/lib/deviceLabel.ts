/**
 * Conservative device label — privacy by construction.
 *
 * The label is derived ONLY from the platform OS constant that ships with
 * React Native (`Platform.OS`), never from hardware identifiers, advertising
 * IDs, vendor IDs, device names requiring permissions, or user-agent strings.
 * It is a coarse, non-identifying hint ("iPhone" / "Android device") whose
 * only job is to help the user tell their own sessions apart. The server
 * independently sanitizes and length-caps whatever it receives and falls back
 * to a generic label, so nothing here is trusted for authorization.
 *
 * Platform-free on purpose (takes the OS string as an argument) so the exact
 * production logic is testable under node without React Native.
 */

export const GENERIC_DEVICE_LABEL = "MovenRun mobile";

/** Coarse label from the platform OS constant. Never identifying. */
export function buildDeviceLabel(platformOs: string | undefined): string {
  switch (platformOs) {
    case "ios":
      return "iPhone";
    case "android":
      return "Android device";
    default:
      return GENERIC_DEVICE_LABEL;
  }
}

const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * Defense-in-depth for DISPLAY of server-provided labels: the server already
 * sanitizes at write time, but the UI still refuses to render control
 * characters or absurd lengths and falls back to the generic label.
 */
export function displayDeviceLabel(label: string | null | undefined): string {
  if (typeof label !== "string") return GENERIC_DEVICE_LABEL;
  const collapsed = label.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0 || collapsed.length > 64) return GENERIC_DEVICE_LABEL;
  if (CONTROL_CHARS_RE.test(collapsed)) return GENERIC_DEVICE_LABEL;
  return collapsed;
}
