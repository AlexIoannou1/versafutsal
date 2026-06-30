import React, { useState, type ComponentProps } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  TextInput,
  RefreshControl,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import FeatherIcons from "@/components/FeatherIcons";
import { useColors } from "@/hooks/useColors";
import { useListVenues, type VenueSummary } from "@workspace/api-client-react";

type FeatherName = ComponentProps<typeof Feather>["name"];

const DISTRICTS = [
  { key: "", label: "All" },
  { key: "Nicosia", label: "Nicosia" },
  { key: "Limassol", label: "Limassol" },
  { key: "Larnaca", label: "Larnaca" },
  { key: "Paphos", label: "Paphos" },
  { key: "Famagusta", label: "Famagusta" },
];

const TYPES = [
  { key: "", label: "Any" },
  { key: "INDOOR", label: "Indoor" },
  { key: "OUTDOOR", label: "Outdoor" },
  { key: "HYBRID", label: "Hybrid" },
];

const PITCH_TYPE_ICONS: Record<string, FeatherName> = {
  INDOOR: "home",
  OUTDOOR: "sun",
  HYBRID: "layers",
};

export default function PlayerVenuesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [selectedDistrict, setSelectedDistrict] = useState("");
  const [selectedType, setSelectedType] = useState("");
  const [minPriceText, setMinPriceText] = useState("");
  const [maxPriceText, setMaxPriceText] = useState("");

  const minPrice = minPriceText.trim() !== "" ? parseFloat(minPriceText) : undefined;
  const maxPrice = maxPriceText.trim() !== "" ? parseFloat(maxPriceText) : undefined;

  const activeFilterCount =
    (selectedDistrict ? 1 : 0) +
    (selectedType ? 1 : 0) +
    (minPriceText.trim() ? 1 : 0) +
    (maxPriceText.trim() ? 1 : 0);

  const params: Record<string, string | number> = {};
  if (selectedDistrict) params.district = selectedDistrict;
  if (selectedType) params.type = selectedType;
  if (minPrice != null && !isNaN(minPrice)) params.minPrice = minPrice;
  if (maxPrice != null && !isNaN(maxPrice)) params.maxPrice = maxPrice;

  const { data, isLoading, refetch, isRefetching } = useListVenues(
    Object.keys(params).length > 0 ? (params as Parameters<typeof useListVenues>[0]) : undefined,
  );

  const allVenues: VenueSummary[] = data?.venues ?? [];

  const venues = search.trim()
    ? allVenues.filter(
        (v) =>
          v.name.toLowerCase().includes(search.toLowerCase()) ||
          v.district.toLowerCase().includes(search.toLowerCase()),
      )
    : allVenues;

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    headerArea: {
      backgroundColor: colors.background,
      paddingHorizontal: 16,
      paddingTop: insets.top + 16,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerTitle: {
      fontSize: 22,
      fontFamily: "Inter_700Bold",
      color: colors.foreground,
      marginBottom: 12,
    },
    searchRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    searchInput: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.card,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 12,
      height: 44,
      gap: 8,
    },
    searchTextField: {
      flex: 1,
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
    },
    filterToggleBtn: {
      height: 44,
      paddingHorizontal: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: activeFilterCount > 0 ? colors.primary : colors.border,
      backgroundColor: activeFilterCount > 0 ? colors.primary + "12" : colors.card,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    filterToggleBtnText: {
      fontSize: 13,
      fontFamily: "Inter_500Medium",
      color: activeFilterCount > 0 ? colors.primary : colors.foreground,
    },
    filterBadge: {
      minWidth: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 4,
    },
    filterBadgeText: {
      fontSize: 10,
      fontFamily: "Inter_700Bold",
      color: colors.primaryForeground,
    },
    filtersPanel: {
      marginTop: 10,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    filterLabel: {
      fontSize: 11,
      fontFamily: "Inter_600SemiBold",
      color: colors.mutedForeground,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: 6,
    },
    clearFiltersBtn: {
      alignSelf: "flex-end",
      marginTop: 8,
    },
    clearFiltersBtnText: {
      fontSize: 12,
      fontFamily: "Inter_500Medium",
      color: colors.destructive,
    },
    filterSection: { marginBottom: 10 },
    filterRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
    filterChip: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 20,
      borderWidth: 1,
    },
    filterChipText: { fontSize: 12, fontFamily: "Inter_500Medium" },
    priceRow: { flexDirection: "row", gap: 6, alignItems: "center" },
    priceInput: {
      width: 80,
      backgroundColor: colors.card,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 10,
      paddingVertical: 7,
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
      textAlign: "center",
    },
    priceSep: {
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    list: { padding: 16, paddingBottom: insets.bottom + 100 },
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
    emptyIcon: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: colors.muted,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 16,
    },
    emptyTitle: {
      fontSize: 18,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
      marginBottom: 8,
    },
    emptySub: {
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      textAlign: "center",
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: 12,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
    },
    cardImage: { width: "100%", height: 140, backgroundColor: colors.muted },
    imagePlaceholder: {
      width: "100%",
      height: 140,
      backgroundColor: colors.muted,
      alignItems: "center",
      justifyContent: "center",
    },
    cardBody: { padding: 14 },
    cardName: {
      fontSize: 16,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
      marginBottom: 4,
    },
    cardMeta: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      marginBottom: 6,
    },
    cardMetaText: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    pitchTypeRow: { flexDirection: "row", gap: 6, marginBottom: 6 },
    pitchTypeChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: colors.primary + "15",
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    pitchTypeText: {
      fontSize: 11,
      fontFamily: "Inter_500Medium",
      color: colors.primary,
    },
    cardBottom: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 8,
    },
    priceText: {
      fontSize: 14,
      fontFamily: "Inter_600SemiBold",
      color: colors.primary,
    },
    amenitiesRow: { flexDirection: "row", gap: 6, flexWrap: "wrap", marginBottom: 6 },
    amenityChip: {
      backgroundColor: colors.muted,
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    amenityText: {
      fontSize: 11,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    viewBtn: {
      backgroundColor: colors.primary,
      borderRadius: 8,
      paddingHorizontal: 14,
      paddingVertical: 7,
    },
    viewBtnText: {
      fontSize: 13,
      fontFamily: "Inter_600SemiBold",
      color: colors.primaryForeground,
    },
  });

  const pitchTypeLabel: Record<string, string> = {
    INDOOR: "Indoor",
    OUTDOOR: "Outdoor",
    HYBRID: "Hybrid",
  };

  return (
    <View style={s.container}>
      <View style={s.headerArea}>
        <Text style={s.headerTitle}>Find a Venue</Text>

        {/* Search bar + filter toggle always visible */}
        <View style={s.searchRow}>
          <View style={s.searchInput}>
            <FeatherIcons name="search" size={16} color={colors.mutedForeground} />
            <TextInput
              style={s.searchTextField}
              value={search}
              onChangeText={setSearch}
              placeholder="Search venues or districts…"
              placeholderTextColor={colors.mutedForeground}
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch("")}>
                <FeatherIcons name="x" size={16} color={colors.mutedForeground} />
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity
            style={s.filterToggleBtn}
            onPress={() => setShowFilters((v) => !v)}
          >
            <Feather
              name="sliders"
              size={16}
              color={activeFilterCount > 0 ? colors.primary : colors.foreground}
            />
            {activeFilterCount > 0 ? (
              <View style={s.filterBadge}>
                <Text style={s.filterBadgeText}>{activeFilterCount}</Text>
              </View>
            ) : (
              <Text style={s.filterToggleBtnText}>Filters</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Collapsible advanced filters */}
        {showFilters && (
          <View style={s.filtersPanel}>
            <View style={s.filterSection}>
              <Text style={s.filterLabel}>District</Text>
              <View style={s.filterRow}>
                {DISTRICTS.map((opt) => {
                  const active = selectedDistrict === opt.key;
                  return (
                    <TouchableOpacity
                      key={opt.key}
                      style={[
                        s.filterChip,
                        {
                          backgroundColor: active ? colors.primary : "transparent",
                          borderColor: active ? colors.primary : colors.border,
                        },
                      ]}
                      onPress={() => setSelectedDistrict(opt.key)}
                    >
                      <Text
                        style={[
                          s.filterChipText,
                          { color: active ? colors.primaryForeground : colors.mutedForeground },
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={s.filterSection}>
              <Text style={s.filterLabel}>Pitch Type</Text>
              <View style={s.filterRow}>
                {TYPES.map((opt) => {
                  const active = selectedType === opt.key;
                  return (
                    <TouchableOpacity
                      key={opt.key}
                      style={[
                        s.filterChip,
                        {
                          backgroundColor: active ? colors.primary : "transparent",
                          borderColor: active ? colors.primary : colors.border,
                        },
                      ]}
                      onPress={() => setSelectedType(opt.key)}
                    >
                      <Text
                        style={[
                          s.filterChipText,
                          { color: active ? colors.primaryForeground : colors.mutedForeground },
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={s.filterSection}>
              <Text style={s.filterLabel}>Price Range (€/hr)</Text>
              <View style={s.priceRow}>
                <TextInput
                  style={s.priceInput}
                  value={minPriceText}
                  onChangeText={setMinPriceText}
                  placeholder="Min"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="numeric"
                  returnKeyType="done"
                />
                <Text style={s.priceSep}>–</Text>
                <TextInput
                  style={s.priceInput}
                  value={maxPriceText}
                  onChangeText={setMaxPriceText}
                  placeholder="Max"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="numeric"
                  returnKeyType="done"
                />
              </View>
            </View>

            {activeFilterCount > 0 && (
              <TouchableOpacity
                style={s.clearFiltersBtn}
                onPress={() => {
                  setSelectedDistrict("");
                  setSelectedType("");
                  setMinPriceText("");
                  setMaxPriceText("");
                }}
              >
                <Text style={s.clearFiltersBtnText}>Clear all filters</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      {isLoading ? (
        <View style={s.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : venues.length === 0 ? (
        <View style={s.center}>
          <View style={s.emptyIcon}>
            <FeatherIcons name="search" size={28} color={colors.mutedForeground} />
          </View>
          <Text style={s.emptyTitle}>No venues found</Text>
          <Text style={s.emptySub}>
            {search || selectedDistrict || selectedType || minPriceText || maxPriceText
              ? "Try adjusting your filters."
              : "No approved venues yet. Check back soon!"}
          </Text>
        </View>
      ) : (
        <FlatList
          data={venues}
          keyExtractor={(item) => item.id}
          contentContainerStyle={s.list}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={s.card}
              onPress={() => router.push(`/player/venue/${item.id}`)}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={`View ${item.name}`}
            >
              {item.coverPhoto ? (
                <Image
                  source={{ uri: item.coverPhoto }}
                  style={s.cardImage}
                  resizeMode="cover"
                />
              ) : (
                <View style={s.imagePlaceholder}>
                  <FeatherIcons name="image" size={32} color={colors.mutedForeground} />
                </View>
              )}
              <View style={s.cardBody}>
                <Text style={s.cardName} numberOfLines={1}>
                  {item.name}
                </Text>
                <View style={s.cardMeta}>
                  <FeatherIcons name="map-pin" size={13} color={colors.mutedForeground} />
                  <Text style={s.cardMetaText}>{item.district}</Text>
                </View>

                {item.pitchTypes.length > 0 && (
                  <View style={s.pitchTypeRow}>
                    {item.pitchTypes.map((pt) => (
                      <View key={pt} style={s.pitchTypeChip}>
                        <Feather
                          name={PITCH_TYPE_ICONS[pt] ?? "circle"}
                          size={11}
                          color={colors.primary}
                        />
                        <Text style={s.pitchTypeText}>
                          {pitchTypeLabel[pt] ?? pt}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}

                {item.amenities.length > 0 && (
                  <View style={s.amenitiesRow}>
                    {item.amenities.slice(0, 3).map((a) => (
                      <View key={a} style={s.amenityChip}>
                        <Text style={s.amenityText}>{a}</Text>
                      </View>
                    ))}
                    {item.amenities.length > 3 && (
                      <View style={s.amenityChip}>
                        <Text style={s.amenityText}>+{item.amenities.length - 3} more</Text>
                      </View>
                    )}
                  </View>
                )}

                <View style={s.cardBottom}>
                  <Text style={s.priceText}>
                    {item.minPrice != null
                      ? item.minPrice === item.maxPrice
                        ? `€${item.minPrice}/hr`
                        : `€${item.minPrice}–€${item.maxPrice}/hr`
                      : "Price on request"}
                  </Text>
                  <View style={s.viewBtn}>
                    <Text style={s.viewBtnText}>View →</Text>
                  </View>
                </View>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}
