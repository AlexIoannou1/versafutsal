import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import FeatherIcons from "@/components/FeatherIcons";
import { useColors } from "@/hooks/useColors";
import type { PlayerStatsSummary } from "@/lib/match-stats-api";

interface Props {
  title: string;
  subtitle: string;
  stats?: PlayerStatsSummary;
  isLoading: boolean;
  error?: unknown;
  testID?: string;
}

const METRICS: Array<{ key: keyof PlayerStatsSummary; label: string }> = [
  { key: "matchesPlayed", label: "Matches" },
  { key: "goals", label: "Goals" },
  { key: "assists", label: "Assists" },
  { key: "saves", label: "Saves" },
];

export default function PlayerStatsCard({ title, subtitle, stats, isLoading, error, testID }: Props) {
  const colors = useColors();
  const hasMatches = (stats?.matchesPlayed ?? 0) > 0;

  return (
    <View testID={testID} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.headingRow}>
        <View style={[styles.icon, { backgroundColor: colors.primary + "18" }]}>
          <FeatherIcons name="activity" size={18} color={colors.primary} />
        </View>
        <View style={styles.headingCopy}>
          <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{subtitle}</Text>
        </View>
      </View>
      {isLoading ? (
        <View style={styles.state}><ActivityIndicator color={colors.primary} /></View>
      ) : error ? (
        <View style={styles.state}>
          <FeatherIcons name="alert-circle" size={20} color={colors.destructive} />
          <Text style={[styles.stateText, { color: colors.mutedForeground }]}>Statistics could not be loaded.</Text>
        </View>
      ) : !hasMatches ? (
        <View style={[styles.empty, { backgroundColor: colors.muted }]}>
          <FeatherIcons name="award" size={22} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No recorded matches yet</Text>
          <Text style={[styles.stateText, { color: colors.mutedForeground }]}>
            Stats appear after a venue records a completed match.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.metrics}>
            {METRICS.map(({ key, label }) => (
              <View key={key} style={styles.metric}>
                <Text style={[styles.value, { color: colors.foreground }]}>{stats?.[key] ?? 0}</Text>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
              </View>
            ))}
          </View>
          <View style={[styles.formRow, { borderTopColor: colors.border }]}>
            <Text style={[styles.cardsText, { color: colors.mutedForeground }]}>
              {stats?.venuesPlayed != null ? `${stats.venuesPlayed} venue${stats.venuesPlayed === 1 ? "" : "s"} · ` : ""}
              {stats?.yellowCards ?? 0} yellow · {stats?.redCards ?? 0} red
            </Text>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 16 },
  headingRow: { flexDirection: "row", alignItems: "center", gap: 11 },
  icon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  headingCopy: { flex: 1 },
  title: { fontSize: 17, fontFamily: "PlusJakartaSans_700Bold" },
  subtitle: { marginTop: 2, fontSize: 12, lineHeight: 17, fontFamily: "PlusJakartaSans_400Regular" },
  metrics: { flexDirection: "row", marginTop: 18 },
  metric: { flex: 1, alignItems: "center" },
  value: { fontSize: 22, fontFamily: "PlusJakartaSans_700Bold" },
  label: { marginTop: 2, fontSize: 10, fontFamily: "PlusJakartaSans_500Medium" },
  formRow: { flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, marginTop: 15, paddingTop: 12 },
  cardsText: { flex: 1, textAlign: "center", fontSize: 10, fontFamily: "PlusJakartaSans_500Medium" },
  state: { minHeight: 82, alignItems: "center", justifyContent: "center", gap: 7 },
  stateText: { fontSize: 12, lineHeight: 17, textAlign: "center", fontFamily: "PlusJakartaSans_400Regular" },
  empty: { marginTop: 14, padding: 14, borderRadius: 12, alignItems: "center", gap: 5 },
  emptyTitle: { fontSize: 13, fontFamily: "PlusJakartaSans_600SemiBold" },
});