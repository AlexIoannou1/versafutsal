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
import * as WebBrowser from "expo-web-browser";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import FeatherIcons from "@/components/FeatherIcons";
import {
  getOwnerConnectConfig,
  getOwnerConnectStatus,
  createOwnerConnectAccount,
  getOwnerConnectOnboardingLink,
  disconnectOwnerConnectAccount,
} from "@workspace/api-client-react";
import type { OwnerConnectStatus } from "@workspace/api-client-react";

export default function OwnerPaymentsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [demoMode, setDemoMode] = useState(false);
  const [status, setStatus] = useState<OwnerConnectStatus | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cfg, st] = await Promise.all([getOwnerConnectConfig(), getOwnerConnectStatus()]);
      setDemoMode(cfg.demoMode);
      setStatus(st);
    } catch {
      setDemoMode(true);
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleConnect = useCallback(async () => {
    setActionLoading(true);
    try {
      await createOwnerConnectAccount();
      const { url } = await getOwnerConnectOnboardingLink();
      await WebBrowser.openBrowserAsync(url);
      await load();
    } catch (err: unknown) {
      const e = err as { data?: { error?: string }; message?: string } | null;
      Alert.alert("Error", e?.data?.error ?? e?.message ?? "Could not start Stripe onboarding.");
    } finally {
      setActionLoading(false);
    }
  }, [load]);

  const handleDisconnect = useCallback(() => {
    Alert.alert(
      "Disconnect Stripe",
      "This will remove your Stripe Connect account from this app. Existing payouts are not affected.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: async () => {
            setActionLoading(true);
            try {
              await disconnectOwnerConnectAccount();
              await load();
            } catch {
              Alert.alert("Error", "Could not disconnect. Please try again.");
            } finally {
              setActionLoading(false);
            }
          },
        },
      ],
    );
  }, [load]);

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
      fontFamily: "PlusJakartaSans_700Bold",
      color: colors.foreground,
    },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 40,
    },
    scroll: { flex: 1 },
    content: { padding: 24 },
    infoBox: {
      backgroundColor: colors.muted,
      borderRadius: 14,
      padding: 20,
      alignItems: "center",
      gap: 12,
    },
    infoTitle: {
      fontSize: 16,
      fontFamily: "PlusJakartaSans_600SemiBold",
      color: colors.foreground,
      textAlign: "center",
    },
    infoSubtitle: {
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
      padding: 20,
      gap: 16,
      marginBottom: 16,
    },
    statusRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    statusLabel: {
      fontSize: 14,
      fontFamily: "PlusJakartaSans_500Medium",
      color: colors.mutedForeground,
      flex: 1,
    },
    chip: {
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    chipText: {
      fontSize: 12,
      fontFamily: "PlusJakartaSans_600SemiBold",
    },
    connectedBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: "#16a34a20",
      borderRadius: 10,
      padding: 14,
      marginBottom: 4,
    },
    connectedText: {
      fontSize: 15,
      fontFamily: "PlusJakartaSans_600SemiBold",
      color: "#16a34a",
    },
    displayName: {
      fontSize: 13,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.mutedForeground,
      marginTop: 2,
    },
    primaryBtn: {
      backgroundColor: colors.primary,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: "center",
    },
    primaryBtnDisabled: { opacity: 0.6 },
    primaryBtnText: {
      fontSize: 15,
      fontFamily: "PlusJakartaSans_600SemiBold",
      color: colors.primaryForeground,
    },
    dangerBtn: {
      backgroundColor: colors.destructive + "10",
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.destructive + "30",
      paddingVertical: 14,
      alignItems: "center",
    },
    dangerBtnText: {
      fontSize: 15,
      fontFamily: "PlusJakartaSans_600SemiBold",
      color: colors.destructive,
    },
  });

  const renderChip = (active: boolean, label: string) => (
    <View style={[s.chip, { backgroundColor: active ? "#16a34a20" : colors.muted }]}>
      <Text style={[s.chipText, { color: active ? "#16a34a" : colors.mutedForeground }]}>
        {active ? label : `${label} pending`}
      </Text>
    </View>
  );

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <FeatherIcons name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Payments</Text>
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
          <View style={s.infoBox}>
            <FeatherIcons name="credit-card" size={40} color={colors.mutedForeground} />
            <Text style={s.infoTitle}>Stripe Connect not configured</Text>
            <Text style={s.infoSubtitle}>
              Stripe Connect is not set up in this environment. Once configured, you'll be able to
              connect your bank account and receive booking payments directly.
            </Text>
          </View>
        </ScrollView>
      ) : status?.connected && status.detailsSubmitted && status.chargesEnabled && status.payoutsEnabled ? (
        <ScrollView
          style={s.scroll}
          contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 40 }]}
        >
          <View style={s.connectedBadge}>
            <FeatherIcons name="check-circle" size={20} color="#16a34a" />
            <View>
              <Text style={s.connectedText}>Payments Active</Text>
              {status.displayName ? (
                <Text style={s.displayName}>{status.displayName}</Text>
              ) : null}
              {status.payoutLast4 ? (
                <Text style={s.displayName}>Payout account •••• {status.payoutLast4}</Text>
              ) : null}
            </View>
          </View>

          <View style={s.card}>
            <View style={s.statusRow}>
              <Text style={s.statusLabel}>Details submitted</Text>
              {renderChip(status.detailsSubmitted, "Done")}
            </View>
            <View style={s.statusRow}>
              <Text style={s.statusLabel}>Charges enabled</Text>
              {renderChip(status.chargesEnabled, "Enabled")}
            </View>
            <View style={s.statusRow}>
              <Text style={s.statusLabel}>Payouts enabled</Text>
              {renderChip(status.payoutsEnabled, "Enabled")}
            </View>
          </View>

          <TouchableOpacity
            style={[s.dangerBtn, actionLoading && s.primaryBtnDisabled]}
            onPress={handleDisconnect}
            disabled={actionLoading}
          >
            {actionLoading ? (
              <ActivityIndicator color={colors.destructive} />
            ) : (
              <Text style={s.dangerBtnText}>Disconnect Stripe Account</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      ) : (
        <ScrollView
          style={s.scroll}
          contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 40 }]}
        >
          {status?.connected ? (
            <>
              <View style={s.infoBox}>
                <FeatherIcons name="alert-circle" size={32} color={colors.mutedForeground} />
                <Text style={s.infoTitle}>Setup incomplete</Text>
                <Text style={s.infoSubtitle}>
                  Your Stripe account is connected but needs more information before you can accept
                  payments.
                </Text>
              </View>

              <View style={[s.card, { marginTop: 16 }]}>
                <View style={s.statusRow}>
                  <Text style={s.statusLabel}>Details submitted</Text>
                  {renderChip(status.detailsSubmitted, "Done")}
                </View>
                <View style={s.statusRow}>
                  <Text style={s.statusLabel}>Charges enabled</Text>
                  {renderChip(status.chargesEnabled, "Enabled")}
                </View>
                <View style={s.statusRow}>
                  <Text style={s.statusLabel}>Payouts enabled</Text>
                  {renderChip(status.payoutsEnabled, "Enabled")}
                </View>
              </View>

              <TouchableOpacity
                style={[s.primaryBtn, actionLoading && s.primaryBtnDisabled, { marginTop: 16 }]}
                onPress={handleConnect}
                disabled={actionLoading}
              >
                {actionLoading ? (
                  <ActivityIndicator color={colors.primaryForeground} />
                ) : (
                  <Text style={s.primaryBtnText}>Complete Setup</Text>
                )}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={s.infoBox}>
                <FeatherIcons name="credit-card" size={40} color={colors.mutedForeground} />
                <Text style={s.infoTitle}>Connect your bank account</Text>
                <Text style={s.infoSubtitle}>
                  Link your Stripe account to receive booking payments directly to your bank. Setup
                  is quick and handled securely by Stripe.
                </Text>
              </View>

              <TouchableOpacity
                style={[s.primaryBtn, actionLoading && s.primaryBtnDisabled, { marginTop: 20 }]}
                onPress={handleConnect}
                disabled={actionLoading}
              >
                {actionLoading ? (
                  <ActivityIndicator color={colors.primaryForeground} />
                ) : (
                  <Text style={s.primaryBtnText}>Connect Stripe Account</Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}
