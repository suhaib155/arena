import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { colors, spacing, type } from "@/theme";

export default function NotFound() {
  const router = useRouter();
  return (
    <Screen>
      <View style={styles.center}>
        <Ionicons name="compass-outline" size={48} color={colors.textFaint} />
        <Text style={styles.title}>Lost the trail</Text>
        <Text style={styles.subtitle}>This screen doesn&apos;t exist.</Text>
        <Button label="Back to quests" icon="home" onPress={() => router.replace("/")} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  title: { ...type.title },
  subtitle: { ...type.body, marginBottom: spacing.md },
});
