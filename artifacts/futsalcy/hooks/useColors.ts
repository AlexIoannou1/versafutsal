import { useTheme } from "@/context/ThemeContext";
import colors from "@/constants/colors";

/**
 * Returns the design tokens for the current color scheme.
 *
 * Reads the resolved scheme from ThemeContext, which respects the user's
 * preference (Light / Dark / System default) stored in AsyncStorage.
 */
export function useColors() {
  const { resolvedScheme } = useTheme();
  const palette =
    resolvedScheme === "dark" && "dark" in colors ? colors.dark : colors.light;
  return { ...palette, radius: colors.radius };
}
