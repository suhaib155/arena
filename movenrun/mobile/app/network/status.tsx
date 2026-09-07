import { Redirect } from "expo-router";

/** Preserve existing bookmarks while technical information lives in Settings. */
export default function NetworkStatusRedirect() {
  return <Redirect href="/settings/technical" />;
}
