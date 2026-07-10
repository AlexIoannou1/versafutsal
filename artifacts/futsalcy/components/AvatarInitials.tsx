import React from "react";
import { View, Text, StyleSheet } from "react-native";

interface Props {
  name: string;
  size?: number;
  fontSize?: number;
  backgroundColor?: string;
  color?: string;
}

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0][0].toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export default function AvatarInitials({
  name,
  size = 88,
  fontSize = 32,
  backgroundColor,
  color,
}: Props) {
  return (
    <View
      style={[
        styles.circle,
        { width: size, height: size, borderRadius: size / 2, backgroundColor },
      ]}
    >
      <Text style={[styles.text, { fontSize, color }]}>{getInitials(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    fontFamily: "PlusJakartaSans_700Bold",
  },
});
