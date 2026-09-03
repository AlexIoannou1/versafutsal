import React, { createContext, useContext, useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

interface MotionContextValue {
  reduceMotion: boolean;
}

const MotionContext = createContext<MotionContextValue>({ reduceMotion: false });

export function MotionProvider({ children }: { children: React.ReactNode }) {
  // Default to stillness until the system preference has been read. This avoids
  // surprising motion during the first frame for people who need it reduced.
  const [reduceMotion, setReduceMotion] = useState(true);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return (
    <MotionContext.Provider value={{ reduceMotion }}>
      {children}
    </MotionContext.Provider>
  );
}

export function useMotion(): MotionContextValue {
  return useContext(MotionContext);
}