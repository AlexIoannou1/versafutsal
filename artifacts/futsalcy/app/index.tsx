import { Redirect } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { ActivityIndicator, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useListOwnerVenues } from "@workspace/api-client-react";
import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ONBOARDING_STATUS_KEY, type OnboardingStatus } from "./owner/onboarding";

function OwnerRedirect() {
  const colors = useColors();
  const { data, isLoading: venuesLoading } = useListOwnerVenues();
  const [status, setStatus] = useState<OnboardingStatus | null | "loading">("loading");

  useEffect(() => {
    AsyncStorage.getItem(ONBOARDING_STATUS_KEY)
      .then((val) => setStatus((val as OnboardingStatus) ?? null))
      .catch(() => setStatus(null));
  }, []);

  if (venuesLoading || status === "loading") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  const hasVenues = (data?.venues?.length ?? 0) > 0;

  // Venue existence always wins: once there's at least one venue the owner is
  // past the onboarding gate. Normalize any stale status so they never get
  // redirected to onboarding again.
  if (hasVenues) {
    if (status !== "completed") {
      AsyncStorage.setItem(ONBOARDING_STATUS_KEY, "completed").catch(() => {});
    }
    return <Redirect href="/(owner)" />;
  }

  // No venues — decide based on explicit onboarding status
  if (status === "completed") {
    // Completed but no venues (edge case: venue was deleted). Route to dashboard;
    // the owner can create a new venue through the normal flow.
    return <Redirect href="/(owner)" />;
  }

  if (status === "in_progress") {
    // Skipped mid-flow. Dashboard will show the resume banner.
    return <Redirect href="/(owner)" />;
  }

  // null — brand new owner who has never entered onboarding.
  return <Redirect href={"/owner/onboarding" as never} />;
}

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
    return <OwnerRedirect />;
  }

  if (user.role === "ADMIN") {
    return <Redirect href="/(admin)" />;
  }

  return <Redirect href="/(player)" />;
}
