import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import {
  getAdminListUsersQueryKey,
  getGetOwnerSubscriptionAdminQueryKey,
  useAdminListUsers,
  useGetOwnerSubscriptionAdmin,
  useListOwnerSubscriptions,
  useSetOwnerSubscriptionOverride,
} from "@workspace/api-client-react";
import type {
  AdminUserRecord,
  OwnerSubscription,
  OwnerSubscriptionSummary,
  SubscriptionPlan,
} from "@workspace/api-client-react";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import FeatherIcons from "@/components/FeatherIcons";
import { useColors } from "@/hooks/useColors";
import AdminLeaderboardSources from "@/components/AdminLeaderboardSources";

const ROLES = [
  { key: "ALL", label: "All users" },
  { key: "PLAYER", label: "Players" },
  { key: "VENUE_OWNER", label: "Venue owners" },
] as const;
const PLANS = ["ALL", "FREE", "PRO", "ELITE"] as const;
type RoleFilter = (typeof ROLES)[number]["key"];
type PlanFilter = (typeof PLANS)[number];

type DisplayUser = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  role: "PLAYER" | "VENUE_OWNER" | "ADMIN";
  avatarUrl?: string | null;
  phoneNumber?: string | null;
  deletedAt?: string | null;
  stripeConnected?: boolean;
  subscription?: OwnerSubscription;
};

function formatDate(value: string | null | undefined, includeTime = false): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", includeTime
    ? { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { day: "numeric", month: "short", year: "numeric" });
}

function initials(name: string): string {
  return name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(/^HTTP \d+ [^:]*:\s*/, "")
    : "Something went wrong. Please try again.";
}

function Avatar({ user, colors }: { user: DisplayUser; colors: ReturnType<typeof useColors> }) {
  if (user.avatarUrl) return <Image source={{ uri: user.avatarUrl }} style={styles.avatar} />;
  return (
    <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: colors.primary + "20" }]}>
      <Text style={[styles.avatarText, { color: colors.primary }]}>{initials(user.name)}</Text>
    </View>
  );
}

