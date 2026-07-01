import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import FeatherIcons from "@/components/FeatherIcons";
import { listPaymentMethods } from "@workspace/api-client-react";
import type { SavedCard } from "@workspace/api-client-react";

export default function PaymentMethodsScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [demoMode, setDemoMode] = useState(false);
  const [cards, setCards] = useState<SavedCard[]>([]);

  useEffect(() => {
    listPaymentMethods()
      .then((res) => {
        setDemoMode(res.demoMode);
        setCards(res.paymentMethods);
      })
      .catch(() => {
        setDemoMode(true);
        setCards([]);
      })
      .finally(() => setLoading(false));
  }, []);

  const cardBrandIcon = (brand: string) => {
    switch (brand.toLowerCase()) {
      case "visa":
        return "credit-card";
      case "mastercard":
        return "credit-card";
      default:
        return "credit-card";
    }
  };

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingTop: insets.top + (Platform.OS === "android" ? 8 : 4),
      paddingBottom: 12,
      backgroundColor: colors.background,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: 12,
    },
    backBtn: { padding: 4 },
    headerTitle: {
      fontSize: 18,
      fontFamily: "Inter_700Bold",
      color: colors.foreground,
    },
    scroll: { flex: 1 },
    content: {
      padding: 24,
    },
    demoBox: {
      backgroundColor: colors.muted,
      borderRadius: 14,
      padding: 20,
      alignItems: "center",
      gap: 12,
    },
    demoIcon: {
      opacity: 0.5,
    },
    demoTitle: {
      fontSize: 16,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
      textAlign: "center",
    },
    demoSubtitle: {
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      textAlign: "center",
      lineHeight: 20,
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 12,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 14,
      gap: 14,
    },
    cardInfo: { flex: 1 },
    cardBrand: {
      fontSize: 15,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
      textTransform: "capitalize",
    },
    cardLast4: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      marginTop: 2,
    },
    removeBtn: {
      padding: 6,
    },
    addBtn: {
      marginTop: 8,
      backgroundColor: colors.primary,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: "center",
    },
    addBtnText: {
      fontSize: 15,
      fontFamily: "Inter_600SemiBold",
      color: colors.primaryForeground,
    },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 40,
    },
  });

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <FeatherIcons name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Payment Methods</Text>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : demoMode ? (
        <ScrollView style={s.scroll} contentContainerStyle={s.content}>
          <View style={s.demoBox}>
            <FeatherIcons name="credit-card" size={40} color={colors.mutedForeground} style={s.demoIcon} />
            <Text style={s.demoTitle}>Payment methods unavailable</Text>
            <Text style={s.demoSubtitle}>
              Payment method management is not available in demo mode. It will be enabled when the
              app is connected to a live payment provider.
            </Text>
          </View>
        </ScrollView>
      ) : (
        <ScrollView
          style={s.scroll}
          contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 40 }]}
        >
          {cards.length === 0 && (
            <Text
              style={{
                color: colors.mutedForeground,
                fontFamily: "Inter_400Regular",
                fontSize: 14,
                textAlign: "center",
                marginBottom: 20,
              }}
            >
              No saved cards yet.
            </Text>
          )}

          {cards.map((card) => (
            <View key={card.id} style={s.card}>
              <FeatherIcons name={cardBrandIcon(card.brand)} size={22} color={colors.primary} />
              <View style={s.cardInfo}>
                <Text style={s.cardBrand}>{card.brand}</Text>
                <Text style={s.cardLast4}>
                  •••• {card.last4} · {card.expMonth}/{card.expYear}
                </Text>
              </View>
              <TouchableOpacity style={s.removeBtn}>
                <FeatherIcons name="trash-2" size={18} color={colors.destructive} />
              </TouchableOpacity>
            </View>
          ))}

          <TouchableOpacity style={s.addBtn}>
            <Text style={s.addBtnText}>+ Add Card</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  );
}
