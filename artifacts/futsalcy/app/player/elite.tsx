import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
  PanResponder,
  Modal,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import FeatherIcons from '@/components/FeatherIcons';
import { useColors } from '@/hooks/useColors';
import { useGetVenue, useSearchPlayerTeammates, useCreateSquadRequest, getListSquadRequestsQueryKey, getGetVenueQueryKey, getSearchPlayerTeammatesQueryKey, type Teammate } from '@workspace/api-client-react';
import { useAuth } from '@/context/AuthContext';
import { useQueryClient } from '@tanstack/react-query';
import DateTimePicker from "@react-native-community/datetimepicker";

const MIN_SKILL_LEVEL = 1;
const MAX_SKILL_LEVEL = 10;

type SkillRangeSliderProps = {
  minimum: number;
  maximum: number;
  onChange: (minimum: number, maximum: number) => void;
};

function SkillRangeSlider({ minimum, maximum, onChange }: SkillRangeSliderProps) {
  const colors = useColors();
  const trackWidth = useRef(0);
  const range = useRef({ minimum, maximum });
  const onRangeChange = useRef(onChange);
  const minimumDragStart = useRef(minimum);
  const maximumDragStart = useRef(maximum);

  range.current = { minimum, maximum };
  onRangeChange.current = onChange;
  const minimumPosition = ((minimum - MIN_SKILL_LEVEL) / (MAX_SKILL_LEVEL - MIN_SKILL_LEVEL)) * 100;
  const maximumPosition = ((maximum - MIN_SKILL_LEVEL) / (MAX_SKILL_LEVEL - MIN_SKILL_LEVEL)) * 100;

  const minimumPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        minimumDragStart.current = range.current.minimum;
      },
      onPanResponderMove: (_event, gestureState) => {
        if (trackWidth.current <= 0) return;

        const valueDelta = Math.round(
          (gestureState.dx / trackWidth.current) *
            (MAX_SKILL_LEVEL - MIN_SKILL_LEVEL),
        );
        const nextMinimum = Math.max(
          MIN_SKILL_LEVEL,
          Math.min(range.current.maximum, minimumDragStart.current + valueDelta),
        );
        onRangeChange.current(nextMinimum, range.current.maximum);
      },
    }),
  ).current;

  const maximumPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        maximumDragStart.current = range.current.maximum;
      },
      onPanResponderMove: (_event, gestureState) => {
        if (trackWidth.current <= 0) return;

        const valueDelta = Math.round(
          (gestureState.dx / trackWidth.current) *
            (MAX_SKILL_LEVEL - MIN_SKILL_LEVEL),
        );
        const nextMaximum = Math.min(
          MAX_SKILL_LEVEL,
          Math.max(range.current.minimum, maximumDragStart.current + valueDelta),
        );
        onRangeChange.current(range.current.minimum, nextMaximum);
      },
    }),
  ).current;

  const adjustMinimum = (amount: number) => {
    onChange(
      Math.max(MIN_SKILL_LEVEL, Math.min(maximum, minimum + amount)),
      maximum,
    );
  };
  const adjustMaximum = (amount: number) => {
    onChange(
      minimum,
      Math.min(MAX_SKILL_LEVEL, Math.max(minimum, maximum + amount)),
    );
  };

  const styles = StyleSheet.create({
    control: { marginBottom: 8 },
    values: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: 14,
    },
    value: {
      fontSize: 14,
      fontFamily: "PlusJakartaSans_600SemiBold",
      color: colors.foreground,
    },
    valueNumber: { color: colors.primary },
    trackTouchArea: {
      height: 40,
      justifyContent: "center",
      marginHorizontal: 10,
    },
    track: {
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.muted,
    },
    selectedTrack: {
      position: "absolute",
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.primary,
    },
    handleTouchTarget: {
      position: "absolute",
      top: -21,
      width: 48,
      height: 48,
      alignItems: "center",
      justifyContent: "center",
    },
    thumb: {
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: colors.card,
      borderWidth: 3,
      borderColor: colors.primary,
    },
    scale: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: 4,
    },
    scaleLabel: {
      fontSize: 12,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.mutedForeground,
    },
  });

  return (
    <View style={styles.control}>
      <View style={styles.values} accessible accessibilityLabel={`Skill range from ${minimum} to ${maximum}`}>
        <Text style={styles.value}>
          Min <Text style={styles.valueNumber}>{minimum}</Text>
        </Text>
        <Text style={styles.value}>
          Max <Text style={styles.valueNumber}>{maximum}</Text>
        </Text>
      </View>
      <View
        style={styles.trackTouchArea}
        onLayout={(event) => {
          trackWidth.current = event.nativeEvent.layout.width;
        }}
      >
        <View style={styles.track}>
          <View
            style={[
              styles.selectedTrack,
              {
                left: `${minimumPosition}%`,
                right: `${100 - maximumPosition}%`,
              },
            ]}
          />
          <View
            style={[
              styles.handleTouchTarget,
              {
                left: `${minimumPosition}%`,
                transform: [{ translateX: -24 }],
              },
            ]}
            {...minimumPanResponder.panHandlers}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel="Minimum skill level"
            accessibilityValue={{ min: MIN_SKILL_LEVEL, max: maximum, now: minimum }}
            accessibilityActions={[
              { name: "increment", label: "Increase minimum skill level" },
              { name: "decrement", label: "Decrease minimum skill level" },
            ]}
            onAccessibilityAction={(event) =>
              adjustMinimum(event.nativeEvent.actionName === "increment" ? 1 : -1)
            }
          >
            <View style={styles.thumb} />
          </View>
          <View
            style={[
              styles.handleTouchTarget,
              {
                left: `${maximumPosition}%`,
                transform: [{ translateX: -24 }],
              },
            ]}
            {...maximumPanResponder.panHandlers}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel="Maximum skill level"
            accessibilityValue={{ min: minimum, max: MAX_SKILL_LEVEL, now: maximum }}
            accessibilityActions={[
              { name: "increment", label: "Increase maximum skill level" },
              { name: "decrement", label: "Decrease maximum skill level" },
            ]}
            onAccessibilityAction={(event) =>
              adjustMaximum(event.nativeEvent.actionName === "increment" ? 1 : -1)
            }
          >
            <View style={styles.thumb} />
          </View>
        </View>
      </View>
      <View style={styles.scale} pointerEvents="none">
        <Text style={styles.scaleLabel}>1 · Beginner</Text>
        <Text style={styles.scaleLabel}>10 · Advanced</Text>
      </View>
    </View>
  );
}

