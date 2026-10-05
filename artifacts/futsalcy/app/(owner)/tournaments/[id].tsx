import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import FeatherIcons from "@/components/FeatherIcons";
import {
  useGetOwnerTournament,
  usePublishTournament,
  useCloseTournamentRegistration,
  useGenerateTournamentBracket,
  useCancelTournament,
  useRetryTournamentRefunds,
  useRecordTournamentResult,
  useDeleteTournament,
  useScheduleTournamentMatch,
  getGetOwnerTournamentQueryKey,
  getListOwnerTournamentsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Platform } from "react-native";

export default function OwnerTournamentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"overview" | "bracket" | "players">("overview");

  const { data, isLoading } = useGetOwnerTournament(id as string, {
    query: { enabled: !!id, queryKey: getGetOwnerTournamentQueryKey(id as string) },
  });

  const publishMut = usePublishTournament();
  const closeRegMut = useCloseTournamentRegistration();
  const generateBracketMut = useGenerateTournamentBracket();
  const cancelMut = useCancelTournament();
  const retryRefundMut = useRetryTournamentRefunds();
  const recordResultMut = useRecordTournamentResult();
  const deleteMut = useDeleteTournament();
  const scheduleMut = useScheduleTournamentMatch();

  // Modal states
  const [cancelModalVisible, setCancelModalVisible] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const [recordModalVisible, setRecordModalVisible] = useState(false);
  const [recordMatchId, setRecordMatchId] = useState("");
  const [winnerId, setWinnerId] = useState("");
  const [scoreOne, setScoreOne] = useState("0");
  const [scoreTwo, setScoreTwo] = useState("0");

  const [scheduleModalVisible, setScheduleModalVisible] = useState(false);
  const [scheduleMatchId, setScheduleMatchId] = useState("");
  const [matchStart, setMatchStart] = useState(new Date());
  const [matchEnd, setMatchEnd] = useState(new Date(Date.now() + 3600000));
  const [showDatePicker, setShowDatePicker] = useState<"start" | "end" | null>(null);

  if (isLoading || !data) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const { tournament, registrations, matches } = data;
  const pendingRefunds = registrations.filter((registration) => registration.paymentStatus === "REFUND_PENDING").length;
  const participantLabel = (registrationId: string | null) => {
    if (!registrationId) return "TBD";
    const registration = registrations.find((item) => item.id === registrationId);
    return registration?.teamName || registration?.participantName || "Participant";
  };
  const resultMatch = matches.find((match) => match.id === recordMatchId);

  const handleAction = (action: string) => {
    const opts = {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetOwnerTournamentQueryKey(id!) }),
      onError: (err: any) => Alert.alert("Error", err.message),
    };

    if (action === "publish") publishMut.mutate({ id: id! }, opts);
    if (action === "close") closeRegMut.mutate({ id: id! }, opts);
    if (action === "generate") generateBracketMut.mutate({ id: id! }, opts);
    if (action === "delete") {
      Alert.alert("Delete Tournament", "Are you sure you want to delete this draft?", [
        { text: "Keep", style: "cancel" },
        { 
          text: "Delete", 
          style: "destructive", 
          onPress: () => deleteMut.mutate(
            { id: id! },
            {
              onSuccess: () => {
                queryClient.invalidateQueries({ queryKey: getListOwnerTournamentsQueryKey() });
                router.replace("/owner/tournaments" as any);
              },
              onError: opts.onError,
            }
          ) 
        }
      ]);
    }
  };

  const submitCancel = () => {
    cancelMut.mutate(
      { id: id!, data: { reason: cancelReason || "Cancelled" } },
      {
        onSuccess: () => {
          setCancelModalVisible(false);
          queryClient.invalidateQueries({ queryKey: getGetOwnerTournamentQueryKey(id!) });
        },
        onError: (err: any) => Alert.alert("Error", err.message),
      }
    );
  };

  const submitResult = () => {
    if (!winnerId) return Alert.alert("Error", "Please enter a winner ID.");
    const homeScore = Number(scoreOne);
    const awayScore = Number(scoreTwo);
    if (!Number.isInteger(homeScore) || homeScore < 0 || !Number.isInteger(awayScore) || awayScore < 0) {
      return Alert.alert("Error", "Enter two whole-number scores.");
    }
    recordResultMut.mutate(
      { id: id!, matchId: recordMatchId, data: { winnerRegistrationId: winnerId, score: { participantOne: homeScore, participantTwo: awayScore } } },
      {
        onSuccess: () => {
          setRecordModalVisible(false);
          setWinnerId("");
          setScoreOne("0");
          setScoreTwo("0");
          queryClient.invalidateQueries({ queryKey: getGetOwnerTournamentQueryKey(id!) });
        },
        onError: (err: any) => Alert.alert("Error", err.message),
      }
    );
  };

  const retryRefunds = () => {
    retryRefundMut.mutate(
      { id: id! },
      {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetOwnerTournamentQueryKey(id!) }),
        onError: (err: any) => Alert.alert("Unable to retry refunds", err.message),
      },
    );
  };

  const submitSchedule = () => {
    scheduleMut.mutate(
      { id: id!, matchId: scheduleMatchId, data: { startAt: matchStart.toISOString(), endAt: matchEnd.toISOString() } },
      {
        onSuccess: () => {
          setScheduleModalVisible(false);
          queryClient.invalidateQueries({ queryKey: getGetOwnerTournamentQueryKey(id!) });
        },
        onError: (err: any) => Alert.alert("Error", err.message),
      }
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Text style={[styles.title, { color: colors.foreground }]}>{tournament.name}</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          {tournament.status} • {tournament.confirmedRegistrations}/{tournament.capacity} {tournament.entryType}S
        </Text>
      </View>

      <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border }}>
        {(["overview", "bracket", "players"] as const).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, activeTab === t && { borderBottomWidth: 2, borderBottomColor: colors.primary }]}
            onPress={() => setActiveTab(t)}
          >
            <Text
              style={[
                styles.tabText,
                { color: activeTab === t ? colors.primary : colors.mutedForeground },
              ]}
            >
              {t.toUpperCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {activeTab === "overview" && (
          <View style={{ gap: 16 }}>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Details</Text>
              <Text style={{ color: colors.mutedForeground, marginTop: 8 }}>
                Starts: {new Date(tournament.startsAt).toLocaleString()}
              </Text>
              <Text style={{ color: colors.mutedForeground }}>
                Fee: {tournament.entryFeeAmount} {tournament.currency} • Prize: {tournament.prizePoolAmount}
              </Text>
            </View>

            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 12 }]}>Actions</Text>
              {pendingRefunds > 0 && (
                <View style={{ marginBottom: 12 }}>
                  <Text style={{ color: colors.destructive, fontSize: 13, marginBottom: 8 }}>
                    {pendingRefunds} refund{pendingRefunds === 1 ? "" : "s"} still need reconciliation.
                  </Text>
                  <TouchableOpacity
                    accessibilityRole="button"
                    style={[styles.actionBtn, { backgroundColor: colors.destructive }]}
                    onPress={retryRefunds}
                    disabled={retryRefundMut.isPending}
                  >
                    <Text style={[styles.actionText, { color: colors.destructiveForeground }]}>
                      {retryRefundMut.isPending ? "Retrying refunds…" : "Retry pending refunds"}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
              {(tournament.status === "DRAFT" || tournament.status === "PUBLISHED") && (
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: colors.secondary, marginBottom: 8 }]}
                  onPress={() => router.push(`/owner/tournaments/edit?id=${id}` as any)}
                >
                  <Text style={[styles.actionText, { color: colors.secondaryForeground }]}>Edit Tournament</Text>
                </TouchableOpacity>
              )}
              {tournament.status === "DRAFT" && (
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: colors.primary, marginBottom: 8 }]}
                  onPress={() => handleAction("publish")}
                >
                  <Text style={[styles.actionText, { color: colors.primaryForeground }]}>Publish Tournament</Text>
                </TouchableOpacity>
              )}
              {tournament.status === "DRAFT" && (
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: colors.destructive, marginBottom: 8 }]}
                  onPress={() => handleAction("delete")}
                >
                  <Text style={[styles.actionText, { color: colors.destructiveForeground }]}>Delete Draft</Text>
                </TouchableOpacity>
              )}
              {tournament.status === "PUBLISHED" && (
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: colors.primary }]}
                  onPress={() => handleAction("close")}
                >
                  <Text style={[styles.actionText, { color: colors.primaryForeground }]}>Close Registration</Text>
                </TouchableOpacity>
              )}
              {["DRAFT", "PUBLISHED", "REGISTRATION_CLOSED"].includes(tournament.status) && (
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: colors.destructive, marginTop: 8 }]}
                  onPress={() => setCancelModalVisible(true)}
                >
                  <Text style={[styles.actionText, { color: colors.destructiveForeground }]}>Cancel Tournament</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {activeTab === "bracket" && (
          <View>
            {matches.length === 0 ? (
              <View style={styles.center}>
                <Text style={{ color: colors.mutedForeground, marginBottom: 16 }}>No bracket generated yet.</Text>
                {tournament.status === "REGISTRATION_CLOSED" && (
                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: colors.primary, paddingHorizontal: 24 }]}
                    onPress={() => handleAction("generate")}
                  >
                    <Text style={[styles.actionText, { color: colors.primaryForeground }]}>Generate Bracket</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              matches.map((m) => (
                <View key={m.id} style={[styles.matchCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={{ color: colors.mutedForeground, fontSize: 12, marginBottom: 8 }}>
                    Round {m.roundNumber} - Match {m.matchNumber} ({m.status})
                  </Text>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
                    <Text style={{ color: colors.foreground }}>{participantLabel(m.participantOneRegistrationId ?? null)}</Text>
                    <Text style={{ color: colors.mutedForeground }}>vs</Text>
                    <Text style={{ color: colors.foreground }}>{participantLabel(m.participantTwoRegistrationId ?? null)}</Text>
                  </View>
                  {m.startAt && (
                    <Text style={{ color: colors.mutedForeground, fontSize: 12, marginBottom: 8 }}>
                      Scheduled: {new Date(m.startAt).toLocaleString()}
                    </Text>
                  )}
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {m.status === "PENDING" || m.status === "READY" ? (
                      <TouchableOpacity
                        style={{ paddingVertical: 6, paddingHorizontal: 12, backgroundColor: colors.secondary, borderRadius: 6 }}
                        onPress={() => {
                          setScheduleMatchId(m.id);
                          setMatchStart(m.startAt ? new Date(m.startAt) : new Date());
                          setMatchEnd(m.endAt ? new Date(m.endAt) : new Date(Date.now() + 3600000));
                          setScheduleModalVisible(true);
                        }}
                      >
                        <Text style={{ color: colors.secondaryForeground, fontFamily: "PlusJakartaSans_600SemiBold", fontSize: 13 }}>Schedule</Text>
                      </TouchableOpacity>
                    ) : null}
                    
                    {m.status === "READY" && m.participantOneRegistrationId && m.participantTwoRegistrationId && (
                      <TouchableOpacity
                        style={{ paddingVertical: 6, paddingHorizontal: 12, backgroundColor: colors.primary + "1A", borderRadius: 6 }}
                        onPress={() => {
                          setRecordMatchId(m.id);
                          setWinnerId(m.participantOneRegistrationId ?? "");
                          setScoreOne("0");
                          setScoreTwo("0");
                          setRecordModalVisible(true);
                        }}
                      >
                        <Text style={{ color: colors.primary, fontFamily: "PlusJakartaSans_600SemiBold", fontSize: 13 }}>Record Result</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  {m.winnerRegistrationId && (
                    <View style={{ marginTop: 8 }}>
                      <Text style={{ color: colors.success, fontSize: 12, fontFamily: "PlusJakartaSans_600SemiBold" }}>
                        Winner: {participantLabel(m.winnerRegistrationId)}
                      </Text>
                    </View>
                  )}
                </View>
              ))
            )}
          </View>
        )}

        {activeTab === "players" && (
          <View>
            {registrations.length === 0 ? (
              <Text style={{ color: colors.mutedForeground, textAlign: "center", marginTop: 24 }}>
                No registrations yet.
              </Text>
            ) : (
              registrations.map((r) => (
                <View key={r.id} style={[styles.regCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={{ color: colors.foreground, fontFamily: "PlusJakartaSans_600SemiBold" }}>
                    {r.teamName || r.participantName || "Participant"}
                  </Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                    Status: {r.status}
                  </Text>
                </View>
              ))
            )}
          </View>
        )}
      </ScrollView>

      {/* Cancel Modal */}
      <Modal transparent visible={cancelModalVisible} animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 12 }]}>Cancel Tournament</Text>
            <Text style={{ color: colors.mutedForeground, marginBottom: 8, fontSize: 13 }}>Please provide a reason for cancellation:</Text>
            <TextInput
              style={[styles.input, { borderColor: colors.border, color: colors.foreground }]}
              value={cancelReason}
              onChangeText={setCancelReason}
              placeholder="e.g. Weather conditions"
              placeholderTextColor={colors.mutedForeground}
            />
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 8 }}>
              <TouchableOpacity onPress={() => setCancelModalVisible(false)} style={{ padding: 12 }}>
                <Text style={{ color: colors.mutedForeground, fontFamily: "PlusJakartaSans_600SemiBold" }}>Keep</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={submitCancel} style={{ padding: 12, backgroundColor: colors.destructive, borderRadius: 8 }}>
                <Text style={{ color: colors.destructiveForeground, fontFamily: "PlusJakartaSans_600SemiBold" }}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Record Result Modal */}
      <Modal transparent visible={recordModalVisible} animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 12 }]}>Record Winner</Text>
            <Text style={{ color: colors.mutedForeground, marginBottom: 8, fontSize: 13 }}>Select the winner:</Text>
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
              {[resultMatch?.participantOneRegistrationId, resultMatch?.participantTwoRegistrationId].filter(Boolean).map((participantId) => (
                <TouchableOpacity
                  key={participantId}
                  accessibilityRole="button"
                  style={[styles.actionBtn, {
                    flex: 1,
                    backgroundColor: winnerId === participantId ? colors.primary : colors.secondary,
                    paddingVertical: 10,
                  }]}
                  onPress={() => setWinnerId(participantId!)}
                >
                  <Text style={[styles.actionText, {
                    color: winnerId === participantId ? colors.primaryForeground : colors.secondaryForeground,
                    fontSize: 12,
                  }]} numberOfLines={1}>
                    {participantLabel(participantId!)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TextInput
                accessibilityLabel="First participant score"
                style={[styles.input, { flex: 1, borderColor: colors.border, color: colors.foreground }]}
                value={scoreOne}
                onChangeText={setScoreOne}
                keyboardType="number-pad"
                placeholder="First score"
                placeholderTextColor={colors.mutedForeground}
              />
              <TextInput
                accessibilityLabel="Second participant score"
                style={[styles.input, { flex: 1, borderColor: colors.border, color: colors.foreground }]}
                value={scoreTwo}
                onChangeText={setScoreTwo}
                keyboardType="number-pad"
                placeholder="Second score"
                placeholderTextColor={colors.mutedForeground}
              />
            </View>
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 8 }}>
              <TouchableOpacity onPress={() => setRecordModalVisible(false)} style={{ padding: 12 }}>
                <Text style={{ color: colors.mutedForeground, fontFamily: "PlusJakartaSans_600SemiBold" }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={submitResult} style={{ padding: 12, backgroundColor: colors.primary, borderRadius: 8 }}>
                <Text style={{ color: colors.primaryForeground, fontFamily: "PlusJakartaSans_600SemiBold" }}>Save Result</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Schedule Modal */}
      <Modal transparent visible={scheduleModalVisible} animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 12 }]}>Schedule Match</Text>
            
            <Text style={{ color: colors.mutedForeground, fontSize: 13, marginBottom: 4 }}>Start Time</Text>
            <TouchableOpacity style={[styles.input, { borderColor: colors.border }]} onPress={() => setShowDatePicker("start")}>
              <Text style={{ color: colors.foreground }}>{matchStart.toLocaleString()}</Text>
            </TouchableOpacity>

            <Text style={{ color: colors.mutedForeground, fontSize: 13, marginBottom: 4, marginTop: 8 }}>End Time</Text>
            <TouchableOpacity style={[styles.input, { borderColor: colors.border }]} onPress={() => setShowDatePicker("end")}>
              <Text style={{ color: colors.foreground }}>{matchEnd.toLocaleString()}</Text>
            </TouchableOpacity>

            {showDatePicker && (
              <View style={{ marginVertical: 8 }}>
                <DateTimePicker
                  value={showDatePicker === "start" ? matchStart : matchEnd}
                  mode="datetime"
                  display={Platform.OS === "ios" ? "spinner" : "default"}
                  onChange={(e, d) => {
                    if (Platform.OS === "android") setShowDatePicker(null);
                    if (d) {
                      showDatePicker === "start" ? setMatchStart(d) : setMatchEnd(d);
                    }
                  }}
                />
                {Platform.OS === "ios" && (
                  <TouchableOpacity onPress={() => setShowDatePicker(null)} style={{ alignSelf: "flex-end", padding: 8 }}>
                    <Text style={{ color: colors.primary, fontFamily: "PlusJakartaSans_600SemiBold" }}>Done</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 16 }}>
              <TouchableOpacity onPress={() => { setScheduleModalVisible(false); setShowDatePicker(null); }} style={{ padding: 12 }}>
                <Text style={{ color: colors.mutedForeground, fontFamily: "PlusJakartaSans_600SemiBold" }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={submitSchedule} style={{ padding: 12, backgroundColor: colors.primary, borderRadius: 8 }}>
                <Text style={{ color: colors.primaryForeground, fontFamily: "PlusJakartaSans_600SemiBold" }}>Schedule</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  title: { fontSize: 20, fontFamily: "PlusJakartaSans_700Bold" },
  subtitle: { fontSize: 13, fontFamily: "PlusJakartaSans_500Medium", marginTop: 4 },
  tab: { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabText: { fontSize: 12, fontFamily: "PlusJakartaSans_700Bold" },
  card: { padding: 16, borderRadius: 12, borderWidth: 1 },
  sectionTitle: { fontSize: 16, fontFamily: "PlusJakartaSans_700Bold" },
  actionBtn: { paddingVertical: 12, borderRadius: 8, alignItems: "center" },
  actionText: { fontSize: 14, fontFamily: "PlusJakartaSans_700Bold" },
  matchCard: { padding: 12, borderRadius: 8, borderWidth: 1, marginBottom: 8 },
  regCard: { padding: 12, borderRadius: 8, borderWidth: 1, marginBottom: 8 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 16 },
  modalContent: { padding: 24, borderRadius: 12 },
  input: { borderWidth: 1, borderRadius: 8, padding: 12, fontFamily: "PlusJakartaSans_400Regular" },
});
