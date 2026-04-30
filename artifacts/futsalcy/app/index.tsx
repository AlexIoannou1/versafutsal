import { Redirect } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { ActivityIndicator, View } from "react-native";
import { useColors } from "@/hooks/useColors";

export default function RootIndex() {
  const { user, selectedMode, isLoaded } = useAuth();
  const colors = useColors();

  if (!isLoaded) {
    return (
      <View
        style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}
      >
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!user) {
    return <Redirect href="/(auth)/mode-select" />;
  }

  if (user.role === "VENUE_OWNER") {
    return <Redirect href="/(owner)" />;
  }

  if (user.role === "ADMIN") {
    return <Redirect href="/(admin)" />;
  }

  return <Redirect href="/(player)" />;
}
