import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, TextInput } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import FeatherIcons from "@/components/FeatherIcons";
import { useGetTournament, useRegisterForTournament, useCheckoutTournamentRegistration, useCaptureTournamentRegistration, getGetTournamentQueryKey, useListPlayerTournamentRegistrations } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useStripe } from "@/lib/stripe-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

export default function PlayerTournamentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  const [teamName, setTeamName] = useState("");

  const { data, isLoading } = useGetTournament(id as string, {
    query: { enabled: !!id, queryKey: getGetTournamentQueryKey(id as string) },
  });

  const { data: myRegsData, refetch: refetchRegs } = useListPlayerTournamentRegistrations();

  const myRegistration = myRegsData?.registrations.find(r => r.tournamentId === id);

  const registerMut = useRegisterForTournament();
  const checkoutMut = useCheckoutTournamentRegistration();
  const captureMut = useCaptureTournamentRegistration();

  const handleRegister = async () => {
    if (!data) return;
    
    // If they already have a pending/failed registration, we just retry checkout
    let regId = myRegistration?.id;
    
    try {
      if (!regId) {
        if (data.tournament.entryType === "TEAM" && !teamName.trim()) {
          Alert.alert("Team Name Required", "Please enter a team name.");
          return;
        }

        // 1. Register
        const regRes = await registerMut.mutateAsync({
          id: id!,
          data: { teamName: teamName.trim() || undefined },
        });
        regId = regRes.registration.id;
      }

      // 2. Checkout
      const checkoutRes = await checkoutMut.mutateAsync({
        id: regId,
        data: { idempotencyKey: Date.now().toString() },
      });

      // 3. Payment
      if (checkoutRes.requiresClientAction && checkoutRes.clientSecret) {
        const { error: initErr } = await initPaymentSheet({
          paymentIntentClientSecret: checkoutRes.clientSecret,
          merchantDisplayName: "FutsalCY",
          returnURL: "futsalcy://stripe-redirect",
        });
        if (initErr) throw new Error(initErr.message);

        const { error: presentErr } = await presentPaymentSheet();
        if (presentErr) {
          // Canceled or failed
          refetchRegs();
          return;
        }

        // 4. Capture
        await captureMut.mutateAsync({
          id: regId,
        });

        Alert.alert("Success", "You have registered for the tournament!");
        queryClient.invalidateQueries({ queryKey: getGetTournamentQueryKey(id!) });
        refetchRegs();
      } else if (!checkoutRes.requiresClientAction) {
        Alert.alert("Success", "Registered successfully (free).");
        queryClient.invalidateQueries({ queryKey: getGetTournamentQueryKey(id!) });
        refetchRegs();
      }
    } catch (err: any) {
      Alert.alert("Registration Error", err.message || "Something went wrong.");
      refetchRegs();
    }
  };

  if (isLoading || !data) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const { tournament, matches, registrations } = data;
  const isBusy = registerMut.isPending || checkoutMut.isPending || captureMut.isPending;
  const participantLabel = (registrationId: string | null) => {
    if (!registrationId) return "TBD";
    const registration = registrations.find((item) => item.id === registrationId);
    return registration?.teamName || registration?.participantName || "Participant";
  };

  return (
    <KeyboardAwareScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 16 }}>
      <View style={{ marginBottom: 24 }}>
        <Text style={[styles.title, { color: colors.foreground }]}>{tournament.name}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
          <View style={{ backgroundColor: colors.primary + "15", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 }}>
            <Text style={{ color: colors.primary, fontSize: 10, fontFamily: "PlusJakartaSans_700Bold" }}>{tournament.status}</Text>
          </View>
          <Text style={{ color: colors.mutedForeground, fontFamily: "PlusJakartaSans_500Medium" }}>
            {new Date(tournament.startsAt).toLocaleDateString()}
          </Text>
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Details</Text>
        {tournament.description && (
          <Text style={{ color: colors.foreground, marginTop: 8, fontFamily: "PlusJakartaSans_400Regular" }}>
            {tournament.description}
          </Text>
        )}
        
        <View style={{ marginTop: 12 }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>CAPACITY</Text>
          <Text style={{ color: colors.foreground, fontFamily: "PlusJakartaSans_600SemiBold" }}>
            {tournament.confirmedRegistrations} / {tournament.capacity} {tournament.entryType}S
          </Text>
        </View>

        <View style={{ marginTop: 12 }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>REGISTRATION DEADLINE</Text>
          <Text style={{ color: colors.foreground, fontFamily: "PlusJakartaSans_600SemiBold" }}>
            {new Date(tournament.registrationDeadline).toLocaleString()}
          </Text>
        </View>

        <View style={{ flexDirection: "row", marginTop: 12, gap: 24 }}>
          <View>
            <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>ENTRY FEE</Text>
            <Text style={{ color: colors.foreground, fontFamily: "PlusJakartaSans_600SemiBold" }}>
              {tournament.entryFeeAmount} {tournament.currency}
            </Text>
          </View>
          <View>
            <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>PRIZE POOL</Text>
            <Text style={{ color: colors.foreground, fontFamily: "PlusJakartaSans_600SemiBold" }}>
              {tournament.prizePoolAmount} {tournament.currency}
            </Text>
          </View>
        </View>
      </View>

      {myRegistration ? (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 12 }]}>Your Registration</Text>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 16 }}>
            <Text style={{ color: colors.foreground, fontFamily: "PlusJakartaSans_600SemiBold" }}>
              {myRegistration.teamName || "Solo Entry"}
            </Text>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Status</Text>
              <Text style={{ color: colors.primary, fontFamily: "PlusJakartaSans_700Bold" }}>{myRegistration.status}</Text>
            </View>
          </View>

          {(myRegistration.paymentStatus === "FAILED" || myRegistration.paymentStatus === "PENDING" || myRegistration.status === "PAYMENT_PENDING" || myRegistration.status === "PAYMENT_FAILED") && tournament.status === "PUBLISHED" && (
            <TouchableOpacity
              testID="retry-payment-button"
              style={[styles.btn, { backgroundColor: colors.primary, opacity: isBusy ? 0.7 : 1 }]}
              onPress={handleRegister}
              disabled={isBusy}
            >
              {isBusy ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[styles.btnText, { color: colors.primaryForeground }]}>Complete Payment</Text>}
            </TouchableOpacity>
          )}
        </View>
      ) : tournament.status === "PUBLISHED" ? (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 12 }]}>Join Tournament</Text>
          
          {tournament.entryType === "TEAM" && (
            <TextInput
              testID="team-name-input"
              style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
              placeholder="Enter Team Name"
              placeholderTextColor={colors.mutedForeground}
              value={teamName}
              onChangeText={setTeamName}
            />
          )}

          <TouchableOpacity
            testID="register-tournament-button"
            style={[styles.btn, { backgroundColor: colors.primary, opacity: isBusy ? 0.7 : 1 }]}
            onPress={handleRegister}
            disabled={isBusy}
          >
            {isBusy ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[styles.btnText, { color: colors.primaryForeground }]}>Register Now</Text>}
          </TouchableOpacity>
        </View>
      ) : null}

      {matches.length > 0 && (
        <View style={{ marginTop: 24 }}>
          <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 12 }]}>Bracket</Text>
          {matches.map(m => (
            <View key={m.id} style={[styles.matchCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={{ color: colors.mutedForeground, fontSize: 12, marginBottom: 4 }}>Round {m.roundNumber} - Match {m.matchNumber}</Text>
              <Text style={{ color: colors.foreground }}>
                {participantLabel(m.participantOneRegistrationId ?? null)} vs {participantLabel(m.participantTwoRegistrationId ?? null)}
              </Text>
              {m.winnerRegistrationId && (
                <Text style={{ color: colors.success, fontSize: 12, marginTop: 4 }}>
                  Winner: {participantLabel(m.winnerRegistrationId)}
                </Text>
              )}
            </View>
          ))}
        </View>
      )}
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  title: { fontSize: 24, fontFamily: "PlusJakartaSans_700Bold" },
  card: { padding: 16, borderRadius: 12, borderWidth: 1, marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontFamily: "PlusJakartaSans_700Bold" },
  input: { borderWidth: 1, borderRadius: 8, padding: 12, marginBottom: 16, fontFamily: "PlusJakartaSans_400Regular" },
  btn: { paddingVertical: 14, borderRadius: 8, alignItems: "center" },
  btnText: { fontSize: 16, fontFamily: "PlusJakartaSans_700Bold" },
  matchCard: { padding: 12, borderRadius: 8, borderWidth: 1, marginBottom: 8 },
});
