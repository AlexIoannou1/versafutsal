import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import FeatherIcons from "@/components/FeatherIcons";
import { useMotion } from "@/context/MotionContext";
import { useColors } from "@/hooks/useColors";

type DialogTone = "default" | "success" | "warning" | "danger" | "upgrade";
type DialogActionKind = "primary" | "secondary" | "destructive";

export type AppDialogAction = {
  label: string;
  kind?: DialogActionKind;
  onPress?: () => void;
};

export type AppDialogOptions = {
  title: string;
  message: string;
  tone?: DialogTone;
  actions?: AppDialogAction[];
  dismissible?: boolean;
};

export type ShowAppDialog = (options: AppDialogOptions) => void;

type AppDialogContextValue = {
  showDialog: ShowAppDialog;
  dismissDialog: () => void;
};

const AppDialogContext = createContext<AppDialogContextValue | null>(null);

const toneConfig: Record<DialogTone, { icon: "check-circle" | "alert-circle" | "x-circle" | "star"; colorKey: "primary" | "success" | "warning" | "destructive" }> = {
  default: { icon: "alert-circle", colorKey: "primary" },
  success: { icon: "check-circle", colorKey: "success" },
  warning: { icon: "alert-circle", colorKey: "warning" },
  danger: { icon: "x-circle", colorKey: "destructive" },
  upgrade: { icon: "star", colorKey: "primary" },
};

function AppDialog({
  dialog,
  onDismiss,
}: {
  dialog: AppDialogOptions | null;
  onDismiss: () => void;
}) {
  const colors = useColors();
  const { reduceMotion } = useMotion();
  const tone = dialog?.tone ?? "default";
  const config = toneConfig[tone];
  const accentColor = colors[config.colorKey];
  const actions = dialog?.actions?.length
    ? dialog.actions
    : [{ label: "OK", kind: "primary" as const }];

  const handleAction = (action: AppDialogAction) => {
    onDismiss();
    action.onPress?.();
  };

  const styles = StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: 24,
      backgroundColor: "rgba(15, 25, 35, 0.52)",
    },
    card: {
      width: "100%",
      maxWidth: 420,
      backgroundColor: colors.card,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 22,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.2,
      shadowRadius: 24,
      elevation: 12,
    },
    iconWrap: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 22,
      marginBottom: 14,
    },
    title: {
      color: colors.foreground,
      fontFamily: "PlusJakartaSans_700Bold",
      fontSize: 19,
      lineHeight: 25,
    },
    message: {
      color: colors.mutedForeground,
      fontFamily: "PlusJakartaSans_400Regular",
      fontSize: 14,
      lineHeight: 21,
      marginTop: 8,
    },
    actions: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: 10,
      marginTop: 22,
    },
    action: {
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 10,
      paddingHorizontal: 16,
      borderWidth: 1,
    },
    secondaryAction: {
      borderColor: colors.border,
      backgroundColor: colors.surfaceSecondary,
    },
    primaryAction: {
      borderColor: colors.primary,
      backgroundColor: colors.primary,
    },
    destructiveAction: {
      borderColor: colors.destructive,
      backgroundColor: colors.destructive,
    },
    secondaryText: {
      color: colors.foreground,
      fontFamily: "PlusJakartaSans_600SemiBold",
      fontSize: 13,
    },
    primaryText: {
      color: colors.primaryForeground,
      fontFamily: "PlusJakartaSans_600SemiBold",
      fontSize: 13,
    },
    destructiveText: {
      color: colors.destructiveForeground,
      fontFamily: "PlusJakartaSans_600SemiBold",
      fontSize: 13,
    },
  });

  return (
    <Modal
      visible={dialog !== null}
      transparent
      animationType={reduceMotion ? "none" : "fade"}
      onRequestClose={() => {
        if (dialog?.dismissible !== false) onDismiss();
      }}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => {
            if (dialog?.dismissible !== false) onDismiss();
          }}
          accessibilityLabel="Dismiss dialog"
        />
        {dialog && (
          <View
            style={styles.card}
            accessibilityViewIsModal
            accessibilityRole="alert"
            accessible
            accessibilityLabel={`${dialog.title}. ${dialog.message}`}
          >
            <View style={[styles.iconWrap, { backgroundColor: `${accentColor}1A` }]}>
              <FeatherIcons name={config.icon} size={22} color={accentColor} />
            </View>
            <Text style={styles.title}>{dialog.title}</Text>
            <Text style={styles.message}>{dialog.message}</Text>
            <View style={styles.actions}>
              {actions.map((action, index) => {
                const kind = action.kind ?? (index === actions.length - 1 ? "primary" : "secondary");
                const buttonStyle = kind === "destructive"
                  ? styles.destructiveAction
                  : kind === "primary"
                    ? styles.primaryAction
                    : styles.secondaryAction;
                const textStyle = kind === "destructive"
                  ? styles.destructiveText
                  : kind === "primary"
                    ? styles.primaryText
                    : styles.secondaryText;
                return (
                  <Pressable
                    key={`${action.label}-${index}`}
                    style={({ pressed }) => [
                      styles.action,
                      buttonStyle,
                      { opacity: pressed ? 0.78 : 1 },
                    ]}
                    onPress={() => handleAction(action)}
                    accessibilityRole="button"
                    accessibilityLabel={action.label}
                  >
                    <Text style={textStyle}>{action.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

export function AppDialogProvider({ children }: { children: React.ReactNode }) {
  const [dialog, setDialog] = useState<AppDialogOptions | null>(null);
  const dismissDialog = useCallback(() => setDialog(null), []);
  const showDialog = useCallback<ShowAppDialog>((options) => setDialog(options), []);
  const value = useMemo(() => ({ showDialog, dismissDialog }), [dismissDialog, showDialog]);

  return (
    <AppDialogContext.Provider value={value}>
      {children}
      <AppDialog dialog={dialog} onDismiss={dismissDialog} />
    </AppDialogContext.Provider>
  );
}

export function useAppDialog(): AppDialogContextValue {
  const context = useContext(AppDialogContext);
  if (!context) {
    throw new Error("useAppDialog must be used inside AppDialogProvider");
  }
  return context;
}