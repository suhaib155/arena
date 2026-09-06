import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Screen } from "@/components/Screen";
import { ScreenHeader } from "@/components/ScreenHeader";
import { LegalLinks } from "@/components/LegalAcceptance";
import { LEGAL_VERSION } from "@/lib/education";
import { colors, spacing, type } from "@/theme";

const PRIVACY = [
  ["Location and maps", "Location is used in the foreground during an active movement session or when you explicitly tap Locate me on a map. Locate me requests a single fix; it does not start workout tracking. MovenRun does not record background location. Map providers receive map-area requests to display real tiles; viewing a map is not an entirely offline activity."],
  ["Session verification", "When an account service is configured and you are signed in, saving a session can send its route to MovenRun for verification. Pending verification routes are account-scoped, kept on this device for up to seven days, and deleted on expiry, discard or sign-out. Without that service, progress remains on this device."],
  ["Progress and sharing", "Progress history, route reviews and passport summaries do not contain coordinates or a route path. A visual share image can show your route and recognizable places. Endpoint redaction is on by default. Sharing sends the image to the app you choose; review it before sharing."],
  ["Your choices", "Location permission is requested separately through your device. This acknowledgment does not replace OS permissions. You can stop or discard a move, sign out, or reset local progress. Help-guide choices and this policy acknowledgment are stored for this installation, without account or location details."],
];
const TERMS = [
  ["Current demo", "MovenRun is a movement-game preview. XP and progress are in-app features. This build offers no purchase, reward payout or minting. Territory and Deed previews do not establish permanent ownership."],
  ["Move with care", "Choose safe places and activities suitable for you. Pay attention to your surroundings and stop when you need to. Quest timers and GPS estimates are game features, not medical or navigation advice."],
  ["Accounts and availability", "You can explore without an account. Sign-in and session verification require an available account service. Local progress is not a promise of cloud backup or future rewards."],
  ["Permissions and sharing", "Use the device permission controls to manage location access. Share only images you are comfortable sending to the selected app, and retain the map provider attribution in shared map images."],
];

export default function LegalScreen() {
  const { kind } = useLocalSearchParams<{ kind?: string }>();
  const privacy = kind === "privacy";
  return <Screen>
    <ScreenHeader title={privacy ? "Privacy Policy" : "Terms of Use"} />
    <ScrollView contentContainerStyle={styles.content}>
      {(privacy ? PRIVACY : TERMS).map(([title, body]) => <View key={title} style={styles.section}>
        <Text accessibilityRole="header" style={styles.heading}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
      </View>)}
      <Text style={styles.version}>Version {LEGAL_VERSION}</Text>
      <LegalLinks />
    </ScrollView>
  </Screen>;
}
const styles = StyleSheet.create({
  content: { gap: spacing.lg, paddingVertical: spacing.lg, paddingBottom: spacing.xxl }, section: { gap: spacing.sm },
  heading: { ...type.heading }, body: { ...type.body }, version: { ...type.caption, color: colors.textFaint },
});
