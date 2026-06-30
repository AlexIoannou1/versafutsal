---
name: Feather icons Android Expo Go fix
description: How to fix boxed-X / invisible Feather icons on Android Expo Go SDK 54 with new architecture
---

## The Rule
Do NOT use `{ Feather } from "@expo/vector-icons"` or `...Feather.font` in `useFonts` for Expo Go on Android.
Use a custom icon set created with `createIconSet` under a unique font family name, with the TTF copied into the app's own `assets/fonts/` directory.

**Why:**
Expo Go's Android binary pre-registers all `@expo/vector-icons` fonts at startup (e.g. `'feather'`).
`expo-font`'s `loadAsync` checks `if (isLoaded(fontFamily)) return;` and **skips loading** when the font
name is already registered — even if Expo Go's bundled version is outdated/mismatched for the current
`@expo/vector-icons` version (v15 changed glyph code points vs earlier bundled versions).
Additionally, requiring a TTF from `node_modules` via `Asset.fromModule()` can fail silently on Android
new arch + Expo Go; using app-owned assets in `assets/fonts/` is reliably bundled by Metro.

**How to apply:**
1. Copy TTF to `assets/fonts/Feather.ttf` (from node_modules vendor path)
2. Create `components/FeatherIcons.tsx` using `createIconSet` from `@expo/vector-icons/build/createIconSet`
   with font name `'FeatherIcons'` (unique, not pre-registered) and `require('../assets/fonts/Feather.ttf')`
3. Load in root `useFonts`: `{ FeatherIcons: require('../assets/fonts/Feather.ttf') }`
4. Replace all `import { Feather } from "@expo/vector-icons"` with `import FeatherIcons from "@/components/FeatherIcons"`
5. Replace all JSX `<Feather` with `<FeatherIcons` (same props/icon names — same glyph map)
6. Fix type annotations: `typeof Feather>` → `typeof FeatherIcons>`, `typeof Feather.glyphMap` → `typeof FeatherIcons.glyphMap`