function Chip({
  label,
  active,
  onPress,
  testID,
  colors,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  testID: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      style={[styles.chip, {
        backgroundColor: active ? colors.primary : colors.card,
        borderColor: active ? colors.primary : colors.border,
      }]}
    >
      <Text style={[styles.chipText, { color: active ? colors.primaryForeground : colors.mutedForeground }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function UserCard({
  user,
  onPress,
  colors,
}: {
  user: DisplayUser;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const plan = user.subscription?.effectivePlan;
  return (
    <TouchableOpacity
      testID={`admin-user-${user.id}`}
      activeOpacity={0.74}
      onPress={onPress}
      style={[styles.card, { backgroundColor: colors.card, borderColor: user.deletedAt ? colors.destructive + "50" : colors.border }]}
    >
      <Avatar user={user} colors={colors} />
      <View style={styles.cardBody}>
        <View style={styles.titleRow}>
          <Text numberOfLines={1} style={[styles.userName, { color: colors.foreground }]}>{user.name}</Text>
          <View style={[styles.badge, { backgroundColor: (user.role === "VENUE_OWNER" ? colors.info : colors.primary) + "18" }]}>
            <Text style={[styles.badgeText, { color: user.role === "VENUE_OWNER" ? colors.info : colors.primary }]}>
              {user.role === "VENUE_OWNER" ? "Owner" : user.role === "PLAYER" ? "Player" : "Admin"}
            </Text>
          </View>
          {plan && (
            <View style={[styles.badge, { backgroundColor: colors.primary + "18" }]}>
              <Text style={[styles.badgeText, { color: colors.primary }]}>{plan}</Text>
            </View>
          )}
        </View>
        <Text numberOfLines={1} style={[styles.meta, { color: colors.mutedForeground }]}>{user.email}</Text>
        <Text style={[styles.metaSmall, { color: colors.mutedForeground }]}>Joined {formatDate(user.createdAt)}</Text>
      </View>
      <FeatherIcons name="chevron-right" size={18} color={colors.mutedForeground} />
    </TouchableOpacity>
  );
}

function DetailRow({ label, value, colors }: { label: string; value: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={styles.detailRow}>
      <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text selectable style={[styles.detailValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

function OwnerSubscriptionPanel({
  user,
  colors,
}: {
  user: DisplayUser;
  colors: ReturnType<typeof useColors>;
}) {
  const queryClient = useQueryClient();
  const detail = useGetOwnerSubscriptionAdmin(user.id);
  const [overridePlan, setOverridePlan] = useState<SubscriptionPlan>("PRO");
  const [reason, setReason] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const invalidate = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getAdminListUsersQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetOwnerSubscriptionAdminQueryKey(user.id) }),
      queryClient.invalidateQueries({
        predicate: (query) => String(query.queryKey[0]).startsWith("/api/admin/subscriptions/owners"),
      }),
    ]);
  }, [queryClient, user.id]);

  const mutation = useSetOwnerSubscriptionOverride({
    mutation: {
      onSuccess: async (_data, variables) => {
        setFormError(null);
        setSuccess(variables.data.plan ? `${variables.data.plan} override saved.` : "Override removed.");
        setReason("");
        await invalidate();
      },
      onError: (error) => {
        setSuccess(null);
        setFormError(errorMessage(error));
      },
    },
  });

  const parseDate = (value: string, endOfDay = false): string | null => {
    if (!value.trim()) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return "";
    const iso = `${value.trim()}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`;
    return Number.isNaN(new Date(iso).getTime()) ? "" : iso;
  };

  const submit = (plan: SubscriptionPlan | null) => {
    const cleanReason = reason.trim();
    if (!cleanReason) {
      setFormError("A reason is required for every override change.");
      return;
    }
    const start = parseDate(startsAt);
    const end = parseDate(endsAt, true);
    if (start === "" || end === "") {
      setFormError("Use YYYY-MM-DD for effective dates.");
      return;
    }
    if (start && end && new Date(end) <= new Date(start)) {
      setFormError("The end date must be after the start date.");
      return;
    }
    const timing = start ? `starting ${formatDate(start)}` : "immediately";
    Alert.alert(
      plan ? `Apply ${plan} override?` : "Remove plan override?",
      `${plan ? `This changes effective access ${timing}.` : "The owner's provider plan will become effective immediately."}\n\nReason: ${cleanReason}`,
      [
        { text: "Back", style: "cancel" },
        {
          text: "Confirm",
          style: plan ? "default" : "destructive",
          onPress: () => mutation.mutate({
            ownerId: user.id,
            data: {
              plan,
              reason: cleanReason,
              startsAt: plan ? start : null,
              endsAt: plan ? end : null,
            },
          }),
        },
      ],
    );
  };

  if (detail.isLoading) return <ActivityIndicator color={colors.primary} style={{ marginVertical: 24 }} />;
  if (!detail.data) {
    return (
      <View style={[styles.messageBox, { backgroundColor: colors.destructive + "15" }]}>
        <Text style={[styles.messageText, { color: colors.destructive }]}>Subscription details could not be loaded.</Text>
        <TouchableOpacity testID="admin-subscription-retry" onPress={() => detail.refetch()}>
          <Text style={[styles.retryText, { color: colors.primary }]}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const subscription = detail.data.owner.subscription;
  return (
    <>
      <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>SUBSCRIPTION</Text>
      <View style={[styles.subscriptionCard, { backgroundColor: colors.muted }]}>
        <DetailRow label="Provider plan" value={subscription.plan} colors={colors} />
        <DetailRow label="Effective plan" value={subscription.effectivePlan} colors={colors} />
        <DetailRow label="Status" value={subscription.status.replace(/_/g, " ")} colors={colors} />
        <DetailRow label="Period" value={subscription.currentPeriodEnd ? `${formatDate(subscription.currentPeriodStart)} – ${formatDate(subscription.currentPeriodEnd)}` : "No paid period"} colors={colors} />
        <DetailRow label="Cancels at period end" value={subscription.cancelAtPeriodEnd ? "Yes" : "No"} colors={colors} />
        <DetailRow label="Billing configured" value={subscription.billingConfigured ? "Yes" : "No"} colors={colors} />
        <DetailRow label="Override" value={subscription.overridePlan ?? "None"} colors={colors} />
        {subscription.overrideReason && <DetailRow label="Override reason" value={subscription.overrideReason} colors={colors} />}
        {subscription.overrideStartsAt && <DetailRow label="Override starts" value={formatDate(subscription.overrideStartsAt, true)} colors={colors} />}
        {subscription.overrideEndsAt && <DetailRow label="Override ends" value={formatDate(subscription.overrideEndsAt, true)} colors={colors} />}
      </View>

      <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>MANAGE OVERRIDE</Text>
      <Text style={[styles.helper, { color: colors.mutedForeground }]}>Overrides take precedence over provider billing. Leave dates blank to start now or continue indefinitely.</Text>
      <View style={styles.overridePlans}>
        {(["FREE", "PRO", "ELITE"] as SubscriptionPlan[]).map((plan) => (
          <Chip key={plan} testID={`override-plan-${plan.toLowerCase()}`} label={plan[0] + plan.slice(1).toLowerCase()} active={overridePlan === plan} onPress={() => setOverridePlan(plan)} colors={colors} />
        ))}
      </View>
      <TextInput
        testID="override-reason"
        value={reason}
        onChangeText={setReason}
        placeholder="Required reason"
        placeholderTextColor={colors.mutedForeground}
        multiline
        maxLength={1000}
        style={[styles.reasonInput, { color: colors.foreground, backgroundColor: colors.background, borderColor: formError && !reason.trim() ? colors.destructive : colors.border }]}
      />
      <View style={styles.dateRow}>
        <View style={styles.dateField}>
          <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>Starts (optional)</Text>
          <TextInput testID="override-starts" value={startsAt} onChangeText={setStartsAt} placeholder="YYYY-MM-DD" placeholderTextColor={colors.mutedForeground} autoCapitalize="none" style={[styles.dateInput, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]} />
        </View>
        <View style={styles.dateField}>
          <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>Ends (optional)</Text>
          <TextInput testID="override-ends" value={endsAt} onChangeText={setEndsAt} placeholder="YYYY-MM-DD" placeholderTextColor={colors.mutedForeground} autoCapitalize="none" style={[styles.dateInput, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]} />
        </View>
      </View>
      {formError && <Text testID="override-error" style={[styles.formFeedback, { color: colors.destructive }]}>{formError}</Text>}
      {success && <Text testID="override-success" style={[styles.formFeedback, { color: colors.success }]}>{success}</Text>}
      <View style={styles.actionRow}>
        {subscription.overridePlan && (
          <TouchableOpacity testID="override-remove" disabled={mutation.isPending} onPress={() => submit(null)} style={[styles.removeButton, { borderColor: colors.destructive }]}>
            <Text style={[styles.actionText, { color: colors.destructive }]}>Remove override</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity testID="override-apply" disabled={mutation.isPending} onPress={() => submit(overridePlan)} style={[styles.applyButton, { backgroundColor: colors.primary }]}>
          {mutation.isPending ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[styles.actionText, { color: colors.primaryForeground }]}>Review & apply</Text>}
        </TouchableOpacity>
      </View>

      <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>SUBSCRIPTION AUDIT HISTORY</Text>
      {detail.data.events.length === 0 ? (
        <Text style={[styles.helper, { color: colors.mutedForeground }]}>No subscription events recorded.</Text>
      ) : detail.data.events.map((event) => (
        <View key={event.id} style={[styles.event, { borderColor: colors.border }]}>
          <View style={styles.eventTop}>
            <Text style={[styles.eventType, { color: colors.foreground }]}>{event.eventType.replace(/_/g, " ")}</Text>
            <Text style={[styles.eventDate, { color: colors.mutedForeground }]}>{formatDate(event.occurredAt, true)}</Text>
          </View>
          {event.reason && <Text style={[styles.eventReason, { color: colors.mutedForeground }]}>{event.reason}</Text>}
          {event.actorUserId && <Text style={[styles.eventMeta, { color: colors.mutedForeground }]}>Actor: {event.actorUserId}</Text>}
          {(event.previousValue || event.newValue) && (
            <Text selectable style={[styles.eventMeta, { color: colors.mutedForeground }]}>
              {event.previousValue ? `From ${JSON.stringify(event.previousValue)}` : "Created"}
              {event.newValue ? ` → ${JSON.stringify(event.newValue)}` : ""}
            </Text>
          )}
        </View>
      ))}
    </>
  );
}

function UserDetailModal({
  user,
  onClose,
  colors,
  insets,
}: {
  user: DisplayUser | null;
  onClose: () => void;
  colors: ReturnType<typeof useColors>;
  insets: ReturnType<typeof useSafeAreaInsets>;
}) {
  const { width, height } = useWindowDimensions();
  if (!user) return null;
  const wide = width >= 700;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.overlay, { backgroundColor: colors.foreground + "70" }]}>
        <TouchableOpacity testID="admin-user-detail-backdrop" style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, {
          backgroundColor: colors.card,
          maxHeight: wide ? height - 80 : height * 0.92,
          width: wide ? 680 : "100%",
          alignSelf: "center",
          paddingBottom: Math.max(insets.bottom, Platform.OS === "web" ? 34 : 12),
        }]}>
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <View style={styles.modalHeader}>
            <Avatar user={user} colors={colors} />
            <View style={styles.modalTitle}>
              <Text style={[styles.modalName, { color: colors.foreground }]}>{user.name}</Text>
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>{user.email}</Text>
            </View>
            <TouchableOpacity testID="admin-user-detail-close" onPress={onClose} style={styles.close}>
              <FeatherIcons name="x" size={22} color={colors.foreground} />
            </TouchableOpacity>
          </View>
          <KeyboardAwareScrollViewCompat
            bottomOffset={60}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.modalContent}
          >
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>ACCOUNT</Text>
            <DetailRow label="User ID" value={user.id} colors={colors} />
            <DetailRow label="Role" value={user.role.replace(/_/g, " ")} colors={colors} />
            <DetailRow label="Phone" value={user.phoneNumber ?? "Not provided"} colors={colors} />
            <DetailRow label="Joined" value={formatDate(user.createdAt)} colors={colors} />
            <DetailRow label="Account status" value={user.deletedAt ? `Deleted ${formatDate(user.deletedAt)}` : "Active"} colors={colors} />
            {user.role === "VENUE_OWNER" && <OwnerSubscriptionPanel user={user} colors={colors} />}
             {user.role === "PLAYER" && !user.deletedAt && <AdminLeaderboardSources key={user.id} playerId={user.id} onNavigate={onClose} />}
          </KeyboardAwareScrollViewCompat>
        </View>
      </View>
    </Modal>
  );
}

