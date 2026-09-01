import React, { useEffect, useState } from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  assessNewPassword,
  confirmPasswordReset,
  requestPasswordReset,
  validateRequestBody,
  validationMessage,
} from "@workspace/api-client-react";
import FeatherIcons from "@/components/FeatherIcons";
import PasswordStrengthMeter from "@/components/PasswordStrengthMeter";
import { useColors } from "@/hooks/useColors";

export default function ResetPasswordScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const hasMultipleTokens = Array.isArray(params.token);
  const rawToken = hasMultipleTokens ? params.token?.[0] : params.token;
  const token = typeof rawToken === "string" ? rawToken.trim() : undefined;
  const isConfirming = rawToken !== undefined;
  const hasValidToken = Boolean(
    !hasMultipleTokens && token && /^[A-Za-z0-9_-]{40,60}$/.test(token),
  );

  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    if (!isConfirming || hasValidToken) return;
    setError("This password reset link is invalid or incomplete. Request a new link.");
  }, [hasValidToken, isConfirming]);

  useEffect(() => {
    if (!completed) return;
    const timer = setTimeout(() => {
      router.replace("/(auth)/login");
    }, 1_500);
    return () => clearTimeout(timer);
  }, [completed, router]);

  const handleRequest = async () => {
    setError(null);
    setMessage(null);
    const payload = { email: email.trim().toLowerCase() };
    const validation = validateRequestBody<typeof payload>(
      "POST",
      "/api/auth/password-reset/request",
      payload,
    );
    if (!validation.success) {
      setError(validationMessage(validation.issues[0]!));
      return;
    }

    setLoading(true);
    try {
      const response = await requestPasswordReset(validation.data);
      setMessage(response.message);
    } catch {
      setError("We couldn't process that request right now. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    setError(null);
    setMessage(null);
    if (!token || !hasValidToken) {
      setError("This password reset link is invalid or incomplete. Request a new link.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    const assessment = assessNewPassword(newPassword);
    if (!assessment.accepted) {
      setError(assessment.guidance);
      return;
    }

    const payload = { token, newPassword };
    const validation = validateRequestBody<typeof payload>(
      "POST",
      "/api/auth/password-reset/confirm",
      payload,
    );
    if (!validation.success) {
      setError(validationMessage(validation.issues[0]!));
      return;
    }

    setLoading(true);
    try {
      await confirmPasswordReset(validation.data);
      setMessage("Your password has been reset. You can now sign in with your new password.");
      setCompleted(true);
    } catch {
      setError("This password reset link is invalid or has expired. Request a new link.");
    } finally {
      setLoading(false);
    }
  };

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: {
      flexGrow: 1,
      paddingHorizontal: 24,
      paddingTop: insets.top + (Platform.OS === "web" ? 67 : 20),
      paddingBottom: insets.bottom + 24,
    },
    backButton: { width: 44, height: 44, justifyContent: "center", marginBottom: 20 },
    title: {
      fontSize: 28,
      fontFamily: "PlusJakartaSans_700Bold",
      color: colors.foreground,
      marginBottom: 8,
    },
    subtitle: {
      fontSize: 15,
      lineHeight: 22,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.mutedForeground,
      marginBottom: 28,
    },
    banner: {
      borderRadius: 10,
      borderWidth: 1,
      padding: 12,
      marginBottom: 18,
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
    },
    bannerText: {
      flex: 1,
      fontSize: 13,
      lineHeight: 18,
      fontFamily: "PlusJakartaSans_500Medium",
    },
    field: { marginBottom: 16 },
    label: {
      fontSize: 13,
      fontFamily: "PlusJakartaSans_500Medium",
      color: colors.foreground,
      marginBottom: 6,
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
    input: {
      flex: 1,
      height: 48,
      fontSize: 15,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.foreground,
    },
    eyeButton: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
    primaryButton: {
      height: 52,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 8,
      backgroundColor: loading ? colors.muted : colors.primary,
    },
    primaryText: {
      fontSize: 16,
      fontFamily: "PlusJakartaSans_600SemiBold",
      color: colors.primaryForeground,
    },
    secondaryButton: {
      minHeight: 48,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 12,
    },
    secondaryText: {
      fontSize: 14,
      fontFamily: "PlusJakartaSans_600SemiBold",
      color: colors.primary,
    },
  });

  const banner = error ?? message;
  const isError = Boolean(error);

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <FeatherIcons name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>

        <Text style={styles.title}>
          {isConfirming && !hasValidToken
            ? "Reset link unavailable"
            : isConfirming
              ? "Choose a new password"
              : "Reset your password"}
        </Text>
        <Text style={styles.subtitle}>
          {isConfirming && !hasValidToken
            ? "This recovery link is incomplete or malformed. Request a new link and use the most recent email."
            : isConfirming
            ? "Create a secure password for your player account."
            : "Enter your player email. If an active account exists, we'll send a time-limited reset link."}
        </Text>

        {banner && (
          <View
            style={[
              styles.banner,
              {
                backgroundColor: (isError ? colors.destructive : colors.success) + "18",
                borderColor: (isError ? colors.destructive : colors.success) + "40",
              },
            ]}
            accessibilityLiveRegion="polite"
          >
            <FeatherIcons
              name={isError ? "alert-circle" : "check-circle"}
              size={16}
              color={isError ? colors.destructive : colors.success}
            />
            <Text
              style={[
                styles.bannerText,
                { color: isError ? colors.destructive : colors.success },
              ]}
            >
              {banner}
            </Text>
          </View>
        )}

          {isConfirming && hasValidToken ? (
          <>
            <View style={styles.field}>
              <Text style={styles.label}>New password</Text>
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.input}
                  value={newPassword}
                  onChangeText={(value) => {
                    setNewPassword(value);
                    setError(null);
                  }}
                  secureTextEntry={!showPassword}
                  autoComplete="new-password"
                  textContentType="newPassword"
                  maxLength={256}
                  accessibilityLabel="New password"
                  testID="reset-new-password"
                />
                <TouchableOpacity
                  style={styles.eyeButton}
                  onPress={() => setShowPassword((value) => !value)}
                  accessibilityRole="button"
                  accessibilityLabel={showPassword ? "Hide password" : "Show password"}
                >
                  <FeatherIcons
                    name={showPassword ? "eye-off" : "eye"}
                    size={18}
                    color={colors.mutedForeground}
                  />
                </TouchableOpacity>
              </View>
              <PasswordStrengthMeter password={newPassword} />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Confirm new password</Text>
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.input}
                  value={confirmPassword}
                  onChangeText={(value) => {
                    setConfirmPassword(value);
                    setError(null);
                  }}
                  secureTextEntry={!showPassword}
                  autoComplete="new-password"
                  textContentType="newPassword"
                  maxLength={256}
                  accessibilityLabel="Confirm new password"
                  testID="reset-confirm-password"
                />
              </View>
            </View>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleConfirm}
              disabled={loading || completed}
              accessibilityRole="button"
              testID="reset-password-submit"
            >
              <Text style={styles.primaryText}>
                {loading ? "Resetting…" : "Reset password"}
              </Text>
            </TouchableOpacity>
          </>
          ) : !isConfirming ? (
          <>
            <View style={styles.field}>
              <Text style={styles.label}>Email</Text>
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={(value) => {
                    setEmail(value);
                    setError(null);
                    setMessage(null);
                  }}
                  placeholder="you@example.com"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  maxLength={254}
                  testID="reset-email"
                />
              </View>
            </View>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleRequest}
              disabled={loading}
              accessibilityRole="button"
              testID="request-reset-submit"
            >
              <Text style={styles.primaryText}>
                {loading ? "Sending…" : "Send reset link"}
              </Text>
            </TouchableOpacity>
          </>
          ) : null}

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() =>
            router.replace(isConfirming && !hasValidToken ? "/(auth)/reset-password" : "/(auth)/login")
          }
          accessibilityRole="button"
        >
          <Text style={styles.secondaryText}>
            {isConfirming && !hasValidToken
              ? "Request a new link"
              : message && isConfirming
                ? "Go to sign in now"
                : "Back to sign in"}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}