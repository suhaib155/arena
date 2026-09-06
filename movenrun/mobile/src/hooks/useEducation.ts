import { useEffect, useSyncExternalStore } from "react";
import { education } from "@/services/education";
import { legalAccepted } from "@/lib/education";

export function useEducation() {
  const state = useSyncExternalStore(education.subscribe, education.getSnapshot, education.getSnapshot);
  useEffect(() => { void education.hydrate(); }, []);
  return state;
}

/** False until the current affirmative acknowledgment has loaded and persisted. */
export function useLegalAcceptance(): boolean {
  return legalAccepted(useEducation());
}