const PAGE_LIMIT = 50;

export default function AdminUsersScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<RoleFilter>("ALL");
  const [plan, setPlan] = useState<PlanFilter>("ALL");
  const [page, setPage] = useState(1);
  const [allUsers, setAllUsers] = useState<AdminUserRecord[]>([]);
  const [selected, setSelected] = useState<DisplayUser | null>(null);

  const params = useMemo(() => ({
    ...(search.trim() && plan === "ALL" ? { search: search.trim() } : {}),
    ...(role !== "ALL" ? { role } : {}),
    page,
    limit: PAGE_LIMIT,
  }), [search, role, page, plan]);

  const usersQuery = useAdminListUsers(params);
  const subscriptionsQuery = useListOwnerSubscriptions(plan === "ALL" ? undefined : { plan });

  React.useEffect(() => {
    if (!usersQuery.data?.users) return;
    if (page === 1) setAllUsers(usersQuery.data.users);
    else setAllUsers((previous) => {
      const ids = new Set(previous.map((item) => item.id));
      return [...previous, ...usersQuery.data.users.filter((item) => !ids.has(item.id))];
    });
  }, [usersQuery.data, page]);

  const subscriptionMap = useMemo(() => new Map(
    (subscriptionsQuery.data?.owners ?? []).map((owner) => [owner.id, owner.subscription]),
  ), [subscriptionsQuery.data]);

  const rows = useMemo<DisplayUser[]>(() => {
    if (plan !== "ALL") {
      const term = search.trim().toLowerCase();
      return (subscriptionsQuery.data?.owners ?? [])
        .filter((owner) => !term || owner.name.toLowerCase().includes(term) || owner.email.toLowerCase().includes(term))
        .map((owner: OwnerSubscriptionSummary) => ({ ...owner, role: "VENUE_OWNER", subscription: owner.subscription }));
    }
    return allUsers.map((user) => ({ ...user, subscription: subscriptionMap.get(user.id) }));
  }, [plan, search, subscriptionsQuery.data, allUsers, subscriptionMap]);

  const loading = plan === "ALL" ? usersQuery.isLoading : subscriptionsQuery.isLoading;
  const refreshing = plan === "ALL" ? usersQuery.isRefetching : subscriptionsQuery.isRefetching;
  const listError = plan === "ALL" ? usersQuery.error : subscriptionsQuery.error;
  const total = plan === "ALL" ? (usersQuery.data?.total ?? 0) : rows.length;
  const hasMore = plan === "ALL" && allUsers.length < total;

  const changeRole = (next: RoleFilter) => {
    setRole(next);
    setPlan("ALL");
    setPage(1);
    setAllUsers([]);
  };
  const changePlan = (next: PlanFilter) => {
    setPlan(next);
    if (next !== "ALL") setRole("VENUE_OWNER");
    setPage(1);
    setAllUsers([]);
  };
  const refresh = () => {
    setPage(1);
    if (plan === "ALL") {
      setAllUsers([]);
      usersQuery.refetch();
    } else subscriptionsQuery.refetch();
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.filters, { borderBottomColor: colors.border }]}>
        <View style={[styles.search, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <FeatherIcons name="search" size={17} color={colors.mutedForeground} />
          <TextInput testID="admin-users-search" value={search} onChangeText={(text) => { setSearch(text); setPage(1); }} placeholder="Name, email, or phone…" placeholderTextColor={colors.mutedForeground} autoCapitalize="none" autoCorrect={false} style={[styles.searchInput, { color: colors.foreground }]} />
          {!!search && <TouchableOpacity testID="admin-users-search-clear" onPress={() => setSearch("")}><FeatherIcons name="x" size={17} color={colors.mutedForeground} /></TouchableOpacity>}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {ROLES.map((item) => <Chip key={item.key} testID={`role-filter-${item.key.toLowerCase()}`} label={item.label} active={role === item.key && plan === "ALL"} onPress={() => changeRole(item.key)} colors={colors} />)}
        </ScrollView>
        {(role === "VENUE_OWNER" || plan !== "ALL") && (
          <View>
            <Text style={[styles.filterLabel, { color: colors.mutedForeground }]}>OWNER PLAN</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {PLANS.map((item) => <Chip key={item} testID={`plan-filter-${item.toLowerCase()}`} label={item === "ALL" ? "All plans" : item[0] + item.slice(1).toLowerCase()} active={plan === item} onPress={() => changePlan(item)} colors={colors} />)}
            </ScrollView>
          </View>
        )}
      </View>
      <View style={styles.countRow}>
        <Text style={[styles.count, { color: colors.mutedForeground }]}>{loading ? "Loading…" : `${total} ${plan === "ALL" ? "user" : "owner"}${total === 1 ? "" : "s"}`}</Text>
        {(search || role !== "ALL" || plan !== "ALL") && <TouchableOpacity testID="admin-users-clear-filters" onPress={() => { setSearch(""); changeRole("ALL"); }}><Text style={[styles.clear, { color: colors.destructive }]}>Clear filters</Text></TouchableOpacity>}
      </View>
      {listError && rows.length === 0 ? (
        <View style={styles.center}>
          <FeatherIcons name="alert-circle" size={34} color={colors.destructive} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Users could not be loaded</Text>
          <Text style={[styles.emptyText, { color: colors.destructive }]}>{errorMessage(listError)}</Text>
          <TouchableOpacity testID="admin-users-retry" onPress={refresh}>
            <Text style={[styles.retryText, { color: colors.primary }]}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : loading && rows.length === 0 ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : rows.length === 0 ? (
        <View style={styles.center}>
          <FeatherIcons name="users" size={34} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No users found</Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Try adjusting your search or filters.</Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
          refreshControl={<RefreshControl refreshing={refreshing && page === 1} onRefresh={refresh} tintColor={colors.primary} />}
          onEndReached={() => { if (hasMore && !refreshing && !usersQuery.isLoading) setPage((value) => value + 1); }}
          onEndReachedThreshold={0.3}
          ListFooterComponent={page > 1 && (usersQuery.isLoading || usersQuery.isRefetching) ? <ActivityIndicator color={colors.primary} style={{ margin: 16 }} /> : null}
          renderItem={({ item }) => <UserCard user={item} colors={colors} onPress={() => setSelected(item)} />}
        />
      )}
      <UserDetailModal user={selected} onClose={() => setSelected(null)} colors={colors} insets={insets} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 10 },
  filters: { paddingHorizontal: 16, paddingVertical: 11, gap: 10, borderBottomWidth: 1 },
  search: { height: 43, borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "PlusJakartaSans_400Regular" },
  chips: { gap: 8 },
  chip: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 13, paddingVertical: 7 },
  chipText: { fontSize: 12, fontFamily: "PlusJakartaSans_600SemiBold" },
  filterLabel: { fontSize: 10, letterSpacing: 0.8, marginBottom: 7, fontFamily: "PlusJakartaSans_700Bold" },
  countRow: { minHeight: 36, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  count: { fontSize: 12, fontFamily: "PlusJakartaSans_400Regular" },
  clear: { fontSize: 12, fontFamily: "PlusJakartaSans_600SemiBold" },
  list: { paddingHorizontal: 16, paddingTop: 3 },
  card: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 13, padding: 13, marginBottom: 9 },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarFallback: { alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 15, fontFamily: "PlusJakartaSans_700Bold" },
  cardBody: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  userName: { flexShrink: 1, fontSize: 14, fontFamily: "PlusJakartaSans_600SemiBold" },
  badge: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 9, fontFamily: "PlusJakartaSans_700Bold" },
  meta: { fontSize: 12, marginTop: 2, fontFamily: "PlusJakartaSans_400Regular" },
  metaSmall: { fontSize: 10, marginTop: 4, fontFamily: "PlusJakartaSans_400Regular" },
  emptyTitle: { fontSize: 16, fontFamily: "PlusJakartaSans_600SemiBold" },
  emptyText: { fontSize: 13, textAlign: "center", fontFamily: "PlusJakartaSans_400Regular" },
  overlay: { flex: 1, justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: "hidden" },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginTop: 9 },
  modalHeader: { flexDirection: "row", alignItems: "center", padding: 16, gap: 12 },
  modalTitle: { flex: 1 },
  modalName: { fontSize: 18, fontFamily: "PlusJakartaSans_700Bold" },
  close: { padding: 6 },
  modalContent: { paddingHorizontal: 18, paddingBottom: 24 },
  sectionTitle: { fontSize: 10, letterSpacing: 0.8, marginTop: 18, marginBottom: 10, fontFamily: "PlusJakartaSans_700Bold" },
  detailRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 15, marginBottom: 8 },
  detailLabel: { flex: 1, fontSize: 12, fontFamily: "PlusJakartaSans_400Regular" },
  detailValue: { flex: 1.7, textAlign: "right", fontSize: 12, fontFamily: "PlusJakartaSans_600SemiBold" },
  subscriptionCard: { borderRadius: 12, padding: 12 },
  helper: { fontSize: 12, lineHeight: 18, marginBottom: 10, fontFamily: "PlusJakartaSans_400Regular" },
  overridePlans: { flexDirection: "row", gap: 7, marginBottom: 10 },
  reasonInput: { minHeight: 72, borderWidth: 1, borderRadius: 10, padding: 11, textAlignVertical: "top", fontSize: 13, fontFamily: "PlusJakartaSans_400Regular" },
  dateRow: { flexDirection: "row", gap: 10, marginTop: 10 },
  dateField: { flex: 1 },
  inputLabel: { fontSize: 10, marginBottom: 5, fontFamily: "PlusJakartaSans_600SemiBold" },
  dateInput: { height: 42, borderWidth: 1, borderRadius: 9, paddingHorizontal: 10, fontSize: 12, fontFamily: "PlusJakartaSans_400Regular" },
  formFeedback: { fontSize: 12, lineHeight: 18, marginTop: 9, fontFamily: "PlusJakartaSans_600SemiBold" },
  actionRow: { flexDirection: "row", justifyContent: "flex-end", gap: 9, marginTop: 12 },
  removeButton: { minHeight: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 13, alignItems: "center", justifyContent: "center" },
  applyButton: { minHeight: 44, borderRadius: 10, paddingHorizontal: 15, alignItems: "center", justifyContent: "center", flex: 1 },
  actionText: { fontSize: 12, fontFamily: "PlusJakartaSans_700Bold" },
  event: { borderTopWidth: 1, paddingVertical: 11 },
  eventTop: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
  eventType: { flex: 1, fontSize: 12, fontFamily: "PlusJakartaSans_700Bold" },
  eventDate: { fontSize: 10, fontFamily: "PlusJakartaSans_400Regular" },
  eventReason: { fontSize: 12, lineHeight: 17, marginTop: 4, fontFamily: "PlusJakartaSans_400Regular" },
  eventMeta: { fontSize: 10, lineHeight: 15, marginTop: 4, fontFamily: "PlusJakartaSans_400Regular" },
  messageBox: { borderRadius: 10, padding: 12, marginTop: 14 },
  messageText: { fontSize: 12, fontFamily: "PlusJakartaSans_500Medium" },
  retryText: { fontSize: 12, marginTop: 7, fontFamily: "PlusJakartaSans_700Bold" },
});