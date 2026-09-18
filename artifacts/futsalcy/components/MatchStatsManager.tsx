import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import FeatherIcons from "@/components/FeatherIcons";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { useColors } from "@/hooks/useColors";
import type {
  MatchParticipant,
  MatchPlayer,
  MatchStats,
  MatchStatsInput,
} from "@/lib/match-stats-api";

interface Props {
  bookingId: string;
  match: MatchStats | null | undefined;
  availablePlayers: MatchPlayer[];
  isLoading: boolean;
  error?: unknown;
  canManage: boolean;
  lockedReason?: string;
  admin?: boolean;
  isSaving: boolean;
  isDeleting?: boolean;
  onSave: (data: MatchStatsInput) => Promise<unknown>;
  onDelete?: (reason: string) => Promise<unknown>;
  onUpgrade?: () => void;
  queryKeys: string[][];
}

type Draft = {
  homeScore: string;
  awayScore: string;
  participants: MatchParticipant[];
  reason: string;
};

const EMPTY_STATS = {
  goals: 0,
  assists: 0,
  saves: 0,
  yellowCards: 0,
  redCards: 0,
};

function initialDraft(match: MatchStats | null | undefined): Draft {
  return {
    homeScore: match ? String(match.homeScore) : "",
    awayScore: match ? String(match.awayScore) : "",
    participants: match?.participants.map((participant) => ({ ...participant })) ?? [],
    reason: "",
  };
}

function playerName(participant: MatchParticipant, players: MatchPlayer[]): string {
  return participant.playerName ?? participant.player?.name ?? players.find((player) => player.id === participant.playerId)?.name ?? "Player";
}

function summary(participants: MatchParticipant[], team: "HOME" | "AWAY", players: MatchPlayer[]): string {
  const names = participants.filter((item) => item.team === team).map((item) => playerName(item, players));
  return names.length ? names.join(", ") : "No players selected";
}

