import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { setAuthTokenGetter, setBaseUrl } from "@workspace/api-client-react";

export type AppMode = "PLAYER" | "VENUE_OWNER" | "ADMIN";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: AppMode;
  phoneNumber?: string | null;
}

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  selectedMode: AppMode | null;
  isLoaded: boolean;
}

interface AuthContextValue extends AuthState {
  selectMode: (mode: AppMode) => Promise<void>;
  login: (user: AuthUser, token: string) => Promise<void>;
  updateUser: (patch: Partial<AuthUser>) => Promise<void>;
  logout: () => Promise<void>;
}

const STORAGE_KEYS = {
  TOKEN: "@futsalcy/token",
  USER: "@futsalcy/user",
  MODE: "@futsalcy/mode",
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    token: null,
    selectedMode: null,
    isLoaded: false,
  });

  // Load persisted state on mount
  useEffect(() => {
    (async () => {
      try {
        const [token, userJson, mode] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.TOKEN),
          AsyncStorage.getItem(STORAGE_KEYS.USER),
          AsyncStorage.getItem(STORAGE_KEYS.MODE),
        ]);

        const user = userJson ? (JSON.parse(userJson) as AuthUser) : null;

        setState({
          user,
          token,
          selectedMode: (mode as AppMode) || null,
          isLoaded: true,
        });

        if (token) {
          setAuthTokenGetter(() => token);
        }
      } catch {
        setState((s) => ({ ...s, isLoaded: true }));
      }
    })();
  }, []);

  const selectMode = useCallback(async (mode: AppMode) => {
    await AsyncStorage.setItem(STORAGE_KEYS.MODE, mode);
    setState((s) => ({ ...s, selectedMode: mode }));
  }, []);

  const login = useCallback(async (user: AuthUser, token: string) => {
    await Promise.all([
      AsyncStorage.setItem(STORAGE_KEYS.TOKEN, token),
      AsyncStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user)),
      AsyncStorage.setItem(STORAGE_KEYS.MODE, user.role),
    ]);
    setAuthTokenGetter(() => token);
    setState((s) => ({
      ...s,
      user,
      token,
      selectedMode: user.role,
    }));
  }, []);

  /** Update user fields without touching the token or storage-mode. */
  const updateUser = useCallback(async (patch: Partial<AuthUser>) => {
    setState((s) => {
      if (!s.user) return s;
      const updated = { ...s.user, ...patch };
      // Persist updated user asynchronously (fire-and-forget)
      AsyncStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(updated)).catch(() => {});
      return { ...s, user: updated };
    });
  }, []);

  const logout = useCallback(async () => {
    await Promise.all([
      AsyncStorage.removeItem(STORAGE_KEYS.TOKEN),
      AsyncStorage.removeItem(STORAGE_KEYS.USER),
    ]);
    setAuthTokenGetter(null);
    setState((s) => ({ ...s, user: null, token: null }));
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, selectMode, login, updateUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
