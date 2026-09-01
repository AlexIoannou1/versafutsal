import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { assessNewPassword } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";

interface PasswordStrengthMeterProps {
  password: string;
}

const strengthLabels = {
  invalid: "Not accepted",
  weak: "Weak",
  fair: "Fair",
  good: "Good",
  strong: "Strong",
} as const;

const filledSegments = {
  invalid: 0,
  weak: 1,
  fair: 2,
  good: 3,
  strong: 4,
} as const;

export default function PasswordStrengthMeter({ password }: PasswordStrengthMeterProps) {
  const colors = useColors();
  const assessment = assessNewPassword(password);
  const label = password.length === 0 ? "Password guidance" : strengthLabels[assessment.strength];
  const color = assessment.accepted ? colors.primary : colors.destructive;
  const summary = `${label}. ${assessment.guidance}`;

  return (
    <View
      style={styles.container}
      accessibilityRole="text"
      accessibilityLabel={summary}
      accessibilityLiveRegion="polite"
    >
      <View style={styles.header}>
        <Text style={[styles.label, { color }]}>{label}</Text>
        <Text style={[styles.guidance, { color: assessment.accepted ? colors.mutedForeground : colors.destructive }]}>
          {assessment.guidance}
        </Text>
      </View>
      <View style={styles.meter} accessibilityElementsHidden>
        {[0, 1, 2, 3].map((segment) => (
          <View
            key={segment}
            style={[
              styles.segment,
              { backgroundColor: segment < filledSegments[assessment.strength] ? color : colors.border },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 8 },
  header: { gap: 2 },
  label: { fontFamily: "PlusJakartaSans_600SemiBold", fontSize: 12 },
  guidance: { fontFamily: "PlusJakartaSans_400Regular", fontSize: 12, lineHeight: 17 },
  meter: { flexDirection: "row", gap: 4, marginTop: 7 },
  segment: { flex: 1, height: 4, borderRadius: 2 },
});