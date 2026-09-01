import React, { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import FeatherIcons from "@/components/FeatherIcons";
import { useColors } from "@/hooks/useColors";
import {
  DEFAULT_PHONE_COUNTRY,
  getPhoneCountry,
  getPhoneCountryForE164,
  isValidNationalPhoneNumber,
  nationalNumberFromE164,
  PHONE_COUNTRIES,
  type PhoneCountryCode,
} from "@workspace/api-client-react";

type Props = {
  value: string;
  onChangeText: (value: string) => void;
  testID?: string;
  accessibilityLabel?: string;
};

export default function PhoneNumberField({
  value,
  onChangeText,
  testID,
  accessibilityLabel = "Phone number",
}: Props) {
  const colors = useColors();
  const [countryCode, setCountryCode] = useState<PhoneCountryCode>(DEFAULT_PHONE_COUNTRY);
  const [nationalNumber, setNationalNumber] = useState("");
  const [countryPickerVisible, setCountryPickerVisible] = useState(false);

  useEffect(() => {
    if (/^\+[1-9]\d{7,14}$/.test(value)) {
      setCountryCode(getPhoneCountryForE164(value));
      setNationalNumber(nationalNumberFromE164(value));
    }
  }, [value]);

  const country = useMemo(() => getPhoneCountry(countryCode), [countryCode]);
  const isComplete = isValidNationalPhoneNumber(countryCode, nationalNumber);

  const updateNationalNumber = (input: string) => {
    const digits = input.replace(/\D/g, "").slice(0, country.nationalDigits);
    setNationalNumber(digits);
    onChangeText(digits ? `+${country.dialCode}${digits}` : "");
  };

  const selectCountry = (next: PhoneCountryCode) => {
    setCountryCode(next);
    setNationalNumber("");
    onChangeText("");
    setCountryPickerVisible(false);
  };

  const s = StyleSheet.create({
    row: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
    },
    inputRow: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 14,
    },
    countryButton: {
      minHeight: 48,
      paddingHorizontal: 10,
      borderRightWidth: 1,
      borderRightColor: colors.border,
      justifyContent: "center",
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    countryText: {
      color: colors.foreground,
      fontFamily: "PlusJakartaSans_500Medium",
      fontSize: 14,
    },
    input: {
      flex: 1,
      height: 48,
      fontSize: 15,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.foreground,
    },
    pickerOverlay: {
      flex: 1,
      justifyContent: "flex-end",
      backgroundColor: "rgba(0,0,0,0.45)",
    },
    picker: {
      maxHeight: "75%",
      backgroundColor: colors.card,
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      paddingTop: 16,
      paddingBottom: Platform.OS === "ios" ? 30 : 16,
    },
    pickerHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      paddingBottom: 12,
    },
    pickerTitle: {
      fontSize: 17,
      fontFamily: "PlusJakartaSans_700Bold",
      color: colors.foreground,
    },
    option: {
      minHeight: 48,
      paddingHorizontal: 20,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    optionText: {
      fontSize: 15,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.foreground,
    },
    helper: {
      marginTop: 5,
      fontSize: 12,
      fontFamily: "PlusJakartaSans_400Regular",
      color: isComplete ? colors.mutedForeground : colors.destructive,
    },
  });

  return (
    <>
      <View style={s.inputRow}>
        <View style={s.row}>
          <TouchableOpacity
            style={s.countryButton}
            onPress={() => setCountryPickerVisible(true)}
            accessibilityRole="button"
            accessibilityLabel={`Country code, currently ${country.name}`}
            testID={testID ? `${testID}-country` : undefined}
          >
            <Text style={s.countryText}>+{country.dialCode}</Text>
            <FeatherIcons name="chevron-down" size={14} color={colors.mutedForeground} />
          </TouchableOpacity>
          <TextInput
            style={s.input}
            value={nationalNumber}
            onChangeText={updateNationalNumber}
            placeholder={`${country.nationalDigits} digit number`}
            placeholderTextColor={colors.mutedForeground}
            keyboardType="number-pad"
            inputMode="numeric"
            maxLength={country.nationalDigits}
            autoComplete="tel"
            accessibilityLabel={accessibilityLabel}
            testID={testID}
          />
        </View>
      </View>
      <Text style={s.helper}>
        {nationalNumber
          ? `${nationalNumber.length}/${country.nationalDigits} digits`
          : `Select a country and enter ${country.nationalDigits} digits`}
      </Text>

      <Modal
        visible={countryPickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setCountryPickerVisible(false)}
      >
        <Pressable style={s.pickerOverlay} onPress={() => setCountryPickerVisible(false)}>
          <Pressable style={s.picker} onPress={(event) => event.stopPropagation()}>
            <View style={s.pickerHeader}>
              <Text style={s.pickerTitle}>Country code</Text>
              <TouchableOpacity
                onPress={() => setCountryPickerVisible(false)}
                accessibilityLabel="Close country code picker"
              >
                <FeatherIcons name="x" size={22} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>
            <ScrollView>
              {PHONE_COUNTRIES.map((option) => (
                <TouchableOpacity
                  key={option.code}
                  style={s.option}
                  onPress={() => selectCountry(option.code)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: option.code === countryCode }}
                >
                  <Text style={s.optionText}>{option.name}</Text>
                  <Text style={s.optionText}>+{option.dialCode}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}