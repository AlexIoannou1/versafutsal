import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import FeatherIcons from "@/components/FeatherIcons";
import {
  listPaymentMethods,
  removePaymentMethod,
  getStripeConfig,
} from "@workspace/api-client-react";
import type { SavedCard } from "@workspace/api-client-react";

export default function PaymentMethodsScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [demoMode, setDemoMode] = useState(false);
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const loadCards = useCallback(() => {
    setLoading(true);
    Promise.all([getStripeConfig(), listPaymentMethods()])
      .then(([cfg, res]) => {
        setDemoMode(cfg.demoMode);
        setCards(res.paymentMethods);
      })
      .catch(() => {
        setDemoMode(true);
        setCards([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadCards();
  }, [loadCards]);

  const handleRemoveCard = useCallback((card: SavedCard) => {
    Alert.alert("Remove Card", `Remove •••• ${card.last4} (${card.brand})?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          setRemovingId(card.id);
          try {
            await removePaymentMethod(card.id);
            setCards((prev) => prev.filter((c) => c.id !== card.id));
          } catch {
            Alert.alert("Error", "Could not remove card. Please try again.");
          } finally {
            setRemovingId(null);
          }
        },
      },
    ]);
  }, []);

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingTop: insets.top + 8,
      paddingBottom: 12,
      backgroundColor: colors.background,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: 12,
    },
    backBtn: { padding: 4 },
    headerTitle: {
      fontSize: 18,
      fontFamily: "PlusJakartaSans_700Bold",
      color: colors.foreground,
    },
    scroll: { flex: 1 },
    content: { padding: 24 },
    demoBox: {
      backgroundColor: colors.muted,
      borderRadius: 14,
      padding: 20,
      alignItems: "center",
      gap: 12,
    },
    demoTitle: {
      fontSize: 16,
      fontFamily: "PlusJakartaSans_600SemiBold",
      color: colors.foreground,
      textAlign: "center",
    },
    demoSubtitle: {
      fontSize: 14,
      fontFamily: "PlusJakartaSans_400Regular",
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
      fontFamily: "PlusJakartaSans_600SemiBold",
      color: colors.foreground,
      textTransform: "capitalize",
    },
    cardLast4: {
      fontSize: 13,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.mutedForeground,
      marginTop: 2,
    },
    removeBtn: { padding: 6 },
    nativeNote: {
      backgroundColor: colors.muted,
      borderRadius: 10,
      padding: 14,
      marginTop: 16,
      alignItems: "center",
    },
    nativeNoteText: {
      fontSize: 13,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.mutedForeground,
      textAlign: "center",
    },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 40,
    },
    emptyText: {
      color: colors.mutedForeground,
      fontFamily: "PlusJakartaSans_400Regular",
      fontSize: 14,
      textAlign: "center",
      marginBottom: 16,
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
        <ScrollView
          style={s.scroll}
          contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 40 }]}
        >
          <View style={s.demoBox}>
            <FeatherIcons name="credit-card" size={40} color={colors.mutedForeground} />
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
          {cards.length === 0 && <Text style={s.emptyText}>No saved cards yet.</Text>}

          {cards.map((card) => (
            <View key={card.id} style={s.card}>
              <FeatherIcons name="credit-card" size={22} color={colors.primary} />
              <View style={s.cardInfo}>
                <Text style={s.cardBrand}>{card.brand}</Text>
                <Text style={s.cardLast4}>
                  •••• {card.last4} · {card.expMonth}/{card.expYear}
                </Text>
              </View>
              <TouchableOpacity
                style={s.removeBtn}
                onPress={() => handleRemoveCard(card)}
                disabled={removingId === card.id}
              >
                {removingId === card.id ? (
                  <ActivityIndicator size="small" color={colors.destructive} />
                ) : (
                  <FeatherIcons name="trash-2" size={18} color={colors.destructive} />
                )}
              </TouchableOpacity>
            </View>
          ))}

          <View style={s.nativeNote}>
            <Text style={s.nativeNoteText}>
              Adding cards requires the Versa mobile app on iOS or Android.
            </Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}
