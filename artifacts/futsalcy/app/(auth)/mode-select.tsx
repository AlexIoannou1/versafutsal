import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useAuth, AppMode } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import FeatherIcons from "@/components/FeatherIcons";
import * as Haptics from "expo-haptics";

interface ModeOption {
  mode: AppMode;
  label: string;
  subtitle: string;
  icon: keyof typeof FeatherIcons.glyphMap;
}

const MODES: ModeOption[] = [
  {
    mode: "PLAYER",
    label: "Continue as Player",
    subtitle: "Discover and book pitches",
    icon: "user",
  },
  {
    mode: "VENUE_OWNER",
    label: "Continue as Venue Owner",
    subtitle: "Manage venues and bookings",
    icon: "grid",
  },
];

export default function ModeSelectScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { selectMode } = useAuth();

  const handleSelect = async (mode: AppMode) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await selectMode(mode);
    router.push("/(auth)/login");
  };

  const handleAdminLogin = async () => {
    await selectMode("ADMIN");
    router.push("/(auth)/login");
  };

  const s = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
      paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0),
      paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 0),
      paddingHorizontal: 24,
    },
    hero: {
      flex: 1,
      justifyContent: "center",
      gap: 12,
    },
    badge: {
      alignSelf: "flex-start",
      backgroundColor: colors.primary,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 6,
      marginBottom: 8,
    },
    badgeText: {
      color: colors.primaryForeground,
      fontSize: 11,
      fontFamily: "Inter_700Bold",
      letterSpacing: 1.5,
      textTransform: "uppercase",
    },
    title: {
      fontSize: 40,
      fontFamily: "Inter_700Bold",
      color: colors.foreground,
      lineHeight: 46,
    },
    titleGreen: {
      color: colors.primary,
    },
    subtitle: {
      fontSize: 16,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      lineHeight: 24,
      marginTop: 4,
      marginBottom: 8,
    },
    cards: {
      gap: 12,
      marginBottom: 40,
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: colors.radius ?? 12,
      padding: 20,
      flexDirection: "row",
      alignItems: "center",
      gap: 16,
      borderWidth: 1.5,
      borderColor: colors.border,
    },
    cardIcon: {
      width: 48,
      height: 48,
      borderRadius: 12,
      backgroundColor: colors.primary + "1A",
      alignItems: "center",
      justifyContent: "center",
    },
    cardContent: {
      flex: 1,
    },
    cardLabel: {
      fontSize: 16,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
      marginBottom: 2,
    },
    cardSubtitle: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    adminLink: {
      alignSelf: "center",
      marginBottom: 16,
    },
    adminText: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      textDecorationLine: "underline",
    },
  });

  return (
    <View style={s.container}>
      <StatusBar barStyle="light-content" />
      <View style={s.hero}>
        <View style={s.badge}>
          <Text style={s.badgeText}>FutsalCY</Text>
        </View>
        <Text style={s.title}>
          Book your{"\n"}
          <Text style={s.titleGreen}>perfect pitch.</Text>
        </Text>
        <Text style={s.subtitle}>
          Live availability, secure payments, and a calendar that actually works.
        </Text>
      </View>

      <View style={s.cards}>
        {MODES.map((opt) => (
          <TouchableOpacity
            key={opt.mode}
            style={s.card}
            onPress={() => handleSelect(opt.mode)}
            activeOpacity={0.75}
            testID={`mode-${opt.mode}`}
          >
            <View style={s.cardIcon}>
              <FeatherIcons name={opt.icon} size={22} color={colors.primary} />
            </View>
            <View style={s.cardContent}>
              <Text style={s.cardLabel}>{opt.label}</Text>
              <Text style={s.cardSubtitle}>{opt.subtitle}</Text>
            </View>
            <FeatherIcons name="chevron-right" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={s.adminLink} onPress={handleAdminLogin}>
        <Text style={s.adminText}>Admin login</Text>
      </TouchableOpacity>
    </View>
  );
}
