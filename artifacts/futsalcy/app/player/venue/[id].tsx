import React, { useState, useMemo, type ComponentProps } from "react";
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
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AntDesign } from "@expo/vector-icons";
import FeatherIcons from "@/components/FeatherIcons";
import { useColors } from "@/hooks/useColors";
import {
  useGetVenue,
  type VenueDetail,
  useFavouriteIds,
  useToggleFavourite,
  useGetPitchAvailability,
} from "@workspace/api-client-react";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SHORT_DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SHORT_MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MAX_SLOT_CHIPS = 5;

function formatTime(t: string): string {
  const [h, m] = t.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatSlotTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getUTCHours();
  const min = d.getUTCMinutes();
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

type FeatherName = ComponentProps<typeof FeatherIcons>["name"];

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

// ─── Date Strip ───────────────────────────────────────────────────────────────

interface DateStripProps {
  selectedDateStr: string;
  onSelect: (dateStr: string) => void;
}

function DateStrip({ selectedDateStr, onSelect }: DateStripProps) {
  const colors = useColors();

  const days = useMemo(() => {
    const result: Date[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      result.push(d);
    }
    return result;
  }, []);

  const s = StyleSheet.create({
    strip: {
      paddingHorizontal: 12,
      paddingVertical: 10,
      gap: 8,
    },
    dayBtn: {
      alignItems: "center",
      justifyContent: "center",
      width: 52,
      paddingVertical: 8,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      marginRight: 8,
    },
    dayBtnSelected: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    dayName: {
      fontSize: 11,
      fontFamily: "PlusJakartaSans_500Medium",
      color: colors.mutedForeground,
    },
    dayNameSelected: { color: colors.primaryForeground },
    dayNum: {
      fontSize: 17,
      fontFamily: "PlusJakartaSans_700Bold",
      color: colors.foreground,
      marginTop: 2,
    },
    dayNumSelected: { color: colors.primaryForeground },
    monthLabel: {
      fontSize: 10,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.mutedForeground,
      marginTop: 1,
    },
    monthLabelSelected: { color: colors.primaryForeground + "cc" },
  });

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.strip}
    >
      {days.map((d) => {
        const ds = toDateStr(d);
        const isSelected = ds === selectedDateStr;
        return (
          <TouchableOpacity
            key={ds}
            style={[s.dayBtn, isSelected && s.dayBtnSelected]}
            onPress={() => onSelect(ds)}
            activeOpacity={0.75}
          >
            <Text style={[s.dayName, isSelected && s.dayNameSelected]}>
              {SHORT_DAY_NAMES[d.getDay()]}
            </Text>
            <Text style={[s.dayNum, isSelected && s.dayNumSelected]}>
              {d.getDate()}
            </Text>
            <Text style={[s.monthLabel, isSelected && s.monthLabelSelected]}>
              {SHORT_MONTH_NAMES[d.getMonth()]}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

// ─── Pitch Card ───────────────────────────────────────────────────────────────

interface PitchCardProps {
  venueId: string;
  pitch: {
    id: string;
    name: string;
    size: string;
    type: string;
    slotDurationMinutes: number;
    pricingRules: Array<{ dayType: string; pricePerHour: string }>;
  };
  selectedDateStr: string;
  onBook: (pitchId: string, pitchName: string, slotMins: number) => void;
}

function PitchCard({ venueId, pitch, selectedDateStr, onBook }: PitchCardProps) {
  const colors = useColors();

  const { data: availData, isLoading: slotsLoading } = useGetPitchAvailability(
    venueId,
    pitch.id,
    { date: selectedDateStr },
    { query: { enabled: !!selectedDateStr && !!venueId && !!pitch.id } },
  );

  const availableSlots = useMemo(
    () => (availData?.slots ?? []).filter((s) => s.available),
    [availData],
  );

  const visibleSlots = availableSlots.slice(0, MAX_SLOT_CHIPS);
  const extraCount = availableSlots.length - visibleSlots.length;
  const prices = pitch.pricingRules ?? [];

  const s = StyleSheet.create({
    pitchCard: {
      backgroundColor: colors.card,
      borderRadius: 10,
      padding: 14,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: colors.border,
    },
    pitchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    pitchName: {
      fontSize: 15,
      fontFamily: "PlusJakartaSans_600SemiBold",
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
    pitchTypeText: { fontSize: 12, fontFamily: "PlusJakartaSans_500Medium", color: colors.foreground },
    pitchSize: {
      fontSize: 13,
      fontFamily: "PlusJakartaSans_400Regular",
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
      fontFamily: "PlusJakartaSans_600SemiBold",
      color: colors.primary,
    },
    slotsDivider: {
      height: 1,
      backgroundColor: colors.border,
      marginTop: 10,
      marginBottom: 8,
    },
    slotsRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
    },
    slotChip: {
      backgroundColor: colors.primary + "12",
      borderRadius: 6,
      paddingHorizontal: 9,
      paddingVertical: 5,
      borderWidth: 1,
      borderColor: colors.primary + "40",
    },
    slotChipText: {
      fontSize: 12,
      fontFamily: "PlusJakartaSans_600SemiBold",
      color: colors.primary,
    },
    moreChip: {
      backgroundColor: colors.muted,
      borderRadius: 6,
      paddingHorizontal: 9,
      paddingVertical: 5,
    },
    moreChipText: {
      fontSize: 12,
      fontFamily: "PlusJakartaSans_500Medium",
      color: colors.mutedForeground,
    },
    noSlotsText: {
      fontSize: 12,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.mutedForeground,
      fontStyle: "italic",
    },
    loaderRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginTop: 2,
    },
    loaderText: {
      fontSize: 12,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.mutedForeground,
    },
    bookPitchBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      backgroundColor: colors.primary,
      borderRadius: 8,
      paddingVertical: 10,
      marginTop: 12,
    },
    bookPitchBtnText: {
      fontSize: 14,
      fontFamily: "PlusJakartaSans_600SemiBold",
      color: colors.primaryForeground,
    },
  });

  return (
    <View style={s.pitchCard}>
      <View style={s.pitchRow}>
        <Text style={s.pitchName}>{pitch.name}</Text>
        <View style={s.pitchTypeBadge}>
          <FeatherIcons
            name={TYPE_ICONS[pitch.type] ?? "circle"}
            size={12}
            color={colors.foreground}
          />
          <Text style={s.pitchTypeText}>{TYPE_LABELS[pitch.type] ?? pitch.type}</Text>
        </View>
      </View>
      <Text style={s.pitchSize}>
        {pitch.size} · {pitch.slotDurationMinutes} min slots
      </Text>
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

      {/* Available slots for selected date */}
      <View style={s.slotsDivider} />
      {slotsLoading ? (
        <View style={s.loaderRow}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={s.loaderText}>Loading slots…</Text>
        </View>
      ) : availableSlots.length === 0 ? (
        <Text style={s.noSlotsText}>No available slots</Text>
      ) : (
        <View style={s.slotsRow}>
          {visibleSlots.map((slot) => (
            <View key={slot.startAt} style={s.slotChip}>
              <Text style={s.slotChipText}>{formatSlotTime(slot.startAt)}</Text>
            </View>
          ))}
          {extraCount > 0 && (
            <View style={s.moreChip}>
              <Text style={s.moreChipText}>+{extraCount} more</Text>
            </View>
          )}
        </View>
      )}

      <TouchableOpacity
        style={s.bookPitchBtn}
        onPress={() => onBook(pitch.id, pitch.name, pitch.slotDurationMinutes)}
      >
        <FeatherIcons name="calendar" size={16} color={colors.primaryForeground} />
        <Text style={s.bookPitchBtnText}>Book Slot</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function PlayerVenueDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [photoIndex, setPhotoIndex] = useState(0);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return toDateStr(d);
  }, []);
  const [selectedDateStr, setSelectedDateStr] = useState<string>(today);

  const { data, isLoading, error } = useGetVenue(id!);
  const venue: VenueDetail | undefined = data?.venue;

  const { data: favouriteIdsData } = useFavouriteIds();
  const isFavourited = (favouriteIdsData?.venueIds ?? []).includes(id!);
  const toggleFavourite = useToggleFavourite();

  function handleBookPitch(pitchId: string, pitchName: string, slotMins: number) {
    router.push(
      `/player/venue/${id}/book?pitchId=${pitchId}&pitchName=${encodeURIComponent(pitchName)}&slotMins=${slotMins}&date=${selectedDateStr}`,
    );
  }

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
    errorText: {
      fontSize: 16,
      fontFamily: "PlusJakartaSans_400Regular",
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
      paddingBottom: insets.bottom + 24,
    },
    venueName: {
      fontSize: 22,
      fontFamily: "PlusJakartaSans_700Bold",
      color: colors.foreground,
      marginBottom: 6,
    },
    metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
    metaText: {
      fontSize: 14,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.mutedForeground,
    },
    mapLink: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 16 },
    mapText: {
      fontSize: 14,
      fontFamily: "PlusJakartaSans_500Medium",
      color: colors.primary,
    },
    sectionTitle: {
      fontSize: 16,
      fontFamily: "PlusJakartaSans_700Bold",
      color: colors.foreground,
      marginBottom: 12,
      marginTop: 20,
    },
    description: {
      fontSize: 14,
      fontFamily: "PlusJakartaSans_400Regular",
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
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.foreground,
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
      fontFamily: "PlusJakartaSans_500Medium",
      color: colors.foreground,
      width: 40,
    },
    timeText: {
      fontSize: 14,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.mutedForeground,
    },
    closedText: {
      fontSize: 14,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.destructive,
    },
    divider: {
      height: 1,
      backgroundColor: colors.border,
      marginTop: 20,
    },
    venueHeaderRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
    },
    venueTitleFlex: { flex: 1 },
    heartBtn: {
      padding: 6,
      marginLeft: 12,
      marginTop: 2,
    },
    pitchesSectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 20,
      marginBottom: 0,
    },
    pitchesSectionTitle: {
      fontSize: 16,
      fontFamily: "PlusJakartaSans_700Bold",
      color: colors.foreground,
    },
    dateStripWrapper: {
      marginHorizontal: -20,
      marginBottom: 12,
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

  const photos = ((venue.photos as Array<{ id: string; url: string; sortOrder: number }>) ?? [])
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
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

  const mapQuery = encodeURIComponent(
    String(venue.name) + " " + String(venue.address) + " " + String(venue.district) + " Cyprus",
  );
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
                const idx = Math.round(
                  e.nativeEvent.contentOffset.x / e.nativeEvent.layoutMeasurement.width,
                );
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
              <FeatherIcons name="image" size={48} color={colors.mutedForeground} />
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
          <View style={s.venueHeaderRow}>
            <View style={s.venueTitleFlex}>
              <Text style={s.venueName}>{String(venue.name)}</Text>
            </View>
            <TouchableOpacity
              style={s.heartBtn}
              onPress={() => toggleFavourite.mutate({ venueId: id!, isFavourited })}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel={isFavourited ? "Remove from favourites" : "Add to favourites"}
            >
              {isFavourited ? (
                <AntDesign name="heart" size={24} color={colors.destructive} />
              ) : (
                <FeatherIcons name="heart" size={24} color={colors.mutedForeground} />
              )}
            </TouchableOpacity>
          </View>
          <View style={s.metaRow}>
            <FeatherIcons name="map-pin" size={14} color={colors.mutedForeground} />
            <Text style={s.metaText}>{String(venue.district)}</Text>
          </View>
          <TouchableOpacity style={s.mapLink} onPress={() => Linking.openURL(mapUrl)}>
            <FeatherIcons name="navigation" size={14} color={colors.primary} />
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
                    <FeatherIcons name="check" size={14} color={colors.primary} />
                    <Text style={s.amenityText}>{a}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          <View style={s.divider} />

          {/* Pitches section with date selector */}
          <View style={s.pitchesSectionHeader}>
            <Text style={s.pitchesSectionTitle}>Pitches ({pitches.length})</Text>
          </View>

          {pitches.length > 0 && (
            <View style={s.dateStripWrapper}>
              <DateStrip selectedDateStr={selectedDateStr} onSelect={setSelectedDateStr} />
            </View>
          )}

          {pitches.map((pitch) => (
            <PitchCard
              key={pitch.id}
              venueId={id!}
              pitch={pitch}
              selectedDateStr={selectedDateStr}
              onBook={handleBookPitch}
            />
          ))}

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
    </View>
  );
}
