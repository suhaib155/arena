/**
 * Compatibility redirect ONLY.
 *
 * `/onboarding` used to host a second, separate three-slide intro. There is now
 * exactly one canonical introduction (`/opening`), so this route keeps existing
 * deep links working and contains no UI, no copy, and no state of its own — a
 * source guard in `firstRunGuards.test.ts` enforces that.
 *
 * Remove this file once no shipped build or deep link targets `/onboarding`.
 */
import { Redirect } from "expo-router";

export default function OnboardingRedirect() {
  return <Redirect href="/opening" />;
}
