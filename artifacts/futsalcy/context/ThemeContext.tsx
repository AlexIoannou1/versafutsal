import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedScheme = "light" | "dark";

const STORAGE_KEY = "@futsalcy/theme";

interface ThemeContextValue {
  preference: ThemePreference;
  resolvedScheme: ResolvedScheme;
  setPreference: (p: ThemePreference) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>("system");

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((val) => {
      if (val === "light" || val === "dark" || val === "system") {
        setPreferenceState(val);
      }
    });
  }, []);

  const setPreference = useCallback(async (p: ThemePreference) => {
    setPreferenceState(p);
    await AsyncStorage.setItem(STORAGE_KEY, p);
  }, []);

  const resolvedScheme: ResolvedScheme =
    preference === "system"
      ? systemScheme === "dark"
        ? "dark"
        : "light"
      : preference;

  return (
    <ThemeContext.Provider value={{ preference, resolvedScheme, setPreference }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