export default function PlayerEliteScreen() {
  const { venueId } = useLocalSearchParams<{ venueId: string }>();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: venueData, isLoading: venueLoading } = useGetVenue(venueId!, { query: { enabled: !!venueId, queryKey: getGetVenueQueryKey(venueId!) } });
  const venue = venueData?.venue;

  // Form State
  const [skillMin, setSkillMin] = useState(5);
  const [skillMax, setSkillMax] = useState(8);
  const [pitchId, setPitchId] = useState<string | null>(null);
  const [selectedTeammates, setSelectedTeammates] = useState<Teammate[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSkillInfoVisible, setIsSkillInfoVisible] = useState(false);

  // Date/Time Pickers for Availability
  const [availDate, setAvailDate] = useState<Date>(new Date());
  const [startTime, setStartTime] = useState<Date>(new Date(new Date().setHours(18, 0, 0, 0)));
  const [endTime, setEndTime] = useState<Date>(new Date(new Date().setHours(20, 0, 0, 0)));
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [availabilities, setAvailabilities] = useState<{ startAt: string, endAt: string, exactSlot: boolean }[]>([]);

  // Expiry (e.g., 24 hours from now)
  const [expiresInHours, setExpiresInHours] = useState("24");

  const { data: searchData, isFetching: searchFetching } = useSearchPlayerTeammates(
    { query: searchQuery, limit: 5 },
    { query: { enabled: searchQuery.length >= 3, queryKey: getSearchPlayerTeammatesQueryKey({ query: searchQuery, limit: 5 }) } }
  );

  const createRequest = useCreateSquadRequest({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSquadRequestsQueryKey() });
        Alert.alert("Success", "Squad request created successfully!", [
          { text: "OK", onPress: () => router.back() }
        ]);
      },
      onError: (err: any) => {
        Alert.alert("Error", err.message || "Failed to create squad request.");
      }
    }
  });

  const handleAddAvailability = () => {
    const start = new Date(availDate);
    start.setHours(startTime.getHours(), startTime.getMinutes(), 0, 0);
    const end = new Date(availDate);
    end.setHours(endTime.getHours(), endTime.getMinutes(), 0, 0);

    if (start >= end) {
      Alert.alert("Invalid Time", "End time must be after start time.");
      return;
    }

    setAvailabilities([...availabilities, { startAt: start.toISOString(), endAt: end.toISOString(), exactSlot: true }]);
  };

  const handleCreate = () => {
    if (selectedTeammates.length !== 4) {
      Alert.alert("Error", "You must select exactly 4 teammates to form a squad of 5.");
      return;
    }
    if (availabilities.length === 0) {
      Alert.alert("Error", "Please add at least one availability slot.");
      return;
    }

    if (
      !Number.isInteger(skillMin) ||
      !Number.isInteger(skillMax) ||
      skillMin < MIN_SKILL_LEVEL ||
      skillMax > MAX_SKILL_LEVEL ||
      skillMin > skillMax
    ) {
      Alert.alert("Error", "Skill min and max must be between 1 and 10, and min <= max.");
      return;
    }

    const expHours = parseInt(expiresInHours, 10);
    if (isNaN(expHours) || expHours < 1) {
      Alert.alert("Error", "Expiry hours must be at least 1.");
      return;
    }

    createRequest.mutate({
      data: {
        venueId: venueId!,
        skillMin,
        skillMax,
        members: [{ userId: user!.id }, ...selectedTeammates.map(t => ({ userId: t.id }))],
        availability: availabilities.map(a => ({ ...a, pitchId })),
        expiresAt: new Date(Date.now() + expHours * 60 * 60 * 1000).toISOString()
      }
    });
  };

  const toggleTeammate = (teammate: Teammate) => {
    if (selectedTeammates.find(t => t.id === teammate.id)) {
      setSelectedTeammates(selectedTeammates.filter(t => t.id !== teammate.id));
    } else {
      if (selectedTeammates.length >= 4) {
        Alert.alert("Limit Reached", "You can only select 4 teammates.");
        return;
      }
      setSelectedTeammates([...selectedTeammates, teammate]);
    }
  };

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, paddingBottom: insets.bottom + 40 },
    title: { fontSize: 24, fontFamily: "PlusJakartaSans_700Bold", color: colors.foreground, marginBottom: 4 },
    subtitle: { fontSize: 14, fontFamily: "PlusJakartaSans_400Regular", color: colors.mutedForeground, marginBottom: 16 },
    sectionTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 20,
      marginBottom: 12,
    },
    sectionTitle: { fontSize: 16, fontFamily: "PlusJakartaSans_700Bold", color: colors.foreground },
    infoButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.primary + "12",
    },
    inputLabel: { fontSize: 12, fontFamily: "PlusJakartaSans_600SemiBold", color: colors.foreground, marginBottom: 6 },
    input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, fontSize: 16, fontFamily: "PlusJakartaSans_400Regular", color: colors.foreground },
    searchResult: { flexDirection: 'row', alignItems: 'center', padding: 10, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border },
    avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.muted, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
    avatarText: { color: colors.mutedForeground, fontFamily: "PlusJakartaSans_700Bold" },
    teammateName: { fontSize: 14, fontFamily: "PlusJakartaSans_600SemiBold", color: colors.foreground },
    selectedList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
    selectedChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primary + '20', borderRadius: 16, paddingVertical: 6, paddingHorizontal: 10 },
    selectedChipText: { color: colors.primary, fontSize: 12, fontFamily: "PlusJakartaSans_600SemiBold", marginRight: 4 },
    pitchCard: { padding: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 8, marginBottom: 8, backgroundColor: colors.card },
    pitchCardSelected: { borderColor: colors.primary, backgroundColor: colors.primary + "10" },
    pitchText: { fontSize: 14, fontFamily: "PlusJakartaSans_600SemiBold", color: colors.foreground },
    pitchTextSelected: { color: colors.primary },
    row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
    flex1: { flex: 1 },
    timeSeparator: { color: colors.mutedForeground, marginTop: 18 },
    addButton: { marginTop: 12, backgroundColor: colors.primary + '10', padding: 12, borderRadius: 8, alignItems: 'center' },
    addButtonText: { color: colors.primary, fontFamily: "PlusJakartaSans_700Bold" },
    availabilityChip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.card, padding: 12, borderRadius: 8, marginTop: 8 },
    availabilityText: { color: colors.foreground, fontSize: 13, fontFamily: "PlusJakartaSans_400Regular" },
    removeText: { color: colors.destructive, fontSize: 13, fontFamily: "PlusJakartaSans_600SemiBold" },
    submitBtn: { backgroundColor: colors.primary, padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 32 },
    submitBtnText: { color: colors.primaryForeground, fontSize: 16, fontFamily: "PlusJakartaSans_700Bold" },
    dialogOverlay: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: 24,
      backgroundColor: "rgba(0, 0, 0, 0.45)",
    },
    dialogCard: {
      width: "100%",
      maxWidth: 420,
      borderRadius: 16,
      padding: 20,
      backgroundColor: colors.card,
    },
    dialogTitle: {
      fontSize: 18,
      fontFamily: "PlusJakartaSans_700Bold",
      color: colors.foreground,
      marginBottom: 10,
    },
    dialogBody: {
      fontSize: 14,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.mutedForeground,
      lineHeight: 21,
      marginBottom: 18,
    },
    dialogCloseButton: {
      minHeight: 44,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.primary,
    },
    dialogCloseText: {
      fontSize: 14,
      fontFamily: "PlusJakartaSans_600SemiBold",
      color: colors.primaryForeground,
    },
  });

  if (venueLoading) {
    return <View style={[s.container, { justifyContent: 'center', alignItems: 'center' }]}><ActivityIndicator color={colors.primary} /></View>;
  }

  if (!venue) {
    return <View style={[s.container, { justifyContent: 'center', alignItems: 'center' }]}><Text style={{ color: colors.foreground }}>Venue not found.</Text></View>;
  }

  return (
    <View style={s.container}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={s.content}
        bottomOffset={60}
      >
        <Text style={s.title}>Create Squad Request</Text>
        <Text style={s.subtitle}>Matchmake for {venue.name}</Text>

        <Text style={s.sectionTitle}>1. Teammates ({selectedTeammates.length}/4)</Text>
        <TextInput
          style={s.input}
          placeholder="Search player name or email..."
          placeholderTextColor={colors.mutedForeground}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery.length >= 3 && (
          <View style={{ marginTop: 4, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}>
            {searchFetching ? (
              <View style={{ padding: 12 }}><ActivityIndicator color={colors.primary} /></View>
            ) : (
              searchData?.players?.map(teammate => (
                <TouchableOpacity key={teammate.id} style={s.searchResult} onPress={() => toggleTeammate(teammate)}>
                  <View style={s.avatar}><Text style={s.avatarText}>{teammate.name.charAt(0)}</Text></View>
                  <Text style={s.teammateName}>{teammate.name}</Text>
                  {selectedTeammates.some(t => t.id === teammate.id) && <FeatherIcons name="check" size={16} color={colors.primary} style={{ marginLeft: 'auto' }} />}
                </TouchableOpacity>
              ))
            )}
          </View>
        )}
        {selectedTeammates.length > 0 && (
          <View style={s.selectedList}>
            {selectedTeammates.map(t => (
              <TouchableOpacity key={t.id} style={s.selectedChip} onPress={() => toggleTeammate(t)}>
                <Text style={s.selectedChipText}>{t.name}</Text>
                <FeatherIcons name="x" size={14} color={colors.primary} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={s.sectionTitleRow}>
          <Text style={s.sectionTitle}>2. Skill Level Requirements</Text>
          <TouchableOpacity
            style={s.infoButton}
            onPress={() => setIsSkillInfoVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Explain skill level requirements"
            accessibilityHint="Opens information about selecting a skill range"
          >
            <FeatherIcons name="info" size={18} color={colors.primary} />
          </TouchableOpacity>
        </View>
        <SkillRangeSlider
          minimum={skillMin}
          maximum={skillMax}
          onChange={(minimum, maximum) => {
            setSkillMin(minimum);
            setSkillMax(maximum);
          }}
        />

        <Text style={s.sectionTitle}>3. Pitch Preference</Text>
        <TouchableOpacity style={[s.pitchCard, pitchId === null && s.pitchCardSelected]} onPress={() => setPitchId(null)}>
          <Text style={[s.pitchText, pitchId === null && s.pitchTextSelected]}>Any Pitch</Text>
        </TouchableOpacity>
        {venue.pitches?.map(pitch => (
          <TouchableOpacity key={pitch.id} style={[s.pitchCard, pitchId === pitch.id && s.pitchCardSelected]} onPress={() => setPitchId(pitch.id)}>
            <Text style={[s.pitchText, pitchId === pitch.id && s.pitchTextSelected]}>{pitch.name} - {pitch.type}</Text>
          </TouchableOpacity>
        ))}

        <Text style={s.sectionTitle}>4. Availability</Text>
        <View style={s.row}>
          <TouchableOpacity style={[s.input, s.flex1]} onPress={() => setShowDatePicker(true)}>
            <Text style={{ color: colors.foreground }}>{availDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.input, s.flex1]} onPress={() => setShowStartPicker(true)}>
            <Text style={{ color: colors.foreground }}>{startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
          </TouchableOpacity>
          <Text style={s.timeSeparator}>to</Text>
          <TouchableOpacity style={[s.input, s.flex1]} onPress={() => setShowEndPicker(true)}>
            <Text style={{ color: colors.foreground }}>{endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
          </TouchableOpacity>
        </View>

        {showDatePicker && (
          <DateTimePicker
            value={availDate}
            mode="date"
            minimumDate={new Date()}
            onChange={(event, date) => {
              setShowDatePicker(Platform.OS === 'ios');
              if (date) setAvailDate(date);
            }}
          />
        )}
        {showStartPicker && (
          <DateTimePicker
            value={startTime}
            mode="time"
            onChange={(event, date) => {
              setShowStartPicker(Platform.OS === 'ios');
              if (date) setStartTime(date);
            }}
          />
        )}
        {showEndPicker && (
          <DateTimePicker
            value={endTime}
            mode="time"
            onChange={(event, date) => {
              setShowEndPicker(Platform.OS === 'ios');
              if (date) setEndTime(date);
            }}
          />
        )}

        <TouchableOpacity style={s.addButton} onPress={handleAddAvailability}>
          <Text style={s.addButtonText}>Add Time Slot</Text>
        </TouchableOpacity>

        {availabilities.map((slot, index) => (
          <View key={index} style={s.availabilityChip}>
            <Text style={s.availabilityText}>
              {new Date(slot.startAt).toLocaleDateString()} · {new Date(slot.startAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {new Date(slot.endAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
            <TouchableOpacity onPress={() => setAvailabilities(availabilities.filter((_, i) => i !== index))}>
              <Text style={s.removeText}>Remove</Text>
            </TouchableOpacity>
          </View>
        ))}

        <Text style={s.sectionTitle}>5. Expiry</Text>
        <Text style={s.inputLabel}>Cancel request after (hours)</Text>
        <TextInput style={s.input} value={expiresInHours} onChangeText={setExpiresInHours} keyboardType="numeric" />

        <TouchableOpacity
          style={[s.submitBtn, createRequest.isPending && { opacity: 0.7 }]}
          onPress={handleCreate}
          disabled={createRequest.isPending}
        >
          {createRequest.isPending ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={s.submitBtnText}>Submit Squad Request</Text>
          )}
        </TouchableOpacity>
      </KeyboardAwareScrollViewCompat>
      <Modal
        visible={isSkillInfoVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsSkillInfoVisible(false)}
      >
        <View style={s.dialogOverlay} accessibilityViewIsModal>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setIsSkillInfoVisible(false)}
            accessibilityRole="button"
            accessibilityLabel="Close skill level information"
          />
          <View style={s.dialogCard} accessibilityRole="alert" testID="skill-level-info-dialog">
            <Text style={s.dialogTitle}>Skill level requirements</Text>
            <Text style={s.dialogBody}>
              Choose the range of opponents your five-player squad is comfortable
              playing. Level 1 is beginner and level 10 is advanced. A broader
              range can create more matchmaking opportunities.
            </Text>
            <TouchableOpacity
              style={s.dialogCloseButton}
              onPress={() => setIsSkillInfoVisible(false)}
              accessibilityRole="button"
              accessibilityLabel="Close skill level information"
            >
              <Text style={s.dialogCloseText}>Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/*
function deprecatedSkillRangeSlider() {
  const colors = useColors();
  const [trackWidth, setTrackWidth] = useState(0);
  const activeHandle = useRef<"minimum" | "maximum">("minimum");

  const minimumPosition = ((minimum - MIN_SKILL_LEVEL) / (MAX_SKILL_LEVEL - MIN_SKILL_LEVEL)) * 100;
  const maximumPosition = ((maximum - MIN_SKILL_LEVEL) / (MAX_SKILL_LEVEL - MIN_SKILL_LEVEL)) * 100;

  const updateFromPosition = (locationX: number, handle: "minimum" | "maximum") => {
    if (trackWidth <= 0) return;

    const rawValue =
      MIN_SKILL_LEVEL +
      (locationX / trackWidth) * (MAX_SKILL_LEVEL - MIN_SKILL_LEVEL);
    const nextValue = Math.max(
      MIN_SKILL_LEVEL,
      Math.min(MAX_SKILL_LEVEL, Math.round(rawValue)),
    );

    if (handle === "minimum") {
      onChange(Math.min(nextValue, maximum), maximum);
    } else {
      onChange(minimum, Math.max(nextValue, minimum));
    }
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          const locationX = event.nativeEvent.locationX;
          const minimumX = (minimumPosition / 100) * trackWidth;
          const maximumX = (maximumPosition / 100) * trackWidth;
          activeHandle.current =
            Math.abs(locationX - minimumX) <= Math.abs(locationX - maximumX)
              ? "minimum"
              : "maximum";
          updateFromPosition(locationX, activeHandle.current);
        },
        onPanResponderMove: (event) => {
          updateFromPosition(event.nativeEvent.locationX, activeHandle.current);
        },
      }),
    [maximum, maximumPosition, minimum, minimumPosition, onChange, trackWidth],
  );

  const adjustMinimum = (amount: number) => {
    onChange(
      Math.max(MIN_SKILL_LEVEL, Math.min(maximum, minimum + amount)),
      maximum,
    );
  };
  const adjustMaximum = (amount: number) => {
    onChange(
      minimum,
      Math.min(MAX_SKILL_LEVEL, Math.max(minimum, maximum + amount)),
    );
  };

  const styles = StyleSheet.create({
    control: { marginBottom: 8 },
    values: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: 14,
    },
    value: {
      fontSize: 14,
      fontFamily: "PlusJakartaSans_600SemiBold",
      color: colors.foreground,
    },
    valueNumber: { color: colors.primary },
    trackTouchArea: {
      height: 40,
      justifyContent: "center",
      marginHorizontal: 10,
    },
    track: {
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.muted,
    },
    selectedTrack: {
      position: "absolute",
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.primary,
    },
    thumb: {
      position: "absolute",
      top: -9,
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: colors.card,
      borderWidth: 3,
      borderColor: colors.primary,
    },
    scale: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: 4,
    },
    scaleLabel: {
      fontSize: 12,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.mutedForeground,
    },
  });

  return (
    <View style={styles.control}>
      <View style={styles.values} accessible accessibilityLabel={`Skill range from ${minimum} to ${maximum}`}>
        <Text style={styles.value}>
          Min <Text style={styles.valueNumber}>{minimum}</Text>
        </Text>
        <Text style={styles.value}>
          Max <Text style={styles.valueNumber}>{maximum}</Text>
        </Text>
      </View>
      <View
        style={styles.trackTouchArea}
        onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
        {...panResponder.panHandlers}
        accessibilityLabel={`Skill range from ${minimum} to ${maximum}. Drag either handle to adjust.`}
      >
        <View style={styles.track}>
          <View
            style={[
              styles.selectedTrack,
              {
                left: `${minimumPosition}%`,
                right: `${100 - maximumPosition}%`,
              },
            ]}
          />
          <View
            style={[
              styles.thumb,
              {
                left: `${minimumPosition}%`,
                transform: [{ translateX: -12 }],
              },
            ]}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel="Minimum skill level"
            accessibilityValue={{ min: MIN_SKILL_LEVEL, max: maximum, now: minimum }}
            accessibilityActions={[
              { name: "increment", label: "Increase minimum skill level" },
              { name: "decrement", label: "Decrease minimum skill level" },
            ]}
            onAccessibilityAction={(event) =>
              adjustMinimum(event.nativeEvent.actionName === "increment" ? 1 : -1)
            }
          />
          <View
            style={[
              styles.thumb,
              {
                left: `${maximumPosition}%`,
                transform: [{ translateX: -12 }],
              },
            ]}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel="Maximum skill level"
            accessibilityValue={{ min: minimum, max: MAX_SKILL_LEVEL, now: maximum }}
            accessibilityActions={[
              { name: "increment", label: "Increase maximum skill level" },
              { name: "decrement", label: "Decrease maximum skill level" },
            ]}
            onAccessibilityAction={(event) =>
              adjustMaximum(event.nativeEvent.actionName === "increment" ? 1 : -1)
            }
          />
        </View>
      </View>
      <View style={styles.scale} pointerEvents="none">
        <Text style={styles.scaleLabel}>1 · Beginner</Text>
        <Text style={styles.scaleLabel}>10 · Advanced</Text>
      </View>
    </View>
  );
}
export default function PlayerEliteScreen() {
  const { venueId } = useLocalSearchParams<{ venueId: string }>();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: venueData, isLoading: venueLoading } = useGetVenue(venueId!, { query: { enabled: !!venueId, queryKey: getGetVenueQueryKey(venueId!) } });
  const venue = venueData?.venue;

  // Form State
  const [skillMin, setSkillMin] = useState(5);
  const [skillMax, setSkillMax] = useState(8);
  const [pitchId, setPitchId] = useState<string | null>(null);
  const [selectedTeammates, setSelectedTeammates] = useState<Teammate[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSkillInfoVisible, setIsSkillInfoVisible] = useState(false);

  // Date/Time Pickers for Availability
  const [availDate, setAvailDate] = useState<Date>(new Date());
  const [startTime, setStartTime] = useState<Date>(new Date(new Date().setHours(18, 0, 0, 0)));
  const [endTime, setEndTime] = useState<Date>(new Date(new Date().setHours(20, 0, 0, 0)));
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [availabilities, setAvailabilities] = useState<{ startAt: string, endAt: string, exactSlot: boolean }[]>([]);

  // Expiry (e.g., 24 hours from now)
  const [expiresInHours, setExpiresInHours] = useState("24");

  const { data: searchData, isFetching: searchFetching } = useSearchPlayerTeammates(
    { query: searchQuery, limit: 5 },
    { query: { enabled: searchQuery.length >= 3, queryKey: getSearchPlayerTeammatesQueryKey({ query: searchQuery, limit: 5 }) } }
  );

  const createRequest = useCreateSquadRequest({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSquadRequestsQueryKey() });
        Alert.alert("Success", "Squad request created successfully!", [
          { text: "OK", onPress: () => router.back() }
        ]);
      },
      onError: (err: any) => {
        Alert.alert("Error", err.message || "Failed to create squad request.");
      }
    }
  });

  const handleAddAvailability = () => {
    const start = new Date(availDate);
    start.setHours(startTime.getHours(), startTime.getMinutes(), 0, 0);
    const end = new Date(availDate);
    end.setHours(endTime.getHours(), endTime.getMinutes(), 0, 0);

    if (start >= end) {
      Alert.alert("Invalid Time", "End time must be after start time.");
      return;
    }

    setAvailabilities([...availabilities, { startAt: start.toISOString(), endAt: end.toISOString(), exactSlot: true }]);
  };

  const handleCreate = () => {
    if (selectedTeammates.length !== 4) {
      Alert.alert("Error", "You must select exactly 4 teammates to form a squad of 5.");
      return;
    }
    if (availabilities.length === 0) {
      Alert.alert("Error", "Please add at least one availability slot.");
      return;
    }

    if (
      !Number.isInteger(skillMin) ||
      !Number.isInteger(skillMax) ||
      skillMin < MIN_SKILL_LEVEL ||
      skillMax > MAX_SKILL_LEVEL ||
      skillMin > skillMax
    ) {
      Alert.alert("Error", "Skill min and max must be between 1 and 10, and min <= max.");
      return;
    }

    const expHours = parseInt(expiresInHours, 10);
    if (isNaN(expHours) || expHours < 1) {
      Alert.alert("Error", "Expiry hours must be at least 1.");
      return;
    }

    const expiresAt = new Date(Date.now() + expHours * 60 * 60 * 1000).toISOString();

    createRequest.mutate({
      data: {
        venueId: venueId!,
        skillMin,
        skillMax,
        members: [{ userId: user!.id }, ...selectedTeammates.map(t => ({ userId: t.id }))],
        availability: availabilities.map(a => ({ ...a, pitchId })),
        expiresAt
      }
    });
  };

  const formatTime = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const formatDate = (d: Date) => d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scroll: { padding: 16, paddingBottom: insets.bottom + 40 },
    header: { fontSize: 22, fontFamily: "PlusJakartaSans_700Bold", color: colors.foreground, marginBottom: 4 },
    subHeader: { fontSize: 14, fontFamily: "PlusJakartaSans_400Regular", color: colors.mutedForeground, marginBottom: 24 },
    sectionTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 20,
      marginBottom: 12,
    },
    sectionTitle: { fontSize: 16, fontFamily: "PlusJakartaSans_700Bold", color: colors.foreground },
    infoButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.primary + "12",
    },
    inputLabel: { fontSize: 13, fontFamily: "PlusJakartaSans_600SemiBold", color: colors.foreground, marginBottom: 6 },
    input: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.foreground,
      marginBottom: 16,
    },
    row: { flexDirection: 'row', gap: 12 },
    flex1: { flex: 1 },
    pitchCard: {
      padding: 12,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      marginBottom: 8,
    },
    pitchCardSelected: { borderColor: colors.primary, backgroundColor: colors.primary + '10' },
    pitchName: { fontSize: 15, fontFamily: "PlusJakartaSans_600SemiBold", color: colors.foreground },
    teammateSearch: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      marginBottom: 8,
    },
    teammateInput: { flex: 1, paddingVertical: 10, fontSize: 15, color: colors.foreground },
    searchResult: { padding: 12, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border },
    searchResultText: { fontSize: 14, color: colors.foreground, fontFamily: "PlusJakartaSans_500Medium" },
    searchResultHint: { fontSize: 12, color: colors.mutedForeground, marginTop: 2 },
    selectedTeammate: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.muted, borderRadius: 8, padding: 10, marginBottom: 6 },
    selectedTeammateText: { flex: 1, fontSize: 14, color: colors.foreground, fontFamily: "PlusJakartaSans_500Medium" },
    availRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
    dateBtn: { flex: 1, padding: 10, backgroundColor: colors.card, borderRadius: 8, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
    addBtn: { padding: 12, backgroundColor: colors.secondary, borderRadius: 8, alignItems: 'center', marginBottom: 16 },
    addBtnText: { color: colors.secondaryForeground, fontFamily: "PlusJakartaSans_600SemiBold" },
    availChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primary + '20', padding: 10, borderRadius: 8, marginBottom: 6 },
    availChipText: { flex: 1, color: colors.primary, fontFamily: "PlusJakartaSans_500Medium", fontSize: 14 },
    submitBtn: { backgroundColor: colors.primary, padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 32 },
    submitBtnText: { color: colors.primaryForeground, fontSize: 16, fontFamily: "PlusJakartaSans_700Bold" },
    dialogOverlay: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: 24,
      backgroundColor: "rgba(0, 0, 0, 0.45)",
    },
    dialogCard: {
      width: "100%",
      maxWidth: 420,
      borderRadius: 16,
      padding: 20,
      backgroundColor: colors.card,
    },
    dialogTitle: {
      fontSize: 18,
      fontFamily: "PlusJakartaSans_700Bold",
      color: colors.foreground,
      marginBottom: 10,
    },
    dialogBody: {
      fontSize: 14,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.mutedForeground,
      lineHeight: 21,
      marginBottom: 18,
    },
    dialogCloseButton: {
      minHeight: 44,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.primary,
    },
    dialogCloseText: {
      fontSize: 14,
      fontFamily: "PlusJakartaSans_600SemiBold",
      color: colors.primaryForeground,
    },
  });

  if (venueLoading) {
    return <View style={[s.container, { alignItems: 'center', justifyContent: 'center' }]}><ActivityIndicator color={colors.primary} /></View>;
  }

  return (
    <View style={s.container}>
      <KeyboardAwareScrollViewCompat style={s.container} contentContainerStyle={s.scroll} bottomOffset={40} keyboardShouldPersistTaps="handled">
        <Text style={s.header}>Create Squad Request</Text>
        <Text style={s.subHeader}>Matchmake for {venue?.name}</Text>

        <Text style={s.sectionTitle}>1. Teammates ({selectedTeammates.length}/4)</Text>
        {selectedTeammates.map(t => (
          <View key={t.id} style={s.selectedTeammate}>
            <Text style={s.selectedTeammateText}>{t.name} <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>({t.emailHint})</Text></Text>
            <TouchableOpacity onPress={() => setSelectedTeammates(prev => prev.filter(x => x.id !== t.id))}>
              <FeatherIcons name="x" size={18} color={colors.destructive} />
            </TouchableOpacity>
          </View>
        ))}
        {selectedTeammates.length < 4 && (
          <View>
            <View style={s.teammateSearch}>
              <FeatherIcons name="search" size={18} color={colors.mutedForeground} style={{ marginRight: 8 }} />
              <TextInput
                style={s.teammateInput}
                placeholder="Search player name or email..."
                placeholderTextColor={colors.mutedForeground}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {searchFetching && <ActivityIndicator size="small" color={colors.primary} />}
            </View>
            {searchQuery.length >= 3 && searchData?.players.map(p => (
              !selectedTeammates.find(st => st.id === p.id) && p.id !== user?.id && (
                <TouchableOpacity key={p.id} style={s.searchResult} onPress={() => { setSelectedTeammates([...selectedTeammates, p]); setSearchQuery(""); }}>
                  <Text style={s.searchResultText}>{p.name}</Text>
                  <Text style={s.searchResultHint}>{p.emailHint}</Text>
                </TouchableOpacity>
              )
            ))}
          </View>
        )}

        <View style={s.sectionTitleRow}>
          <Text style={s.sectionTitle}>2. Skill Level Requirements</Text>
          <TouchableOpacity
            style={s.infoButton}
            onPress={() => setIsSkillInfoVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Explain skill level requirements"
            accessibilityHint="Opens information about selecting a skill range"
          >
            <FeatherIcons name="info" size={18} color={colors.primary} />
          </TouchableOpacity>
        </View>
        <SkillRangeSlider
          minimum={skillMin}
          maximum={skillMax}
          onChange={(minimum, maximum) => {
            setSkillMin(minimum);
            setSkillMax(maximum);
          }}
        />

        <Text style={s.sectionTitle}>3. Pitch Preference</Text>
        <TouchableOpacity style={[s.pitchCard, pitchId === null && s.pitchCardSelected]} onPress={() => setPitchId(null)}>
          <Text style={[s.pitchName, pitchId === null && { color: colors.primary }]}>Any Pitch</Text>
        </TouchableOpacity>
        {venue?.pitches?.map(p => (
          <TouchableOpacity key={p.id} style={[s.pitchCard, pitchId === p.id && s.pitchCardSelected]} onPress={() => setPitchId(p.id)}>
            <Text style={[s.pitchName, pitchId === p.id && { color: colors.primary }]}>{p.name} ({p.type})</Text>
          </TouchableOpacity>
        ))}

        <Text style={s.sectionTitle}>4. Availability</Text>
        {availabilities.map((a, i) => (
          <View key={i} style={s.availChip}>
            <Text style={s.availChipText}>
              {new Date(a.startAt).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} · {new Date(a.startAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {new Date(a.endAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
            <TouchableOpacity onPress={() => setAvailabilities(availabilities.filter((_, idx) => idx !== i))}>
              <FeatherIcons name="x" size={18} color={colors.primary} />
            </TouchableOpacity>
          </View>
        ))}

        <View style={s.availRow}>
          <TouchableOpacity style={s.dateBtn} onPress={() => setShowDatePicker(true)}>
            <Text style={{ color: colors.foreground }}>{formatDate(availDate)}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.dateBtn} onPress={() => setShowStartPicker(true)}>
            <Text style={{ color: colors.foreground }}>{formatTime(startTime)}</Text>
          </TouchableOpacity>
          <Text style={{ color: colors.mutedForeground }}>to</Text>
          <TouchableOpacity style={s.dateBtn} onPress={() => setShowEndPicker(true)}>
            <Text style={{ color: colors.foreground }}>{formatTime(endTime)}</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={s.addBtn} onPress={handleAddAvailability}>
          <Text style={s.addBtnText}>Add Time Slot</Text>
        </TouchableOpacity>

        {showDatePicker && (
          <DateTimePicker value={availDate} mode="date" display="default" onChange={(e, d) => { setShowDatePicker(Platform.OS === 'ios'); if(d) setAvailDate(d); }} />
        )}
        {showStartPicker && (
          <DateTimePicker value={startTime} mode="time" display="default" onChange={(e, d) => { setShowStartPicker(Platform.OS === 'ios'); if(d) setStartTime(d); }} />
        )}
        {showEndPicker && (
          <DateTimePicker value={endTime} mode="time" display="default" onChange={(e, d) => { setShowEndPicker(Platform.OS === 'ios'); if(d) setEndTime(d); }} />
        )}

        <Text style={s.sectionTitle}>5. Expiry</Text>
        <Text style={s.inputLabel}>Cancel request after (hours)</Text>
        <TextInput style={s.input} value={expiresInHours} onChangeText={setExpiresInHours} keyboardType="numeric" />

        <TouchableOpacity
          style={[s.submitBtn, createRequest.isPending && { opacity: 0.7 }]}
          onPress={handleCreate}
          disabled={createRequest.isPending}
        >
          {createRequest.isPending ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={s.submitBtnText}>Submit Squad Request</Text>
          )}
        </TouchableOpacity>
      </KeyboardAwareScrollViewCompat>
      <Modal
        visible={isSkillInfoVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsSkillInfoVisible(false)}
      >
        <View style={s.dialogOverlay} accessibilityViewIsModal>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setIsSkillInfoVisible(false)}
            accessibilityRole="button"
            accessibilityLabel="Close skill level information"
          />
          <View style={s.dialogCard} accessibilityRole="alert" testID="skill-level-info-dialog">
            <Text style={s.dialogTitle}>Skill level requirements</Text>
            <Text style={s.dialogBody}>
              Choose the range of opponents your five-player squad is comfortable
              playing. Level 1 is beginner and level 10 is advanced. A broader
              range can create more matchmaking opportunities.
            </Text>
            <TouchableOpacity
              style={s.dialogCloseButton}
              onPress={() => setIsSkillInfoVisible(false)}
              accessibilityRole="button"
              accessibilityLabel="Close skill level information"
            >
              <Text style={s.dialogCloseText}>Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}
*/
