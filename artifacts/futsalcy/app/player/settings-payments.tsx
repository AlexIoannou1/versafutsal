import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StripeProvider, useStripe } from "@/lib/stripe-native";
import { useColors } from "@/hooks/useColors";
import FeatherIcons from "@/components/FeatherIcons";
import {
  getStripeConfig,
  listPaymentMethods,
  removePaymentMethod,
  createSetupIntent,
} from "@workspace/api-client-react";
import type { SavedCard } from "@workspace/api-client-react";

export default function PaymentMethodsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [configLoading, setConfigLoading] = useState(true);
  const [demoMode, setDemoMode] = useState(false);
  const [publishableKey, setPublishableKey] = useState<string | null>(null);

  useEffect(() => {
    getStripeConfig()
      .then((cfg) => {
        setDemoMode(cfg.demoMode);
        setPublishableKey(cfg.publishableKey);
      })
      .catch(() => setDemoMode(true))
      .finally(() => setConfigLoading(false));
  }, []);

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

      {configLoading ? (
        <View style={s.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : demoMode ? (
        <DemoView colors={colors} insets={insets} />
      ) : (
        <StripeProvider publishableKey={publishableKey!}>
          <LivePaymentContent colors={colors} insets={insets} />
        </StripeProvider>
      )}
    </View>
  );
}

function DemoView({
  colors,
  insets,
}: {
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  insets: ReturnType<typeof import("react-native-safe-area-context").useSafeAreaInsets>;
}) {
  const s = StyleSheet.create({
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
  });

  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 40 }]}
    >
      <View style={s.demoBox}>
        <FeatherIcons name="credit-card" size={40} color={colors.mutedForeground} />
        <Text style={s.demoTitle}>Payment methods unavailable</Text>
        <Text style={s.demoSubtitle}>
          Payment method management is not available in demo mode. It will be enabled when the app
          is connected to a live payment provider.
        </Text>
      </View>
    </ScrollView>
  );
}

function LivePaymentContent({
  colors,
  insets,
}: {
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  insets: ReturnType<typeof import("react-native-safe-area-context").useSafeAreaInsets>;
}) {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  const [loading, setLoading] = useState(true);
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [addingCard, setAddingCard] = useState(false);

  const loadCards = useCallback(() => {
    setLoading(true);
    listPaymentMethods()
      .then((res) => setCards(res.paymentMethods))
      .catch(() => setCards([]))
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

  const handleAddCard = useCallback(async () => {
    setAddingCard(true);
    try {
      const { clientSecret } = await createSetupIntent();

      const { error: initError } = await initPaymentSheet({
        setupIntentClientSecret: clientSecret,
        merchantDisplayName: "FutsalCY",
        allowsDelayedPaymentMethods: false,
      });

      if (initError) {
        Alert.alert("Error", initError.message ?? "Could not initialise card setup.");
        return;
      }

      const { error: presentError } = await presentPaymentSheet();

      if (presentError) {
        if (presentError.code !== "Canceled") {
          Alert.alert("Error", presentError.message ?? "Card setup failed.");
        }
        return;
      }

      loadCards();
    } catch (err: unknown) {
      const e = err as { data?: { error?: string }; message?: string } | null;
      const msg = e?.data?.error ?? e?.message ?? "Could not set up card.";
      Alert.alert("Error", msg);
    } finally {
      setAddingCard(false);
    }
  }, [initPaymentSheet, presentPaymentSheet, loadCards]);

  const s = StyleSheet.create({
    scroll: { flex: 1 },
    content: { padding: 24 },
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
    removeBtn: { padding: 6 },
    addBtn: {
      marginTop: 8,
      backgroundColor: colors.primary,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: "center",
    },
    addBtnDisabled: { opacity: 0.6 },
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
    emptyText: {
      color: colors.mutedForeground,
      fontFamily: "Inter_400Regular",
      fontSize: 14,
      textAlign: "center",
      marginBottom: 20,
    },
  });

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
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

      <TouchableOpacity
        style={[s.addBtn, addingCard && s.addBtnDisabled]}
        onPress={handleAddCard}
        disabled={addingCard}
      >
        {addingCard ? (
          <ActivityIndicator color={colors.primaryForeground} />
        ) : (
          <Text style={s.addBtnText}>+ Add Card</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}
