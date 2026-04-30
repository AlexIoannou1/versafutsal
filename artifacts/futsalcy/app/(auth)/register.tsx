import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  Platform,
  ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { registerUser } from "@workspace/api-client-react";

const MODE_LABELS: Record<string, string> = {
  PLAYER: "Player",
  VENUE_OWNER: "Venue Owner",
  ADMIN: "Admin",
};

export default function RegisterScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { selectedMode, login } = useAuth();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    if (!name.trim() || !email.trim() || !password.trim()) {
      Alert.alert("Missing fields", "Please fill in all fields.");
      return;
    }
    if (password.length < 6) {
      Alert.alert("Weak password", "Password must be at least 6 characters.");
      return;
    }

    setLoading(true);
    try {
      const data = await registerUser({
        email: email.trim().toLowerCase(),
        password,
        name: name.trim(),
        role: selectedMode || "PLAYER",
      });

      await login(
        {
          id: data.user.id,
          email: data.user.email,
          name: data.user.name,
          role: data.user.role as any,
        },
        data.token,
      );
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/");
    } catch (err: any) {
      const message =
        err?.data?.error || err?.message || "Registration failed. Please try again.";
      Alert.alert("Error", message);
    } finally {
      setLoading(false);
    }
  };

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scroll: { flex: 1 },
    inner: {
      flex: 1,
      paddingHorizontal: 24,
      paddingTop: insets.top + (Platform.OS === "web" ? 67 : 20),
      paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 24),
    },
    backBtn: { marginBottom: 32 },
    mode: {
      fontSize: 13,
      fontFamily: "Inter_500Medium",
      color: colors.primary,
      marginBottom: 4,
      textTransform: "uppercase",
      letterSpacing: 1,
    },
    title: {
      fontSize: 28,
      fontFamily: "Inter_700Bold",
      color: colors.foreground,
      marginBottom: 8,
    },
    subtitle: {
      fontSize: 15,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      marginBottom: 32,
    },
    field: { marginBottom: 16 },
    label: {
      fontSize: 13,
      fontFamily: "Inter_500Medium",
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
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
    },
    eyeBtn: { padding: 4 },
    submitBtn: {
      backgroundColor: loading ? colors.muted : colors.primary,
      borderRadius: 12,
      height: 52,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 8,
      marginBottom: 24,
    },
    submitText: {
      fontSize: 16,
      fontFamily: "Inter_600SemiBold",
      color: colors.primaryForeground,
    },
    loginLink: { alignItems: "center" },
    loginText: {
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    loginBold: {
      color: colors.primary,
      fontFamily: "Inter_600SemiBold",
    },
  });

  return (
    <View style={s.container}>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.inner}
        keyboardShouldPersistTaps="handled"
      >
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>

        <Text style={s.mode}>{MODE_LABELS[selectedMode || "PLAYER"] || "Player"} Mode</Text>
        <Text style={s.title}>Create account</Text>
        <Text style={s.subtitle}>Join FutsalCY and start booking</Text>

        <View style={s.field}>
          <Text style={s.label}>Full name</Text>
          <View style={s.inputRow}>
            <TextInput
              style={s.input}
              value={name}
              onChangeText={setName}
              placeholder="Your name"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="words"
              testID="register-name"
            />
          </View>
        </View>

        <View style={s.field}>
          <Text style={s.label}>Email</Text>
          <View style={s.inputRow}>
            <TextInput
              style={s.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              testID="register-email"
            />
          </View>
        </View>

        <View style={s.field}>
          <Text style={s.label}>Password</Text>
          <View style={s.inputRow}>
            <TextInput
              style={s.input}
              value={password}
              onChangeText={setPassword}
              placeholder="Min. 6 characters"
              placeholderTextColor={colors.mutedForeground}
              secureTextEntry={!showPassword}
              testID="register-password"
            />
            <TouchableOpacity
              style={s.eyeBtn}
              onPress={() => setShowPassword((v) => !v)}
            >
              <Feather
                name={showPassword ? "eye-off" : "eye"}
                size={18}
                color={colors.mutedForeground}
              />
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity
          style={s.submitBtn}
          onPress={handleRegister}
          disabled={loading}
          testID="register-submit"
        >
          <Text style={s.submitText}>{loading ? "Creating account…" : "Create Account"}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={s.loginLink}
          onPress={() => router.back()}
        >
          <Text style={s.loginText}>
            Already have an account? <Text style={s.loginBold}>Sign in</Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}
