import React, { useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  ScrollView,
  Modal,
  Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import FeatherIcons from "@/components/FeatherIcons";
import { useColors } from "@/hooks/useColors";
import { useAdminListUsers } from "@workspace/api-client-react";
import type { AdminUserRecord } from "@workspace/api-client-react";

const ROLE_FILTERS = [
  { key: "ALL", label: "All" },
  { key: "PLAYER", label: "Players" },
  { key: "VENUE_OWNER", label: "Venue Owners" },
] as const;

type RoleFilter = "ALL" | "PLAYER" | "VENUE_OWNER";

const ROLE_COLORS: Record<string, string> = {
  PLAYER: "#3B82F6",
  VENUE_OWNER: "#8B5CF6",
};

const STRIPE_STATUS_COLORS: Record<string, string> = {
  connected: "#00C851",
  pending: "#F59E0B",
  none: "#6B7280",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function stripeStatus(accountId: string | null): "connected" | "pending" | "none" {
  if (!accountId) return "none";
  return "connected";
}

// ─── Avatar ──────────────────────────────────────────────────────────────────
function UserAvatar({
  avatarUrl,
  name,
  size = 40,
  colors,
}: {
  avatarUrl: string | null;
  name: string;
  size?: number;
  colors: ReturnType<typeof useColors>;
}) {
  const initials = getInitials(name);
  if (avatarUrl) {
    return (
      <Image
        source={{ uri: avatarUrl }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.primary + "25",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          fontSize: size * 0.38,
          fontFamily: "PlusJakartaSans_600SemiBold",
          color: colors.primary,
        }}
      >
        {initials}
      </Text>
    </View>
  );
}

// ─── User Card ────────────────────────────────────────────────────────────────
function AdminUserCard({
  user,
  onPress,
  colors,
}: {
  user: AdminUserRecord;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const roleColor = ROLE_COLORS[user.role] ?? colors.mutedForeground;
  const isDeleted = !!user.deletedAt;
  const stripeState = stripeStatus(user.stripeConnectAccountId);

  return (
    <TouchableOpacity
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: isDeleted ? colors.destructive + "40" : colors.border,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <View style={styles.cardRow}>
        <UserAvatar avatarUrl={user.avatarUrl} name={user.name} size={44} colors={colors} />

        <View style={{ flex: 1, marginLeft: 12 }}>
          <View style={styles.nameRow}>
            <Text
              style={[
                styles.name,
                { color: colors.foreground, flex: 1, marginRight: 6 },
              ]}
              numberOfLines={1}
            >
              {user.name}
            </Text>
            <View style={[styles.badge, { backgroundColor: roleColor + "20" }]}>
              <Text style={[styles.badgeText, { color: roleColor }]}>
                {user.role === "VENUE_OWNER" ? "Owner" : "Player"}
              </Text>
            </View>
            {isDeleted && (
              <View
                style={[
                  styles.badge,
                  { backgroundColor: colors.destructive + "20", marginLeft: 4 },
                ]}
              >
                <Text style={[styles.badgeText, { color: colors.destructive }]}>
                  Deleted
                </Text>
              </View>
            )}
          </View>

          <Text
            style={[styles.meta, { color: colors.mutedForeground }]}
            numberOfLines={1}
          >
            {user.email}
          </Text>
          {user.phoneNumber ? (
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>
              {user.phoneNumber}
            </Text>
          ) : null}

          <View style={styles.bottomRow}>
            <Text style={[styles.metaSmall, { color: colors.mutedForeground }]}>
              Joined {formatDate(user.createdAt)}
            </Text>
            {user.role === "VENUE_OWNER" && (
              <View
                style={[
                  styles.stripeBadge,
                  {
                    backgroundColor:
                      STRIPE_STATUS_COLORS[stripeState] + "20",
                  },
                ]}
              >
                <Text
                  style={[
                    styles.metaSmall,
                    { color: STRIPE_STATUS_COLORS[stripeState] },
                  ]}
                >
                  Stripe: {stripeState}
                </Text>
              </View>
            )}
          </View>
        </View>

        <FeatherIcons
          name="chevron-right"
          size={16}
          color={colors.mutedForeground}
        />
      </View>
    </TouchableOpacity>
  );
}

// ─── Detail Section ────────────────────────────────────────────────────────────
function DetailRow({
  label,
  value,
  colors,
}: {
  label: string;
  value: string | null | undefined;
  colors: ReturnType<typeof useColors>;
}) {
  if (!value) return null;
  return (
    <View style={styles.detailRow}>
      <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>
        {label}
      </Text>
      <Text style={[styles.detailValue, { color: colors.foreground }]}>
        {value}
      </Text>
    </View>
  );
}

function SectionHeader({ title, colors }: { title: string; colors: ReturnType<typeof useColors> }) {
  return (
    <Text style={[styles.sectionHeader, { color: colors.mutedForeground }]}>
      {title}
    </Text>
  );
}

// ─── Detail Modal ──────────────────────────────────────────────────────────────
function UserDetailModal({
  user,
  visible,
  onClose,
  colors,
  insets,
}: {
  user: AdminUserRecord | null;
  visible: boolean;
  onClose: () => void;
  colors: ReturnType<typeof useColors>;
  insets: ReturnType<typeof useSafeAreaInsets>;
}) {
  if (!user) return null;

  const roleColor = ROLE_COLORS[user.role] ?? colors.mutedForeground;
  const isDeleted = !!user.deletedAt;
  const stripeState = stripeStatus(user.stripeConnectAccountId);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View
        style={[
          styles.modalOverlay,
          { backgroundColor: "rgba(0,0,0,0.5)" },
        ]}
      >
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <View
          style={[
            styles.modalSheet,
            {
              backgroundColor: colors.card,
              paddingBottom: insets.bottom + 24,
            },
          ]}
        >
          {/* Handle */}
          <View style={[styles.handle, { backgroundColor: colors.border }]} />

          {/* Header */}
          <View style={styles.modalHeader}>
            <UserAvatar
              avatarUrl={user.avatarUrl}
              name={user.name}
              size={56}
              colors={colors}
            />
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text
                style={[styles.modalName, { color: colors.foreground }]}
                numberOfLines={2}
              >
                {user.name}
              </Text>
              <View style={styles.nameRow}>
                <View style={[styles.badge, { backgroundColor: roleColor + "20" }]}>
                  <Text style={[styles.badgeText, { color: roleColor }]}>
                    {user.role === "VENUE_OWNER" ? "Venue Owner" : "Player"}
                  </Text>
                </View>
                {isDeleted && (
                  <View
                    style={[
                      styles.badge,
                      {
                        backgroundColor: colors.destructive + "20",
                        marginLeft: 6,
                      },
                    ]}
                  >
                    <Text
                      style={[styles.badgeText, { color: colors.destructive }]}
                    >
                      Deleted
                    </Text>
                  </View>
                )}
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <FeatherIcons name="x" size={20} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          {/* Identity */}
          <SectionHeader title="IDENTITY" colors={colors} />
          <DetailRow label="Name" value={user.name} colors={colors} />
          <DetailRow label="User ID" value={user.id} colors={colors} />

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          {/* Contact */}
          <SectionHeader title="CONTACT" colors={colors} />
          <DetailRow label="Email" value={user.email} colors={colors} />
          <DetailRow
            label="Phone"
            value={user.phoneNumber ?? "Not provided"}
            colors={colors}
          />

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          {/* Account */}
          <SectionHeader title="ACCOUNT" colors={colors} />
          <DetailRow label="Role" value={user.role} colors={colors} />
          <DetailRow
            label="Status"
            value={isDeleted ? `Deleted on ${formatDate(user.deletedAt!)}` : "Active"}
            colors={colors}
          />
          <DetailRow
            label="Joined"
            value={formatDate(user.createdAt)}
            colors={colors}
          />

          {user.role === "VENUE_OWNER" && (
            <>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <SectionHeader title="STRIPE" colors={colors} />
              <View style={styles.detailRow}>
                <Text
                  style={[styles.detailLabel, { color: colors.mutedForeground }]}
                >
                  Connect Status
                </Text>
                <View
                  style={[
                    styles.stripeBadge,
                    {
                      backgroundColor:
                        STRIPE_STATUS_COLORS[stripeState] + "20",
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.badgeText,
                      { color: STRIPE_STATUS_COLORS[stripeState] },
                    ]}
                  >
                    {stripeState}
                  </Text>
                </View>
              </View>
              {user.stripeConnectAccountId && (
                <DetailRow
                  label="Account ID"
                  value={user.stripeConnectAccountId}
                  colors={colors}
                />
              )}
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
const PAGE_LIMIT = 50;

export default function AdminUsersScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("ALL");
  const [page, setPage] = useState(1);
  const [selectedUser, setSelectedUser] = useState<AdminUserRecord | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);

  // Accumulated list of all loaded users across pages
  const [allUsers, setAllUsers] = useState<AdminUserRecord[]>([]);

  const params = useMemo(() => {
    const p: { search?: string; role?: "PLAYER" | "VENUE_OWNER"; page: number; limit: number } = {
      page,
      limit: PAGE_LIMIT,
    };
    if (search.trim()) p.search = search.trim();
    if (roleFilter !== "ALL") p.role = roleFilter;
    return p;
  }, [search, roleFilter, page]);

  const { data, isLoading, refetch, isRefetching } = useAdminListUsers(params);
  const total = data?.total ?? 0;

  // Accumulate pages: page===1 always replaces (covers initial load + any filter reset),
  // page>1 appends. Filter changes always reset page to 1, so this handles cache hits
  // correctly without a separate filter-key ref.
  React.useEffect(() => {
    if (!data?.users) return;
    if (page === 1) {
      setAllUsers(data.users);
    } else {
      setAllUsers((prev) => {
        const existingIds = new Set(prev.map((u) => u.id));
        const fresh = data.users.filter((u) => !existingIds.has(u.id));
        return fresh.length > 0 ? [...prev, ...fresh] : prev;
      });
    }
  }, [data, page]);

  // hasMore: we haven't yet fetched enough pages to cover all records
  const hasMore = allUsers.length < total;

  const handleSearchChange = useCallback((text: string) => {
    setSearch(text);
    setPage(1);
  }, []);

  const handleRoleChange = useCallback((role: RoleFilter) => {
    setRoleFilter(role);
    setPage(1);
  }, []);

  const handleLoadMore = useCallback(() => {
    if (!isLoading && !isRefetching && hasMore) setPage((p) => p + 1);
  }, [isLoading, isRefetching, hasMore]);

  const handleRefresh = useCallback(() => {
    setPage(1);
    setAllUsers([]);
    refetch();
  }, [refetch]);

  const openDetail = useCallback((user: AdminUserRecord) => {
    setSelectedUser(user);
    setDetailVisible(true);
  }, []);

  const hasActiveFilters = search !== "" || roleFilter !== "ALL";

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Search Bar */}
      <View
        style={[
          styles.searchRow,
          { borderBottomColor: colors.border },
        ]}
      >
        <View
          style={[
            styles.searchInput,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <FeatherIcons name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            style={[
              styles.searchText,
              { color: colors.foreground, fontFamily: "PlusJakartaSans_400Regular" },
            ]}
            value={search}
            onChangeText={handleSearchChange}
            placeholder="Name, email, or phone…"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {search !== "" && (
            <TouchableOpacity onPress={() => handleSearchChange("")}>
              <FeatherIcons name="x" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Role Filter Chips */}
      <View
        style={[
          styles.filterRow,
          { borderBottomColor: colors.border },
        ]}
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.chipRow}>
            {ROLE_FILTERS.map((f) => {
              const active = roleFilter === f.key;
              return (
                <TouchableOpacity
                  key={f.key}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: active ? colors.primary : colors.card,
                      borderColor: active ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => handleRoleChange(f.key)}
                >
                  <Text
                    style={[
                      styles.chipText,
                      {
                        color: active ? "#fff" : colors.mutedForeground,
                        fontFamily: "PlusJakartaSans_500Medium",
                      },
                    ]}
                  >
                    {f.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      </View>

      {/* Result count */}
      <View style={styles.resultRow}>
        <Text
          style={[
            styles.resultText,
            { color: colors.mutedForeground, fontFamily: "PlusJakartaSans_400Regular" },
          ]}
        >
          {isLoading
            ? "Loading…"
            : `${total} user${total !== 1 ? "s" : ""}${hasActiveFilters ? " matched" : ""}`}
        </Text>
        {hasActiveFilters && (
          <TouchableOpacity
            onPress={() => {
              handleSearchChange("");
              handleRoleChange("ALL");
            }}
          >
            <Text
              style={[
                styles.clearText,
                {
                  color: colors.destructive,
                  fontFamily: "PlusJakartaSans_500Medium",
                },
              ]}
            >
              Clear
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {isLoading && page === 1 && allUsers.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : allUsers.length === 0 && !isLoading ? (
        <View style={styles.emptyWrap}>
          <FeatherIcons name="users" size={36} color={colors.mutedForeground} />
          <Text
            style={[
              styles.emptyTitle,
              { color: colors.foreground, fontFamily: "PlusJakartaSans_500Medium" },
            ]}
          >
            No users found
          </Text>
          <Text
            style={[
              styles.emptySub,
              { color: colors.mutedForeground, fontFamily: "PlusJakartaSans_400Regular" },
            ]}
          >
            {hasActiveFilters
              ? "Try adjusting your search or filters."
              : "No users have registered yet."}
          </Text>
        </View>
      ) : (
        <FlatList
          data={allUsers}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + 100 },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching && page === 1}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
            />
          }
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            (isLoading || isRefetching) && page > 1 ? (
              <ActivityIndicator
                color={colors.primary}
                style={{ marginTop: 12 }}
              />
            ) : null
          }
          renderItem={({ item }) => (
            <AdminUserCard
              user={item}
              onPress={() => openDetail(item)}
              colors={colors}
            />
          )}
        />
      )}

      <UserDetailModal
        user={selectedUser}
        visible={detailVisible}
        onClose={() => setDetailVisible(false)}
        colors={colors}
        insets={insets}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  searchInput: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    gap: 8,
  },
  searchText: {
    flex: 1,
    height: 42,
    fontSize: 14,
  },
  filterRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  chipRow: { flexDirection: "row", gap: 8 },
  chip: {
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
  },
  chipText: { fontSize: 13 },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  resultText: { fontSize: 13 },
  clearText: { fontSize: 13 },
  list: { paddingHorizontal: 16, paddingTop: 4 },
  card: {
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
  },
  cardRow: { flexDirection: "row", alignItems: "center" },
  nameRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4 },
  name: { fontSize: 15, fontFamily: "PlusJakartaSans_600SemiBold" },
  badge: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontFamily: "PlusJakartaSans_600SemiBold" },
  meta: { fontSize: 12, fontFamily: "PlusJakartaSans_400Regular", marginTop: 2 },
  metaSmall: { fontSize: 11, fontFamily: "PlusJakartaSans_400Regular" },
  bottomRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  stripeBadge: {
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 32,
  },
  emptyTitle: { fontSize: 16, textAlign: "center" },
  emptySub: { fontSize: 13, textAlign: "center" },
  // Modal
  modalOverlay: { flex: 1, justifyContent: "flex-end" },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  modalName: {
    fontSize: 18,
    fontFamily: "PlusJakartaSans_700Bold",
    marginBottom: 6,
  },
  closeBtn: { padding: 4 },
  divider: { height: 1, marginVertical: 14 },
  sectionHeader: {
    fontSize: 11,
    fontFamily: "PlusJakartaSans_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 10,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  detailLabel: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    flex: 1,
  },
  detailValue: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_500Medium",
    flex: 2,
    textAlign: "right",
  },
});
