import React, { useState } from "react";
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
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useListVenues } from "@workspace/api-client-react";

const DISTRICTS = [
  { key: "", label: "All" },
  { key: "Nicosia", label: "Nicosia" },
  { key: "Limassol", label: "Limassol" },
  { key: "Larnaca", label: "Larnaca" },
  { key: "Paphos", label: "Paphos" },
  { key: "Famagusta", label: "Famagusta" },
];

const TYPES = [
  { key: "", label: "All" },
  { key: "INDOOR", label: "Indoor" },
  { key: "OUTDOOR", label: "Outdoor" },
  { key: "HYBRID", label: "Hybrid" },
];

type VenueSummary = {
  id: string;
  name: string;
  district: string;
  address: string;
  amenities: string[];
  coverPhoto?: string | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  status: string;
};

export default function PlayerVenuesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [search, setSearch] = useState("");
  const [selectedDistrict, setSelectedDistrict] = useState("");
  const [selectedType, setSelectedType] = useState("");

  const params: Record<string, string> = {};
  if (selectedDistrict) params.district = selectedDistrict;
  if (selectedType) params.type = selectedType;

  const { data, isLoading, refetch, isRefetching } = useListVenues(
    Object.keys(params).length > 0 ? params : undefined,
  );

  const allVenues: VenueSummary[] = (data?.venues as VenueSummary[] | undefined) ?? [];

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
      backgroundColor: colors.card,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 12,
      marginBottom: 10,
      height: 44,
    },
    searchInput: {
      flex: 1,
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
      marginLeft: 8,
    },
    filterRow: { flexDirection: "row", gap: 8 },
    filterChip: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 20,
      borderWidth: 1,
    },
    filterChipText: { fontSize: 12, fontFamily: "Inter_500Medium" },
    list: { padding: 16 },
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

  const filterSections = [
    { label: "District", options: DISTRICTS, selected: selectedDistrict, setSelected: setSelectedDistrict },
    { label: "Type", options: TYPES, selected: selectedType, setSelected: setSelectedType },
  ];

  return (
    <View style={s.container}>
      <View style={s.headerArea}>
        <Text style={s.headerTitle}>Find a Venue</Text>
        <View style={s.searchRow}>
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            style={s.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search venues or districts…"
            placeholderTextColor={colors.mutedForeground}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch("")}>
              <Feather name="x" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>

        <View style={s.filterRow}>
          {filterSections.map((section) =>
            section.options.map((opt) => {
              const active = section.selected === opt.key;
              return (
                <TouchableOpacity
                  key={`${section.label}-${opt.key}`}
                  style={[
                    s.filterChip,
                    {
                      backgroundColor: active ? colors.primary : "transparent",
                      borderColor: active ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => section.setSelected(opt.key)}
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
            }),
          )}
        </View>
      </View>

      {isLoading ? (
        <View style={s.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : venues.length === 0 ? (
        <View style={s.center}>
          <View style={s.emptyIcon}>
            <Feather name="search" size={28} color={colors.mutedForeground} />
          </View>
          <Text style={s.emptyTitle}>No venues found</Text>
          <Text style={s.emptySub}>
            {search || selectedDistrict || selectedType
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
            <View style={s.card}>
              {item.coverPhoto ? (
                <Image
                  source={{ uri: item.coverPhoto }}
                  style={s.cardImage}
                  resizeMode="cover"
                />
              ) : (
                <View style={s.imagePlaceholder}>
                  <Feather name="image" size={32} color={colors.mutedForeground} />
                </View>
              )}
              <View style={s.cardBody}>
                <Text style={s.cardName} numberOfLines={1}>
                  {item.name}
                </Text>
                <View style={s.cardMeta}>
                  <Feather name="map-pin" size={13} color={colors.mutedForeground} />
                  <Text style={s.cardMetaText}>{item.district}</Text>
                </View>

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
                  <TouchableOpacity
                    style={s.viewBtn}
                    onPress={() => router.push(`/player/venue/${item.id}`)}
                  >
                    <Text style={s.viewBtnText}>View</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}
