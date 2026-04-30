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
import { loginUser } from "@workspace/api-client-react";

const MODE_LABELS: Record<string, string> = {
  PLAYER: "Player",
  VENUE_OWNER: "Venue Owner",
  ADMIN: "Admin",
};

export default function LoginScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { selectedMode, login } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert("Missing fields", "Please enter your email and password.");
      return;
    }

    setLoading(true);
    try {
      const data = await loginUser({ email: email.trim().toLowerCase(), password });

      // Validate role matches selected mode
      if (data.user.role !== selectedMode) {
        const actualLabel = MODE_LABELS[data.user.role] || data.user.role;
        const selectedLabel = MODE_LABELS[selectedMode || ""] || selectedMode;
        Alert.alert(
          "Wrong mode",
          `This account is a ${actualLabel} account, but you selected ${selectedLabel} mode.\n\nGo back to switch mode or continue as ${actualLabel}.`,
          [
            { text: "Go back", onPress: () => router.back() },
            {
              text: `Continue as ${actualLabel}`,
              onPress: async () => {
                await login(
                  {
                    id: data.user.id,
                    email: data.user.email,
                    name: data.user.name,
                    role: data.user.role as any,
                  },
                  data.token,
                );
                router.replace("/");
              },
            },
          ],
        );
        return;
      }

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
        err?.data?.error || err?.message || "Login failed. Please try again.";
      Alert.alert("Login failed", message);
    } finally {
      setLoading(false);
    }
  };

  const s = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scroll: {
      flex: 1,
    },
    inner: {
      flex: 1,
      paddingHorizontal: 24,
      paddingTop:
        insets.top + (Platform.OS === "web" ? 67 : 20),
      paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 24),
    },
    backBtn: {
      marginBottom: 32,
    },
    heading: {
      marginBottom: 8,
    },
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
    field: {
      marginBottom: 16,
    },
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
    eyeBtn: {
      padding: 4,
    },
    loginBtn: {
      backgroundColor: loading ? colors.muted : colors.primary,
      borderRadius: 12,
      height: 52,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 8,
      marginBottom: 24,
    },
    loginText: {
      fontSize: 16,
      fontFamily: "Inter_600SemiBold",
      color: colors.primaryForeground,
    },
    divider: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginBottom: 24,
    },
    divLine: {
      flex: 1,
      height: 1,
      backgroundColor: colors.border,
    },
    divText: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    registerBtn: {
      alignItems: "center",
    },
    registerText: {
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    registerLink: {
      color: colors.primary,
      fontFamily: "Inter_600SemiBold",
    },
  });

  return (
    <View style={s.container}>
      <ScrollView style={s.scroll} contentContainerStyle={s.inner} keyboardShouldPersistTaps="handled">
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>

        <View style={s.heading}>
          <Text style={s.mode}>{MODE_LABELS[selectedMode || "PLAYER"] || "Player"} Mode</Text>
          <Text style={s.title}>Welcome back</Text>
          <Text style={s.subtitle}>Sign in to continue</Text>
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
              testID="login-email"
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
              placeholder="••••••••"
              placeholderTextColor={colors.mutedForeground}
              secureTextEntry={!showPassword}
              autoComplete="password"
              testID="login-password"
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
          style={s.loginBtn}
          onPress={handleLogin}
          disabled={loading}
          testID="login-submit"
        >
          <Text style={s.loginText}>{loading ? "Signing in…" : "Sign In"}</Text>
        </TouchableOpacity>

        <View style={s.divider}>
          <View style={s.divLine} />
          <Text style={s.divText}>or</Text>
          <View style={s.divLine} />
        </View>

        <TouchableOpacity
          style={s.registerBtn}
          onPress={() => router.push("/(auth)/register")}
          testID="go-register"
        >
          <Text style={s.registerText}>
            Don't have an account?{" "}
            <Text style={s.registerLink}>Create one</Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}
