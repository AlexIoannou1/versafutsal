import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import FeatherIcons from "@/components/FeatherIcons";
import { useColors } from "@/hooks/useColors";
import { useListOwnerVenues, useGetOwnerVenue, useCreateTournament, getListOwnerTournamentsQueryKey, getGetOwnerVenueQueryKey } from "@workspace/api-client-react";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useQueryClient } from "@tanstack/react-query";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

export default function CreateTournamentScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [venueId, setVenueId] = useState("");
  const [pitchId, setPitchId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [entryType, setEntryType] = useState<"PLAYER" | "TEAM">("TEAM");
  const [capacity, setCapacity] = useState("8");
  const [entryFee, setEntryFee] = useState("50.00");
  const [prizePool, setPrizePool] = useState("200.00");

  const [regDeadline, setRegDeadline] = useState(new Date(Date.now() + 7 * 86400000));
  const [startsAt, setStartsAt] = useState(new Date(Date.now() + 10 * 86400000));
  const [endsAt, setEndsAt] = useState(new Date(Date.now() + 11 * 86400000));

  const [showPicker, setShowPicker] = useState<"reg" | "start" | "end" | null>(null);

  const { data: venuesData } = useListOwnerVenues();
  const venues = venuesData?.venues ?? [];
  const { data: venueDetail } = useGetOwnerVenue(venueId, {
    query: { enabled: !!venueId, queryKey: getGetOwnerVenueQueryKey(venueId) },
  });
  const pitches = venueDetail?.venue.pitches ?? [];

  const createMut = useCreateTournament();

  const handleSave = () => {
    if (!venueId || !pitchId || !name || !capacity || !entryFee || !prizePool) {
      Alert.alert("Missing fields", "Please fill all required fields.");
      return;
    }

    createMut.mutate(
      {
        data: {
          venueId,
          pitchId,
          name,
          description: description || undefined,
          entryType,
          capacity: parseInt(capacity, 10),
          entryFeeAmount: entryFee,
          prizePoolAmount: prizePool,
          registrationDeadline: regDeadline.toISOString(),
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListOwnerTournamentsQueryKey() });
          router.back();
        },
        onError: (err: any) => {
          Alert.alert("Error", err.message || "Failed to create tournament");
        },
      }
    );
  };

  const activeDate = showPicker === "reg" ? regDeadline : showPicker === "start" ? startsAt : endsAt;
  const setActiveDate = (d: Date) => {
    if (showPicker === "reg") setRegDeadline(d);
    else if (showPicker === "start") setStartsAt(d);
    else if (showPicker === "end") setEndsAt(d);
  };

  return (
    <KeyboardAwareScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}
      bottomOffset={40}
    >
      <Text style={[styles.label, { color: colors.foreground }]}>Venue</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {venues.map((v) => (
            <TouchableOpacity
              key={v.id}
              style={[
                styles.chip,
                { backgroundColor: colors.card, borderColor: venueId === v.id ? colors.primary : colors.border },
              ]}
              onPress={() => {
                setVenueId(v.id);
                setPitchId("");
              }}
            >
              <Text style={[styles.chipText, { color: venueId === v.id ? colors.primary : colors.foreground }]}>
                {v.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {pitches.length > 0 && (
        <>
          <Text style={[styles.label, { color: colors.foreground }]}>Pitch</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {pitches.map((p) => (
                <TouchableOpacity
                  key={p.id}
                  style={[
                    styles.chip,
                    { backgroundColor: colors.card, borderColor: pitchId === p.id ? colors.primary : colors.border },
                  ]}
                  onPress={() => setPitchId(p.id)}
                >
                  <Text style={[styles.chipText, { color: pitchId === p.id ? colors.primary : colors.foreground }]}>
                    {p.name} ({p.type})
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </>
      )}

      <Text style={[styles.label, { color: colors.foreground }]}>Name</Text>
      <TextInput
        style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
        value={name}
        onChangeText={setName}
        placeholder="e.g. Summer Cup 2024"
        placeholderTextColor={colors.mutedForeground}
      />

      <Text style={[styles.label, { color: colors.foreground }]}>Description (Optional)</Text>
      <TextInput
        style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, height: 80 }]}
        value={description}
        onChangeText={setDescription}
        placeholder="Rules, format details, etc."
        placeholderTextColor={colors.mutedForeground}
        multiline
      />

      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.label, { color: colors.foreground }]}>Entry Type</Text>
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
            {(["TEAM", "PLAYER"] as const).map((t) => (
              <TouchableOpacity
                key={t}
                style={[
                  styles.chip,
                  { flex: 1, backgroundColor: colors.card, borderColor: entryType === t ? colors.primary : colors.border },
                ]}
                onPress={() => setEntryType(t)}
              >
                <Text style={[styles.chipText, { textAlign: "center", color: entryType === t ? colors.primary : colors.foreground }]}>
                  {t}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.label, { color: colors.foreground }]}>Capacity</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            value={capacity}
            onChangeText={setCapacity}
            keyboardType="number-pad"
            placeholder="8"
            placeholderTextColor={colors.mutedForeground}
          />
        </View>
      </View>

      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.label, { color: colors.foreground }]}>Entry Fee</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            value={entryFee}
            onChangeText={setEntryFee}
            keyboardType="decimal-pad"
            placeholder="50.00"
            placeholderTextColor={colors.mutedForeground}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.label, { color: colors.foreground }]}>Prize Pool</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            value={prizePool}
            onChangeText={setPrizePool}
            keyboardType="decimal-pad"
            placeholder="200.00"
            placeholderTextColor={colors.mutedForeground}
          />
        </View>
      </View>

      <Text style={[styles.label, { color: colors.foreground }]}>Dates</Text>
      <View style={{ gap: 8, marginBottom: 24 }}>
        <TouchableOpacity
          style={[styles.dateBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => setShowPicker("reg")}
        >
          <FeatherIcons name="calendar" size={16} color={colors.mutedForeground} />
          <Text style={[styles.dateText, { color: colors.foreground }]}>
            Reg. Deadline: {regDeadline.toLocaleDateString()}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.dateBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => setShowPicker("start")}
        >
          <FeatherIcons name="calendar" size={16} color={colors.mutedForeground} />
          <Text style={[styles.dateText, { color: colors.foreground }]}>
            Starts: {startsAt.toLocaleDateString()}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.dateBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => setShowPicker("end")}
        >
          <FeatherIcons name="calendar" size={16} color={colors.mutedForeground} />
          <Text style={[styles.dateText, { color: colors.foreground }]}>
            Ends: {endsAt.toLocaleDateString()}
          </Text>
        </TouchableOpacity>
      </View>

      {showPicker && (
        <View style={{ marginBottom: 16 }}>
          <DateTimePicker
            value={activeDate}
            mode="date"
            display={Platform.OS === "ios" ? "spinner" : "default"}
            onChange={(e, d) => {
              if (Platform.OS === "android") setShowPicker(null);
              if (d) setActiveDate(d);
            }}
          />
          {Platform.OS === "ios" && (
            <TouchableOpacity
              style={{ alignSelf: "flex-end", padding: 8 }}
              onPress={() => setShowPicker(null)}
            >
              <Text style={{ color: colors.primary, fontFamily: "PlusJakartaSans_600SemiBold" }}>Done</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <TouchableOpacity
        style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: createMut.isPending ? 0.7 : 1 }]}
        onPress={handleSave}
        disabled={createMut.isPending}
      >
        {createMut.isPending ? (
          <ActivityIndicator color={colors.primaryForeground} />
        ) : (
          <Text style={[styles.saveText, { color: colors.primaryForeground }]}>Create Tournament</Text>
        )}
      </TouchableOpacity>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontFamily: "PlusJakartaSans_600SemiBold", marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: "PlusJakartaSans_400Regular",
    marginBottom: 16,
  },
  row: { flexDirection: "row", gap: 12 },
  chip: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  chipText: { fontSize: 13, fontFamily: "PlusJakartaSans_500Medium" },
  dateBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  dateText: { fontSize: 14, fontFamily: "PlusJakartaSans_500Medium" },
  saveBtn: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  saveText: { fontSize: 16, fontFamily: "PlusJakartaSans_700Bold" },
});
