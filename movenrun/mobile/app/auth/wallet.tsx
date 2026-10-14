/**
 * Landing route for `movenrun://auth/wallet?code=…`, where MovenRun's wallet
 * sign-in page sends the person back after their wallet signed.
 *
 * The code is spent with the verifier this device kept when the sign-in
 * started, then the screen steps back to wherever sign-in began. Anything
 * else in the link is ignored. If this fails, the sign-in block still offers
 * to type the code in.
 */
import { useEffect, useRef } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Screen } from "@/components/Screen";
import { colors, spacing, type } from "@/theme";
import { useAuthStore } from "@/store/useAuthStore";
import { normalizeHandoffCode } from "@/lib/signInMethods";
import { buildDeviceLabel } from "@/lib/deviceLabel";
import { finishWalletSignIn } from "@/services/signInProviders";
import { isSignInMethodEnabled } from "@/lib/releaseScope";

export default function WalletReturnScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();
  const signInWith = useAuthStore((s) => s.signInWith);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const code = normalizeHandoffCode(typeof params.code === "string" ? params.code : "");
    const leave = () => { if (router.canGoBack()) router.back(); else router.replace("/account"); };
    if (!isSignInMethodEnabled("wallet") || !code || useAuthStore.getState().status === "signedIn") {
      leave();
      return;
    }
    void signInWith((client) => finishWalletSignIn(client, code, buildDeviceLabel(Platform.OS))).finally(leave);
  }, [params.code, router, signInWith]);

  return (
    <Screen>
      <View style={styles.center} accessibilityLiveRegion="polite">
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.body}>Finishing wallet sign-in…</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  body: { ...type.body, color: colors.textDim },
});
