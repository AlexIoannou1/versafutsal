import React from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  RefreshControl,
  type ComponentProps,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import FeatherIcons from "@/components/FeatherIcons";
import { useColors } from "@/hooks/useColors";
import {
  useListFavourites,
  useToggleFavourite,
  type FavouriteVenueSummary,
} from "@workspace/api-client-react";

type FeatherName = ComponentProps<typeof FeatherIcons>["name"];

const PITCH_TYPE_ICONS: Record<string, FeatherName> = {
  INDOOR: "home",
  OUTDOOR: "sun",
  HYBRID: "layers",
};

const PITCH_TYPE_LABELS: Record<string, string> = {
  INDOOR: "Indoor",
  OUTDOOR: "Outdoor",
  HYBRID: "Hybrid",
};

export default function FavouritesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data, isLoading, refetch, isRefetching } = useListFavourites();
  const toggle = useToggleFavourite();

  const venues: FavouriteVenueSummary[] = data?.venues ?? [];

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    headerArea: {
      backgroundColor: colors.background,
      paddingHorizontal: 16,
      paddingTop: insets.top + 16,
      paddingBottom: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerTitle: {
      fontSize: 22,
      fontFamily: "Inter_700Bold",
      color: colors.foreground,
    },
    headerSub: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      marginTop: 2,
    },
    list: { padding: 16, paddingBottom: insets.bottom + 100 },
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
    emptyIcon: {
      width: 72,
      height: 72,
      borderRadius: 36,
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
      textAlign: "center",
    },
    emptySub: {
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      textAlign: "center",
      lineHeight: 20,
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
    cardHeader: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
    },
    cardName: {
      fontSize: 16,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
      flex: 1,
      marginBottom: 4,
    },
    heartBtn: {
      padding: 4,
      marginLeft: 8,
      marginTop: -2,
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
    pitchTypeText: { fontSize: 11, fontFamily: "Inter_500Medium", color: colors.primary },
    cardBottom: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 8,
    },
    priceText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.primary },
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
  });

  const renderItem = ({ item }: { item: FavouriteVenueSummary }) => (
    <TouchableOpacity
      style={s.card}
      onPress={() => router.push(`/player/venue/${item.id}`)}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`View ${item.name}`}
    >
      {item.coverPhoto ? (
        <Image source={{ uri: item.coverPhoto }} style={s.cardImage} resizeMode="cover" />
      ) : (
        <View style={s.imagePlaceholder}>
          <FeatherIcons name="image" size={32} color={colors.mutedForeground} />
        </View>
      )}
      <View style={s.cardBody}>
        <View style={s.cardHeader}>
          <Text style={s.cardName} numberOfLines={1}>
            {item.name}
          </Text>
          <TouchableOpacity
            style={s.heartBtn}
            onPress={() =>
              toggle.mutate({ venueId: item.id, isFavourited: true })
            }
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Remove from favourites"
          >
            <FeatherIcons name="heart" size={20} color={colors.destructive} />
          </TouchableOpacity>
        </View>

        <View style={s.cardMeta}>
          <FeatherIcons name="map-pin" size={13} color={colors.mutedForeground} />
          <Text style={s.cardMetaText}>{item.district}</Text>
        </View>

        {item.pitchTypes.length > 0 && (
          <View style={s.pitchTypeRow}>
            {item.pitchTypes.map((pt) => (
              <View key={pt} style={s.pitchTypeChip}>
                <FeatherIcons
                  name={PITCH_TYPE_ICONS[pt] ?? "circle"}
                  size={11}
                  color={colors.primary}
                />
                <Text style={s.pitchTypeText}>{PITCH_TYPE_LABELS[pt] ?? pt}</Text>
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
  );

  return (
    <View style={s.container}>
      <View style={s.headerArea}>
        <Text style={s.headerTitle}>Favourites</Text>
        {venues.length > 0 && (
          <Text style={s.headerSub}>{venues.length} saved venue{venues.length !== 1 ? "s" : ""}</Text>
        )}
      </View>

      {isLoading ? (
        <View style={s.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : venues.length === 0 ? (
        <View style={s.center}>
          <View style={s.emptyIcon}>
            <FeatherIcons name="heart" size={32} color={colors.mutedForeground} />
          </View>
          <Text style={s.emptyTitle}>No favourites yet</Text>
          <Text style={s.emptySub}>
            Tap the heart icon on any venue to save it here for quick access.
          </Text>
        </View>
      ) : (
        <FlatList
          data={venues}
          keyExtractor={(item) => item.id}
          contentContainerStyle={s.list}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
        />
      )}
    </View>
  );
}
