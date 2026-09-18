import React, { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import { useGetAdminVenueLeaderboardPlayerSources, useListVenues } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";

/** Inspect the authoritative records rather than editing a second set of totals. */
export default function AdminLeaderboardSources({ playerId, onNavigate }: {
  playerId: string;
  onNavigate: () => void;
}) {
  const colors = useColors();
  const router = useRouter();
  const [venueId, setVenueId] = useState("");
  const [page, setPage] = useState(1);
  const venues = useListVenues(undefined, { query: { queryKey: ["adminLeaderboardVenues"], staleTime: 0 } });
  const sources = useGetAdminVenueLeaderboardPlayerSources(venueId, playerId, { page, limit: 10 }, {
    query: { queryKey: ["adminLeaderboardSources", venueId, playerId, page], enabled: !!venueId, staleTime: 0, refetchOnMount: "always" },
  });
  const eligible = (venues.data?.venues ?? []).filter((venue) => venue.effectivePlan === "ELITE");
  const data = sources.data;
  const text = { color: colors.foreground };
  const muted = { color: colors.mutedForeground };
  const button = [styles.button, { borderColor: colors.border }];

  return (
    <View style={styles.section}>
      <Text style={[styles.heading, text]}>Elite venue leaderboard sources</Text>
      <Text style={[styles.copy, muted]}>
        Select a venue to inspect this player's totals. Corrections change the official match record and are recorded in the booking's Activity history.
      </Text>
      {venues.isLoading ? <ActivityIndicator color={colors.primary} /> : venues.isError ? (
        <TouchableOpacity accessibilityRole="button" onPress={() => void venues.refetch()} style={button}>
          <Text style={{ color: colors.destructive }}>Could not load venues. Try again</Text>
        </TouchableOpacity>
      ) : eligible.length === 0 ? <Text style={muted}>No approved Elite venues are available.</Text> : (
        <View style={styles.choices}>
          {eligible.map((venue) => (
            <TouchableOpacity key={venue.id} accessibilityRole="button"
              accessibilityState={{ selected: venueId === venue.id }}
              onPress={() => { setVenueId(venue.id); setPage(1); }}
              style={[button, venueId === venue.id && { borderColor: colors.primary }]}>
              <Text style={{ color: venueId === venue.id ? colors.primary : colors.foreground }}>{venue.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {!!venueId && (sources.isLoading ? <ActivityIndicator color={colors.primary} /> : sources.isError ? (
        <View>
          <Text style={{ color: colors.destructive }}>Sources could not be loaded. The venue may no longer be eligible.</Text>
          <TouchableOpacity accessibilityRole="button" onPress={() => void sources.refetch()} style={button}>
            <Text style={text}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : data ? (
        <View style={styles.section}>
          <Text style={[styles.heading, text]}>{data.venueName} only</Text>
          {data.player ? (
            <Text style={[styles.copy, text]}>
              {data.player.goals} goals · {data.player.matches} matches · {data.player.wins} wins · {data.player.draws} draws · {data.player.losses} losses{"\n"}
              {data.player.winRate.toFixed(1)}% win rate{data.player.winRateEligible ? "" : " (3 matches required to rank)"}
            </Text>
          ) : <Text style={muted}>No recorded participation at this venue.</Text>}
          <Text style={[styles.copy, muted]}>All-time totals from recorded results, not bookings. No separate leaderboard adjustments.</Text>
          {data.sources.map((source) => (
            <TouchableOpacity key={source.matchId} accessibilityRole="button"
              accessibilityLabel={`Inspect match from ${new Date(source.playedAt).toLocaleDateString()}`}
              style={[styles.source, { borderColor: colors.border }]}
              onPress={() => {
                onNavigate();
                router.push(`/admin/booking/${source.bookingId}`);
              }}>
              <Text style={[styles.copy, text]}>{new Date(source.playedAt).toLocaleDateString()} · Home {source.homeScore} – {source.awayScore} Away</Text>
              <Text style={[styles.copy, muted]}>{source.team === "HOME" ? "Home" : "Away"} team · {source.goals} goals · Record v{source.version}</Text>
              <Text style={[styles.link, { color: colors.primary }]}>Inspect, correct & view audit history</Text>
            </TouchableOpacity>
          ))}
          {(page > 1 || data.total > 0) && (
            <View style={styles.choices}>
              <TouchableOpacity accessibilityRole="button" disabled={page === 1} onPress={() => setPage(page - 1)}
                style={[button, { opacity: page === 1 ? 0.4 : 1 }]}>
                <Text style={text}>Previous</Text>
              </TouchableOpacity>
              <Text style={[styles.page, muted]}>Page {page} of {Math.max(1, Math.ceil(data.total / 10))}</Text>
              <TouchableOpacity accessibilityRole="button" disabled={page * 10 >= data.total} onPress={() => setPage(page + 1)}
                style={[button, { opacity: page * 10 >= data.total ? 0.4 : 1 }]}>
                <Text style={text}>Next</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      ) : null)}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 12, marginTop: 16 },
  heading: { fontSize: 16, fontFamily: "PlusJakartaSans_700Bold" },
  copy: { fontSize: 13, lineHeight: 20, fontFamily: "PlusJakartaSans_400Regular" },
  choices: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  button: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12, minHeight: 44 },
  source: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 5 },
  link: { fontSize: 13, fontFamily: "PlusJakartaSans_600SemiBold" },
  page: { fontSize: 12 },
});