export default function MatchStatsManager(props: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [editorVisible, setEditorVisible] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => initialDraft(props.match));
  const [editorError, setEditorError] = useState<string | null>(null);
  const [removeVisible, setRemoveVisible] = useState(false);
  const [removeReason, setRemoveReason] = useState("");

  const openEditor = () => {
    setDraft(initialDraft(props.match));
    setEditorError(null);
    setEditorVisible(true);
  };

  const togglePlayer = (player: MatchPlayer) => {
    setEditorError(null);
    setDraft((current) => {
      const selected = current.participants.some((item) => item.playerId === player.id);
      return {
        ...current,
        participants: selected
          ? current.participants.filter((item) => item.playerId !== player.id)
          : [...current.participants, { playerId: player.id, player, team: "HOME", ...EMPTY_STATS }],
      };
    });
  };

  const patchParticipant = (playerId: string, patch: Partial<MatchParticipant>) => {
    setEditorError(null);
    setDraft((current) => ({
      ...current,
      participants: current.participants.map((item) =>
        item.playerId === playerId ? { ...item, ...patch } : item,
      ),
    }));
  };

  const validate = (): MatchStatsInput | null => {
    setEditorError(null);
    if (props.admin && !draft.reason.trim()) {
      setEditorError("A reason is required for every correction.");
      return null;
    }
    const homeScore = Number(draft.homeScore);
    const awayScore = Number(draft.awayScore);
    if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore) || homeScore < 0 || awayScore < 0 || homeScore > 100 || awayScore > 100) {
      const message = "Enter a whole-number score from 0 to 100 for both teams.";
      setEditorError(message);
      Alert.alert("Check the score", message);
      return null;
    }
    if (!draft.participants.some((item) => item.team === "HOME") || !draft.participants.some((item) => item.team === "AWAY")) {
      const message = "Add at least one participant to each team.";
      setEditorError(message);
      Alert.alert("Select both teams", message);
      return null;
    }
    const homeGoals = draft.participants
      .filter((item) => item.team === "HOME")
      .reduce((total, item) => total + item.goals, 0);
    const awayGoals = draft.participants
      .filter((item) => item.team === "AWAY")
      .reduce((total, item) => total + item.goals, 0);
    if (homeGoals !== homeScore || awayGoals !== awayScore) {
      const message = "The goals assigned to each team's players must add up to the final score.";
      setEditorError(message);
      Alert.alert("Check the goal scorers", message);
      return null;
    }
    return {
      ...(props.admin ? { reason: draft.reason.trim() } : {}),
      homeScore,
      awayScore,
      expectedVersion: props.match?.version ?? 0,
      participants: draft.participants.map(({ id, player, playerName: _, ...participant }) => participant),
    };
  };

  const save = async () => {
    const data = validate();
    if (!data) return;
    try {
      await props.onSave(data);
      await invalidateStatistics();
      setEditorVisible(false);
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : "Statistics could not be saved. Please try again.");
      Alert.alert("Statistics not saved", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const remove = async () => {
    if (!props.onDelete || !removeReason.trim()) return;
    try {
      await props.onDelete(removeReason.trim());
      await invalidateStatistics();
      setRemoveVisible(false);
      setRemoveReason("");
    } catch (error) {
      Alert.alert("Statistics not removed", error instanceof Error ? error.message : "Please try again.");
    }
  };

  async function invalidateStatistics() {
    await Promise.all([
      ...props.queryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      queryClient.invalidateQueries({
        predicate: (query) => /leaderboard/i.test(String(query.queryKey[0])),
      }),
    ]);
  }

  return (
    <>
      <View
        testID={props.admin ? "admin-match-stats" : "owner-match-stats"}
        style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      >
        <View style={styles.header}>
          <View style={[styles.icon, { backgroundColor: colors.primary + "18" }]}>
            <FeatherIcons name="activity" size={18} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.foreground }]}>Match statistics</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              {props.admin ? "Inspect and correct the official match record." : "Record the final score and player performance."}
            </Text>
          </View>
          {props.match && (
            <View style={[styles.recordedPill, { backgroundColor: colors.success + "18" }]}>
              <Text style={[styles.pillText, { color: colors.success }]}>RECORDED</Text>
            </View>
          )}
        </View>

        {props.isLoading ? (
          <View style={styles.state}><ActivityIndicator color={colors.primary} /></View>
        ) : props.error ? (
          <View style={styles.state}>
            <FeatherIcons name="alert-circle" size={20} color={colors.destructive} />
            <Text style={[styles.stateText, { color: colors.mutedForeground }]}>Match statistics could not be loaded.</Text>
          </View>
        ) : props.match ? (
          <>
            <View style={styles.scoreRow}>
              <View style={styles.teamScore}>
                <Text style={[styles.teamLabel, { color: colors.mutedForeground }]}>HOME</Text>
                <Text style={[styles.score, { color: colors.foreground }]}>{props.match.homeScore}</Text>
              </View>
              <Text style={[styles.scoreDivider, { color: colors.mutedForeground }]}>–</Text>
              <View style={styles.teamScore}>
                <Text style={[styles.teamLabel, { color: colors.mutedForeground }]}>AWAY</Text>
                <Text style={[styles.score, { color: colors.foreground }]}>{props.match.awayScore}</Text>
              </View>
            </View>
            <View style={[styles.lineups, { borderTopColor: colors.border }]}>
              <Text style={[styles.lineup, { color: colors.mutedForeground }]} numberOfLines={2}>
                <Text style={{ color: colors.foreground }}>Home: </Text>{summary(props.match.participants, "HOME", props.availablePlayers)}
              </Text>
              <Text style={[styles.lineup, { color: colors.mutedForeground }]} numberOfLines={2}>
                <Text style={{ color: colors.foreground }}>Away: </Text>{summary(props.match.participants, "AWAY", props.availablePlayers)}
              </Text>
            </View>
          </>
        ) : (
          <View style={[styles.empty, { backgroundColor: colors.muted }]}>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No result recorded</Text>
            <Text style={[styles.stateText, { color: colors.mutedForeground }]}>
              Add participants, the final score, scorers, assists and disciplinary stats.
            </Text>
          </View>
        )}

        {props.canManage ? (
          <View style={styles.actions}>
            <TouchableOpacity
              testID="match-stats-edit"
              style={[styles.primaryButton, { backgroundColor: props.admin ? colors.info : colors.primary }]}
              onPress={openEditor}
            >
              <FeatherIcons name={props.match ? "edit-2" : "plus"} size={16} color={colors.primaryForeground} />
              <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>
                {props.match ? (props.admin ? "Correct record" : "Edit result") : "Record result"}
              </Text>
            </TouchableOpacity>
            {props.admin && props.match && props.onDelete && (
              <TouchableOpacity testID="match-stats-remove" style={styles.removeButton} onPress={() => setRemoveVisible(true)}>
                <FeatherIcons name="trash-2" size={16} color={colors.destructive} />
                <Text style={[styles.buttonText, { color: colors.destructive }]}>Remove</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : props.lockedReason ? (
          <TouchableOpacity
            testID="match-stats-upgrade"
            disabled={!props.onUpgrade}
            style={[styles.upgrade, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "45" }]}
            onPress={props.onUpgrade}
          >
            <FeatherIcons name="lock" size={17} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.upgradeTitle, { color: colors.foreground }]}>Unlock with Pro</Text>
              <Text style={[styles.stateText, { color: colors.mutedForeground, textAlign: "left" }]}>{props.lockedReason}</Text>
            </View>
            <FeatherIcons name="chevron-right" size={18} color={colors.primary} />
          </TouchableOpacity>
        ) : null}
      </View>

      <Modal visible={editorVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setEditorVisible(false)}>
        <View style={[styles.modal, { backgroundColor: colors.background, paddingTop: Platform.OS === "web" ? 67 : insets.top }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <TouchableOpacity testID="match-editor-close" onPress={() => setEditorVisible(false)} accessibilityLabel="Close match editor">
              <FeatherIcons name="x" size={24} color={colors.foreground} />
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>{props.match ? "Edit match" : "Record match"}</Text>
            <TouchableOpacity
              testID="match-editor-save"
              style={styles.headerSaveButton}
              disabled={props.isSaving}
              onPress={() => void save()}
              accessibilityRole="button"
              accessibilityLabel="Save match statistics"
            >
              {props.isSaving ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Text style={[styles.headerSaveText, { color: colors.primary }]}>Save</Text>
              )}
            </TouchableOpacity>
          </View>
          <KeyboardAwareScrollViewCompat
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + (Platform.OS === "web" ? 68 : 28) }}
            bottomOffset={64}
            keyboardDismissMode="interactive"
          >
            {props.admin && (
              <>
                <Text style={[styles.formLabel, { color: colors.mutedForeground }]}>CORRECTION REASON (REQUIRED)</Text>
                <TextInput testID="match-correction-reason" accessibilityLabel="Correction reason"
                  value={draft.reason} onChangeText={(reason) => setDraft((current) => ({ ...current, reason }))}
                  multiline maxLength={500} placeholder="Why is this record being corrected?"
                  placeholderTextColor={colors.mutedForeground}
                  style={[styles.reasonInput, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]} />
                <Text style={[styles.stateText, { color: colors.mutedForeground }]}>This updates venue rankings and saves the reason in the audit history.</Text>
              </>
            )}
            <Text style={[styles.formLabel, { color: colors.mutedForeground }]}>FINAL SCORE</Text>
            <View style={styles.scoreInputs}>
              <View style={styles.scoreInputWrap}>
                <Text style={[styles.teamLabel, { color: colors.mutedForeground }]}>HOME</Text>
                <TextInput
                  testID="match-home-score"
                  style={[styles.scoreInput, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]}
                  value={draft.homeScore}
                  onChangeText={(homeScore) => {
                    setEditorError(null);
                    setDraft((current) => ({ ...current, homeScore }));
                  }}
                  keyboardType="number-pad"
                  inputMode="numeric"
                  maxLength={3}
                  placeholder="0"
                  placeholderTextColor={colors.mutedForeground}
                />
              </View>
              <Text style={[styles.scoreDivider, { color: colors.mutedForeground }]}>–</Text>
              <View style={styles.scoreInputWrap}>
                <Text style={[styles.teamLabel, { color: colors.mutedForeground }]}>AWAY</Text>
                <TextInput
                  testID="match-away-score"
                  style={[styles.scoreInput, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]}
                  value={draft.awayScore}
                  onChangeText={(awayScore) => {
                    setEditorError(null);
                    setDraft((current) => ({ ...current, awayScore }));
                  }}
                  keyboardType="number-pad"
                  inputMode="numeric"
                  maxLength={3}
                  placeholder="0"
                  placeholderTextColor={colors.mutedForeground}
                />
              </View>
            </View>

            {editorError ? (
              <View
                testID="match-editor-error"
                style={[
                  styles.formError,
                  { backgroundColor: colors.destructive + "12", borderColor: colors.destructive + "45" },
                ]}
              >
                <FeatherIcons name="alert-circle" size={16} color={colors.destructive} />
                <Text style={[styles.formErrorText, { color: colors.destructive }]}>{editorError}</Text>
              </View>
            ) : null}

            <Text style={[styles.formLabel, { color: colors.mutedForeground }]}>PARTICIPANTS</Text>
            {props.availablePlayers.length === 0 ? (
              <View style={[styles.empty, { backgroundColor: colors.muted }]}>
                <Text style={[styles.stateText, { color: colors.mutedForeground }]}>No eligible players are available for this booking.</Text>
              </View>
            ) : props.availablePlayers.map((player) => {
              const participant = draft.participants.find((item) => item.playerId === player.id);
              return (
                <View key={player.id} style={[styles.playerCard, { backgroundColor: colors.card, borderColor: participant ? colors.primary : colors.border }]}>
                  <TouchableOpacity style={styles.playerSelect} onPress={() => togglePlayer(player)}>
                    <FeatherIcons name={participant ? "check-circle" : "circle"} size={19} color={participant ? colors.primary : colors.mutedForeground} />
                    <Text style={[styles.playerName, { color: colors.foreground }]}>{player.name}</Text>
                  </TouchableOpacity>
                  {participant && (
                    <>
                      <View style={styles.teamToggle}>
                        {(["HOME", "AWAY"] as const).map((team) => (
                          <TouchableOpacity
                            key={team}
                            style={[styles.teamButton, { borderColor: participant.team === team ? colors.primary : colors.border, backgroundColor: participant.team === team ? colors.primary + "15" : colors.background }]}
                            onPress={() => patchParticipant(player.id, { team })}
                          >
                            <Text style={[styles.teamButtonText, { color: participant.team === team ? colors.primary : colors.mutedForeground }]}>{team}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <View style={styles.statGrid}>
                        {(["goals", "assists", "saves", "yellowCards", "redCards"] as const).map((key) => (
                          <View key={key} style={styles.statField}>
                            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                              {key === "yellowCards" ? "Yellow" : key === "redCards" ? "Red" : key[0].toUpperCase() + key.slice(1)}
                            </Text>
                            <TextInput
                              style={[styles.statInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                              value={String(participant[key])}
                              onChangeText={(value) => {
                                const maximum = key === "yellowCards" ? 2 : key === "redCards" ? 1 : key === "saves" ? 500 : 100;
                                const number = Math.max(0, Math.min(maximum, Number.parseInt(value || "0", 10) || 0));
                                patchParticipant(player.id, { [key]: number });
                              }}
                              keyboardType="number-pad"
                              inputMode="numeric"
                              maxLength={key === "saves" ? 3 : 3}
                              selectTextOnFocus
                            />
                          </View>
                        ))}
                      </View>
                    </>
                  )}
                </View>
              );
            })}
          </KeyboardAwareScrollViewCompat>
        </View>
      </Modal>

      <Modal visible={removeVisible} transparent animationType="fade" onRequestClose={() => setRemoveVisible(false)}>
        <View style={styles.overlay}>
          <View style={[styles.dialog, { backgroundColor: colors.card }]}>
            <Text style={[styles.dialogTitle, { color: colors.foreground }]}>Remove match statistics?</Text>
            <Text style={[styles.dialogCopy, { color: colors.mutedForeground }]}>This recalculates affected player totals and is recorded in the audit trail.</Text>
            <TextInput
              testID="match-remove-reason"
              style={[styles.reasonInput, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]}
              value={removeReason}
              onChangeText={setRemoveReason}
              placeholder="Reason for removal"
              placeholderTextColor={colors.mutedForeground}
              multiline
              maxLength={500}
            />
            <View style={styles.actions}>
              <TouchableOpacity style={[styles.dialogButton, { borderColor: colors.border }]} onPress={() => setRemoveVisible(false)}>
                <Text style={[styles.buttonText, { color: colors.foreground }]}>Keep</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="match-remove-confirm" disabled={!removeReason.trim() || props.isDeleting} style={[styles.dialogButton, { backgroundColor: colors.destructive, opacity: removeReason.trim() ? 1 : 0.5 }]} onPress={remove}>
                {props.isDeleting ? <ActivityIndicator color={colors.destructiveForeground} /> : <Text style={[styles.buttonText, { color: colors.destructiveForeground }]}>Remove</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, marginHorizontal: 16, marginBottom: 12, padding: 16 },
  header: { flexDirection: "row", alignItems: "center", gap: 11 },
  icon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 16, fontFamily: "PlusJakartaSans_700Bold" },
  subtitle: { marginTop: 2, fontSize: 11, lineHeight: 16, fontFamily: "PlusJakartaSans_400Regular" },
  recordedPill: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 },
  pillText: { fontSize: 9, fontFamily: "PlusJakartaSans_700Bold" },
  state: { minHeight: 90, alignItems: "center", justifyContent: "center", gap: 7 },
  stateText: { fontSize: 12, lineHeight: 17, textAlign: "center", fontFamily: "PlusJakartaSans_400Regular" },
  empty: { marginTop: 14, padding: 14, borderRadius: 10, alignItems: "center", gap: 4 },
  emptyTitle: { fontSize: 13, fontFamily: "PlusJakartaSans_600SemiBold" },
  scoreRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 18, paddingVertical: 16 },
  teamScore: { alignItems: "center", minWidth: 60 },
  teamLabel: { fontSize: 10, letterSpacing: 0.8, fontFamily: "PlusJakartaSans_700Bold" },
  score: { fontSize: 34, fontFamily: "PlusJakartaSans_700Bold" },
  scoreDivider: { fontSize: 25, fontFamily: "PlusJakartaSans_400Regular" },
  lineups: { borderTopWidth: 1, paddingTop: 11, gap: 5 },
  lineup: { fontSize: 11, lineHeight: 16, fontFamily: "PlusJakartaSans_400Regular" },
  actions: { flexDirection: "row", gap: 9, marginTop: 14 },
  primaryButton: { flex: 1, minHeight: 44, borderRadius: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  removeButton: { minHeight: 44, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  buttonText: { fontSize: 13, fontFamily: "PlusJakartaSans_700Bold" },
  upgrade: { marginTop: 14, padding: 12, borderRadius: 10, borderWidth: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  upgradeTitle: { fontSize: 13, marginBottom: 2, fontFamily: "PlusJakartaSans_700Bold" },
  modal: { flex: 1 },
  modalHeader: { height: 58, paddingHorizontal: 18, borderBottomWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalTitle: { fontSize: 17, fontFamily: "PlusJakartaSans_700Bold" },
  headerSaveButton: { minWidth: 64, minHeight: 44, alignItems: "flex-end", justifyContent: "center" },
  headerSaveText: { fontSize: 15, fontFamily: "PlusJakartaSans_700Bold" },
  formLabel: { fontSize: 10, letterSpacing: 1, marginTop: 18, marginBottom: 9, fontFamily: "PlusJakartaSans_700Bold" },
  scoreInputs: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16 },
  scoreInputWrap: { alignItems: "center", gap: 5 },
  scoreInput: { width: 76, height: 60, borderRadius: 12, borderWidth: 1, textAlign: "center", fontSize: 27, fontFamily: "PlusJakartaSans_700Bold" },
  formError: { marginTop: 14, borderWidth: 1, borderRadius: 10, padding: 11, flexDirection: "row", alignItems: "center", gap: 8 },
  formErrorText: { flex: 1, fontSize: 12, lineHeight: 17, fontFamily: "PlusJakartaSans_500Medium" },
  playerCard: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 9 },
  playerSelect: { flexDirection: "row", alignItems: "center", gap: 9, minHeight: 28 },
  playerName: { flex: 1, fontSize: 14, fontFamily: "PlusJakartaSans_600SemiBold" },
  teamToggle: { flexDirection: "row", gap: 7, marginTop: 10 },
  teamButton: { flex: 1, alignItems: "center", borderWidth: 1, borderRadius: 8, paddingVertical: 7 },
  teamButtonText: { fontSize: 10, fontFamily: "PlusJakartaSans_700Bold" },
  statGrid: { flexDirection: "row", gap: 6, marginTop: 10 },
  statField: { flex: 1, alignItems: "center", gap: 4 },
  statLabel: { fontSize: 8, fontFamily: "PlusJakartaSans_600SemiBold" },
  statInput: { width: "100%", height: 36, borderWidth: 1, borderRadius: 7, textAlign: "center", fontSize: 13, fontFamily: "PlusJakartaSans_600SemiBold" },
  reasonInput: { minHeight: 88, borderWidth: 1, borderRadius: 10, padding: 12, textAlignVertical: "top", fontSize: 13, fontFamily: "PlusJakartaSans_400Regular" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 24 },
  dialog: { borderRadius: 16, padding: 18 },
  dialogTitle: { fontSize: 18, fontFamily: "PlusJakartaSans_700Bold" },
  dialogCopy: { marginTop: 5, marginBottom: 14, fontSize: 12, lineHeight: 18, fontFamily: "PlusJakartaSans_400Regular" },
  dialogButton: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: 10, alignItems: "center", justifyContent: "center" },
});