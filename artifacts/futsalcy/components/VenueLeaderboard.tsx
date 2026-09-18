import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Modal
} from "react-native";
import FeatherIcons from "@/components/FeatherIcons";
import { useColors } from "@/hooks/useColors";
import {
  useVenueLeaderboard,
  usePlayerVenueLeaderboard,
  LeaderboardMetric,
  LeaderboardEntry
} from "@/lib/leaderboard-api";

export default function VenueLeaderboard({ venueId }: { venueId: string }) {
  const colors = useColors();
  const [metric, setMetric] = useState<LeaderboardMetric>("winRate");
  const [page, setPage] = useState(1);
  const [isRulesOpen, setIsRulesOpen] = useState(false);
  const limit = 20;

  const { data, isLoading, error, refetch, isFetching } = useVenueLeaderboard(venueId, metric, page, limit);

  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);

  // If 404 (Entitlement error or not elite), we shouldn't render anything
  if (error?.status === 404) {
    return null;
  }

  const s = StyleSheet.create({
    container: {
      marginTop: 24,
      marginBottom: 12,
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 12,
    },
    titleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    title: {
      fontSize: 18,
      fontFamily: "PlusJakartaSans_700Bold",
      color: colors.foreground,
    },
    refreshBtn: {
      padding: 8,
      marginRight: -8,
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
    },
    tabsRow: {
      flexDirection: "row",
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    tabBtn: {
      flex: 1,
      paddingVertical: 12,
      alignItems: "center",
      borderBottomWidth: 2,
      borderBottomColor: "transparent",
    },
    tabBtnActive: {
      borderBottomColor: colors.primary,
    },
    tabText: {
      fontSize: 13,
      fontFamily: "PlusJakartaSans_500Medium",
      color: colors.mutedForeground,
    },
    tabTextActive: {
      color: colors.primary,
      fontFamily: "PlusJakartaSans_700Bold",
    },
    infoBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.muted,
    },
    listContent: {
      paddingBottom: 16,
    },
    entryRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.border + "60",
    },
    rankBox: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.muted,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 12,
    },
    rankBoxTop3: {
      backgroundColor: colors.primary + "15",
    },
    rankText: {
      fontSize: 12,
      fontFamily: "PlusJakartaSans_700Bold",
      color: colors.foreground,
    },
    rankTextTop3: {
      color: colors.primary,
    },
    nameCol: {
      flex: 1,
    },
    nameText: {
      fontSize: 14,
      fontFamily: "PlusJakartaSans_600SemiBold",
      color: colors.foreground,
    },
    ineligibleText: {
      fontSize: 11,
      fontFamily: "PlusJakartaSans_500Medium",
      color: colors.mutedForeground,
      marginTop: 2,
    },
    statCol: {
      alignItems: "flex-end",
    },
    statValue: {
      fontSize: 15,
      fontFamily: "PlusJakartaSans_700Bold",
      color: colors.foreground,
    },
    statLabel: {
      fontSize: 11,
      fontFamily: "PlusJakartaSans_500Medium",
      color: colors.mutedForeground,
    },
    paginationRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    pageBtn: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 8,
      backgroundColor: colors.muted,
    },
    pageBtnDisabled: {
      opacity: 0.5,
    },
    pageBtnText: {
      fontSize: 13,
      fontFamily: "PlusJakartaSans_600SemiBold",
      color: colors.foreground,
    },
    pageText: {
      fontSize: 13,
      fontFamily: "PlusJakartaSans_500Medium",
      color: colors.mutedForeground,
    },
    errorState: {
      padding: 24,
      alignItems: "center",
      gap: 8,
    },
    errorText: {
      fontSize: 14,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.mutedForeground,
      textAlign: "center",
    },
    retryBtn: {
      marginTop: 8,
      paddingHorizontal: 16,
      paddingVertical: 8,
      backgroundColor: colors.muted,
      borderRadius: 8,
    },
    retryText: {
      fontSize: 13,
      fontFamily: "PlusJakartaSans_600SemiBold",
      color: colors.foreground,
    },
    emptyState: {
      padding: 32,
      alignItems: "center",
      gap: 12,
    },
    emptyText: {
      fontSize: 14,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.mutedForeground,
      textAlign: "center",
    },
  });

  const getMetricLabel = (m: LeaderboardMetric) => {
    if (m === "winRate") return "Win Rate";
    if (m === "goals") return "Goals";
    return "Matches";
  };

  const handleTabPress = (m: LeaderboardMetric) => {
    if (m !== metric) {
      setMetric(m);
      setPage(1);
    }
  };

  const formatStat = (entry: LeaderboardEntry) => {
    if (metric === "winRate") {
      return `${entry.winRate.toFixed(1)}%`;
    }
    if (metric === "goals") {
      return String(entry.goals);
    }
    return String(entry.matches);
  };

  return (
    <View style={s.container}>
      <View style={s.headerRow}>
        <View style={s.titleRow}>
          <FeatherIcons name="award" size={20} color={colors.primary} />
          <Text style={s.title}>Venue Leaderboard</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          {isFetching && !isLoading && (
            <ActivityIndicator size="small" color={colors.primary} />
          )}
          <TouchableOpacity
            style={s.infoBtn}
            onPress={() => setIsRulesOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="About venue leaderboard rankings"
            accessibilityState={{ expanded: isRulesOpen }}
          >
            <FeatherIcons name="info" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
          <TouchableOpacity style={s.refreshBtn} onPress={() => refetch()} accessibilityLabel="Refresh leaderboard" accessibilityRole="button">
            <FeatherIcons name="refresh-cw" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={s.card}>
        <View style={s.tabsRow}>
          {(["winRate", "goals", "matches"] as LeaderboardMetric[]).map((m) => (
            <TouchableOpacity
              key={m}
              style={[s.tabBtn, metric === m && s.tabBtnActive]}
              onPress={() => handleTabPress(m)}
              accessibilityRole="tab"
              accessibilityState={{ selected: metric === m }}
            >
              <Text style={[s.tabText, metric === m && s.tabTextActive]}>
                {getMetricLabel(m)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {isLoading ? (
          <View style={{ padding: 40, alignItems: "center" }}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : error ? (
          <View style={s.errorState}>
            <FeatherIcons name="alert-circle" size={32} color={colors.destructive} />
            <Text style={s.errorText}>Could not load leaderboard.</Text>
            <TouchableOpacity style={s.retryBtn} onPress={() => refetch()}>
              <Text style={s.retryText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View>
            {data?.entries.length === 0 ? (
              <View style={s.emptyState}>
                <FeatherIcons name="slash" size={32} color={colors.mutedForeground} />
                <Text style={s.emptyText}>No players meet the minimum requirements for this metric yet.</Text>
              </View>
            ) : (
              <View style={s.listContent}>
                {data?.entries.map((entry) => (
                  <TouchableOpacity
                    key={entry.playerId}
                    style={s.entryRow}
                    onPress={() => setSelectedPlayerId(entry.playerId)}
                    accessibilityRole="button"
                    accessibilityHint="Tap to view player stats"
                  >
                    <View style={[s.rankBox, entry.rank <= 3 && s.rankBoxTop3]}>
                      <Text style={[s.rankText, entry.rank <= 3 && s.rankTextTop3]}>
                        {entry.rank}
                      </Text>
                    </View>
                    <View style={s.nameCol}>
                      <Text style={s.nameText}>{entry.name}</Text>
                      {metric === "winRate" && !entry.winRateEligible && (
                        <Text style={s.ineligibleText}>
                          Not eligible ({entry.matches}/{data?.minimumMatches} matches)
                        </Text>
                      )}
                    </View>
                    <View style={s.statCol}>
                      <Text style={s.statValue}>{formatStat(entry)}</Text>
                      <Text style={s.statLabel}>{getMetricLabel(metric)}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {data && (page > 1 || data.total > data.limit) && (
              <View style={s.paginationRow}>
                <TouchableOpacity
                  style={[s.pageBtn, page === 1 && s.pageBtnDisabled]}
                  disabled={page === 1}
                  onPress={() => setPage(p => Math.max(1, p - 1))}
                  accessibilityRole="button"
                  accessibilityLabel="Previous page"
                >
                  <Text style={s.pageBtnText}>Prev</Text>
                </TouchableOpacity>
                <Text style={s.pageText}>
                  Page {page} · {data.total} ranked players
                </Text>
                <TouchableOpacity
                  style={[s.pageBtn, page * data.limit >= data.total && s.pageBtnDisabled]}
                  disabled={page * data.limit >= data.total}
                  onPress={() => setPage(p => p + 1)}
                  accessibilityRole="button"
                  accessibilityLabel="Next page"
                >
                  <Text style={s.pageBtnText}>Next</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </View>

      <PlayerStatsModal
        key={venueId}
        venueId={venueId}
        playerId={selectedPlayerId}
        onClose={() => setSelectedPlayerId(null)}
      />
      <LeaderboardRulesModal
        visible={isRulesOpen}
        venueName={data?.venueName}
        metric={metric}
        minimumMatches={data?.minimumMatches ?? 3}
        onClose={() => setIsRulesOpen(false)}
      />
    </View>
  );
}

function LeaderboardRulesModal({ visible, venueName, metric, minimumMatches, onClose }: {
  visible: boolean;
  venueName?: string;
  metric: LeaderboardMetric;
  minimumMatches: number;
  onClose: () => void;
}) {
  const colors = useColors();
  const metricLabel = metric === "winRate" ? "win rate" : metric === "goals" ? "goals" : "matches played";
  const metricRule = metric === "winRate"
    ? `Win rate is wins divided by recorded matches. A player needs at least ${minimumMatches} recorded matches to rank. Draws count as matches.`
    : metric === "goals"
      ? "Players need one recorded match to rank. Zero-goal players are included."
      : "Players need one recorded match to rank.";
  const styles = StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "flex-end",
    },
    sheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      padding: 24,
      paddingBottom: 40,
      gap: 16,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 16,
    },
    title: {
      flex: 1,
      fontSize: 20,
      fontFamily: "PlusJakartaSans_700Bold",
      color: colors.foreground,
    },
    closeBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.muted,
    },
    text: {
      fontSize: 14,
      lineHeight: 21,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.mutedForeground,
    },
    emphasis: {
      fontFamily: "PlusJakartaSans_600SemiBold",
      color: colors.foreground,
    },
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay} accessibilityViewIsModal>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close ranking information"
        />
        <View style={styles.sheet} accessibilityRole="alert">
          <View style={styles.header}>
            <Text style={styles.title}>How rankings work</Text>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close ranking information"
            >
              <FeatherIcons name="x" size={20} color={colors.foreground} />
            </TouchableOpacity>
          </View>
          <Text style={styles.text}>
            <Text style={styles.emphasis}>{venueName ?? "This venue"} only · All time.</Text>{" "}
            Rankings are based on recorded match results, not bookings.
          </Text>
          <Text style={styles.text}>
            <Text style={styles.emphasis}>Currently viewing {metricLabel}.</Text>{" "}
            {metricRule}
          </Text>
          <Text style={styles.text}>
            Remaining ties are ordered by player ID so every player has a stable, unique rank.
          </Text>
        </View>
      </View>
    </Modal>
  );
}

function PlayerStatsModal({ venueId, playerId, onClose }: { venueId: string; playerId: string | null; onClose: () => void }) {
  const colors = useColors();
  const { data, isLoading, error, refetch } = usePlayerVenueLeaderboard(venueId, playerId ?? "", !!playerId);

  // Clear modal on 404 eligibility/detail error
  useEffect(() => {
    if (error?.status === 404) {
      onClose();
    }
  }, [error, onClose]);

  const s = StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "flex-end",
    },
    sheet: {
      maxHeight: "90%",
      backgroundColor: colors.card,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      padding: 24,
      paddingBottom: 48,
    },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      marginBottom: 24,
    },
    playerName: {
      fontSize: 20,
      fontFamily: "PlusJakartaSans_700Bold",
      color: colors.foreground,
      marginBottom: 4,
    },
    venueName: {
      fontSize: 14,
      fontFamily: "PlusJakartaSans_500Medium",
      color: colors.mutedForeground,
    },
    closeBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.muted,
      alignItems: "center",
      justifyContent: "center",
    },
    grid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 12,
    },
    statBox: {
      width: "48%",
      backgroundColor: colors.background,
      borderRadius: 12,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    statBoxFull: {
      width: "100%",
    },
    statVal: {
      fontSize: 24,
      fontFamily: "PlusJakartaSans_700Bold",
      color: colors.foreground,
    },
    statLab: {
      fontSize: 12,
      fontFamily: "PlusJakartaSans_500Medium",
      color: colors.mutedForeground,
      marginTop: 4,
    },
    center: {
      padding: 40,
      alignItems: "center",
    },
    errorText: {
      fontSize: 14,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.destructive,
      textAlign: "center",
      marginTop: 8,
    }
  });

  if (!playerId) return null;

  return (
    <Modal visible={!!playerId} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <ScrollView style={s.sheet}>
          <View style={s.header}>
            <View style={{ flex: 1, paddingRight: 16 }}>
              {isLoading ? (
                <View style={{ height: 28, width: 120, backgroundColor: colors.muted, borderRadius: 4, marginBottom: 4 }} />
              ) : (
                <Text style={s.playerName}>{data?.player?.name ?? "Player"}</Text>
              )}
              {isLoading ? (
                <View style={{ height: 20, width: 180, backgroundColor: colors.muted, borderRadius: 4 }} />
              ) : (
                <Text style={s.venueName}>At {data?.venueName ?? "Venue"}</Text>
              )}
            </View>
            <TouchableOpacity style={s.closeBtn} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
              <FeatherIcons name="x" size={18} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          {isLoading ? (
            <View style={s.center}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : error ? (
            <View style={s.center}>
              <FeatherIcons name="alert-triangle" size={32} color={colors.destructive} />
              <Text style={s.errorText}>Could not load player statistics.</Text>
              <TouchableOpacity accessibilityRole="button" onPress={() => void refetch()} style={{ padding: 12 }}>
                <Text style={{ color: colors.primary }}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : data && data.player ? (
             <View style={s.grid}>
               <View style={[s.statBox, s.statBoxFull]}>
                 <Text style={s.statVal}>{data.player.winRate.toFixed(1)}%</Text>
                 <Text style={s.statLab}>Win Rate</Text>
                 {!data.player.winRateEligible && <Text style={[s.statLab, { marginTop: 8 }]}>3 recorded matches required for win-rate ranking</Text>}
               </View>
               <View style={s.statBox}>
                 <Text style={s.statVal}>{data.player.matches}</Text>
                 <Text style={s.statLab}>Matches Played</Text>
               </View>
               <View style={s.statBox}>
                 <Text style={s.statVal}>{data.player.goals}</Text>
                 <Text style={s.statLab}>Goals Scored</Text>
               </View>
               <View style={s.statBox}>
                 <Text style={s.statVal}>{data.player.wins}</Text>
                 <Text style={s.statLab}>Wins</Text>
               </View>
               <View style={s.statBox}>
                 <Text style={s.statVal}>{data.player.draws} / {data.player.losses}</Text>
                 <Text style={s.statLab}>Draws / Losses</Text>
               </View>
             </View>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}
