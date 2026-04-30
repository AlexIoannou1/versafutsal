import React, { useState, type ComponentProps } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Image,
  Linking,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useGetVenue, type VenueDetail } from "@workspace/api-client-react";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatTime(t: string): string {
  const [h, m] = t.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

type FeatherName = ComponentProps<typeof Feather>["name"];

const TYPE_ICONS: Record<string, FeatherName> = {
  INDOOR: "home",
  OUTDOOR: "sun",
  HYBRID: "layers",
};

const TYPE_LABELS: Record<string, string> = {
  INDOOR: "Indoor",
  OUTDOOR: "Outdoor",
  HYBRID: "Hybrid",
};

export default function PlayerVenueDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [photoIndex, setPhotoIndex] = useState(0);

  const { data, isLoading, error } = useGetVenue(id!);
  const venue: VenueDetail | undefined = data?.venue;

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
    errorText: {
      fontSize: 16,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      textAlign: "center",
    },
    scroll: { flex: 1 },
    photoSection: {
      width: "100%",
      height: 220,
      backgroundColor: colors.muted,
    },
    photoImage: { width: "100%", height: 220 },
    photoPlaceholder: {
      width: "100%",
      height: 220,
      backgroundColor: colors.muted,
      alignItems: "center",
      justifyContent: "center",
    },
    photoDots: {
      position: "absolute",
      bottom: 12,
      left: 0,
      right: 0,
      flexDirection: "row",
      justifyContent: "center",
      gap: 6,
    },
    dot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    body: {
      padding: 20,
      paddingBottom: insets.bottom + 100,
    },
    venueName: {
      fontSize: 22,
      fontFamily: "Inter_700Bold",
      color: colors.foreground,
      marginBottom: 6,
    },
    metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
    metaText: {
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    mapLink: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 16 },
    mapText: {
      fontSize: 14,
      fontFamily: "Inter_500Medium",
      color: colors.primary,
    },
    sectionTitle: {
      fontSize: 16,
      fontFamily: "Inter_700Bold",
      color: colors.foreground,
      marginBottom: 12,
      marginTop: 20,
    },
    description: {
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      lineHeight: 20,
      marginTop: 8,
    },
    amenitiesGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    amenityChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: colors.muted,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    amenityText: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
    },
    pitchCard: {
      backgroundColor: colors.card,
      borderRadius: 10,
      padding: 14,
      marginBottom: 8,
      borderWidth: 1,
      borderColor: colors.border,
    },
    pitchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    pitchName: {
      fontSize: 15,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
      flex: 1,
    },
    pitchTypeBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: colors.muted,
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    pitchTypeText: { fontSize: 12, fontFamily: "Inter_500Medium", color: colors.foreground },
    pitchSize: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      marginTop: 4,
    },
    priceRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
    priceChip: {
      backgroundColor: colors.primary + "15",
      borderRadius: 6,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    priceText: {
      fontSize: 13,
      fontFamily: "Inter_600SemiBold",
      color: colors.primary,
    },
    hoursGrid: { gap: 6 },
    hourRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingVertical: 8,
      paddingHorizontal: 12,
      backgroundColor: colors.card,
      borderRadius: 8,
    },
    dayText: {
      fontSize: 14,
      fontFamily: "Inter_500Medium",
      color: colors.foreground,
      width: 40,
    },
    timeText: {
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    closedText: {
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.destructive,
    },
    bottomBar: {
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: colors.background,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      padding: 16,
      paddingBottom: insets.bottom + 12,
    },
    bookBtn: {
      backgroundColor: colors.primary,
      borderRadius: 12,
      height: 52,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 8,
    },
    bookBtnDisabled: {
      backgroundColor: colors.muted,
    },
    bookBtnText: {
      fontSize: 16,
      fontFamily: "Inter_600SemiBold",
      color: colors.primaryForeground,
    },
    bookBtnDisabledText: {
      color: colors.mutedForeground,
    },
    divider: {
      height: 1,
      backgroundColor: colors.border,
      marginTop: 20,
    },
  });

  if (isLoading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (error || !venue) {
    return (
      <View style={s.center}>
        <Text style={s.errorText}>Venue not found or unavailable.</Text>
      </View>
    );
  }

  const photos = (venue.photos as Array<{ id: string; url: string }>) ?? [];
  const pitches = (venue.pitches as Array<{
    id: string;
    name: string;
    size: string;
    type: string;
    slotDurationMinutes: number;
    pricingRules: Array<{ dayType: string; pricePerHour: string }>;
  }>) ?? [];
  const openingHours = (venue.openingHours as Array<{
    dayOfWeek: number;
    openTime: string;
    closeTime: string;
    isClosed: boolean;
  }>) ?? [];
  const amenities = (venue.amenities as string[]) ?? [];
  const currentPhoto = photos[photoIndex];

  const mapQuery = encodeURIComponent(String(venue.name) + " " + String(venue.address) + " " + String(venue.district) + " Cyprus");
  const mapUrl = `https://maps.google.com/?q=${mapQuery}`;

  return (
    <View style={s.container}>
      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.photoSection}>
          {currentPhoto ? (
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => {
                const idx = Math.round(e.nativeEvent.contentOffset.x / e.nativeEvent.layoutMeasurement.width);
                setPhotoIndex(idx);
              }}
            >
              {photos.map((p) => (
                <Image
                  key={p.id}
                  source={{ uri: p.url }}
                  style={s.photoImage}
                  resizeMode="cover"
                />
              ))}
            </ScrollView>
          ) : (
            <View style={s.photoPlaceholder}>
              <Feather name="image" size={48} color={colors.mutedForeground} />
            </View>
          )}
          {photos.length > 1 && (
            <View style={s.photoDots}>
              {photos.map((_, i) => (
                <View
                  key={i}
                  style={[
                    s.dot,
                    {
                      backgroundColor:
                        i === photoIndex ? colors.primaryForeground : "rgba(255,255,255,0.5)",
                    },
                  ]}
                />
              ))}
            </View>
          )}
        </View>

        <View style={s.body}>
          <Text style={s.venueName}>{String(venue.name)}</Text>
          <View style={s.metaRow}>
            <Feather name="map-pin" size={14} color={colors.mutedForeground} />
            <Text style={s.metaText}>{String(venue.district)}</Text>
          </View>
          <TouchableOpacity style={s.mapLink} onPress={() => Linking.openURL(mapUrl)}>
            <Feather name="navigation" size={14} color={colors.primary} />
            <Text style={s.mapText}>Open in Maps</Text>
          </TouchableOpacity>

          {venue.description ? (
            <Text style={s.description}>{String(venue.description)}</Text>
          ) : null}

          {amenities.length > 0 && (
            <>
              <Text style={s.sectionTitle}>Amenities</Text>
              <View style={s.amenitiesGrid}>
                {amenities.map((a) => (
                  <View key={a} style={s.amenityChip}>
                    <Feather name="check" size={14} color={colors.primary} />
                    <Text style={s.amenityText}>{a}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          <View style={s.divider} />

          <Text style={s.sectionTitle}>Pitches ({pitches.length})</Text>
          {pitches.map((pitch) => {
            const prices = pitch.pricingRules ?? [];
            return (
              <View key={pitch.id} style={s.pitchCard}>
                <View style={s.pitchRow}>
                  <Text style={s.pitchName}>{pitch.name}</Text>
                  <View style={s.pitchTypeBadge}>
                    <Feather
                      name={TYPE_ICONS[pitch.type] ?? "circle"}
                      size={12}
                      color={colors.foreground}
                    />
                    <Text style={s.pitchTypeText}>{TYPE_LABELS[pitch.type] ?? pitch.type}</Text>
                  </View>
                </View>
                <Text style={s.pitchSize}>{pitch.size} · {pitch.slotDurationMinutes} min slots</Text>
                {prices.length > 0 && (
                  <View style={s.priceRow}>
                    {prices.map((r, i) => (
                      <View key={i} style={s.priceChip}>
                        <Text style={s.priceText}>
                          {r.dayType === "ALL"
                            ? `€${r.pricePerHour}/hr`
                            : `${r.dayType === "WEEKDAY" ? "Weekday" : "Weekend"}: €${r.pricePerHour}/hr`}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          })}

          {openingHours.length > 0 && (
            <>
              <View style={s.divider} />
              <Text style={s.sectionTitle}>Opening Hours</Text>
              <View style={s.hoursGrid}>
                {DAYS.map((day, i) => {
                  const entry = openingHours.find((h) => h.dayOfWeek === i);
                  return (
                    <View key={day} style={s.hourRow}>
                      <Text style={s.dayText}>{day}</Text>
                      {!entry || entry.isClosed ? (
                        <Text style={s.closedText}>Closed</Text>
                      ) : (
                        <Text style={s.timeText}>
                          {formatTime(entry.openTime)} – {formatTime(entry.closeTime)}
                        </Text>
                      )}
                    </View>
                  );
                })}
              </View>
            </>
          )}
        </View>
      </ScrollView>

      <View style={s.bottomBar}>
        <TouchableOpacity style={[s.bookBtn, s.bookBtnDisabled]} disabled>
          <Feather name="calendar" size={20} color={colors.mutedForeground} />
          <Text style={[s.bookBtnText, s.bookBtnDisabledText]}>Book Now — Coming Soon</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
