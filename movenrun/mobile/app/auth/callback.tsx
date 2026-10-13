/**
 * Landing route for `movenrun://auth/callback`, the Google sign-in redirect.
 *
 * The browser session that started Google sign-in reads this URL itself (see
 * `services/signInProviders.ts`). If the router also receives it, this screen
 * only steps out of the way, back to wherever sign-in started.
 */
import { useEffect } from "react";
import { useRouter } from "expo-router";
import { Screen } from "@/components/Screen";

export default function GoogleCallbackScreen() {
  const router = useRouter();
  useEffect(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }, [router]);
  return <Screen>{null}</Screen>;
}
