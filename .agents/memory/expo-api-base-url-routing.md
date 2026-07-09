---
name: Expo web API base URL routing
description: How to correctly point the Expo web app at the API server in Replit's expo-domain routing setup.
---

## Rule
On web, auto-derive the API base URL by stripping `.expo.` from `window.location.hostname`. Do NOT rely on `EXPO_PUBLIC_DOMAIN` for web — it goes stale across Replit domain migrations.

**Why:** The Expo app uses `router = "expo-domain"` in its artifact config, so it runs on `*.expo.<replit-host>`. The API server is on `*.<replit-host>` (no `.expo.`). Relative `/api/...` paths fetched from the Expo domain hit the wrong server. `EXPO_PUBLIC_DOMAIN` in `.env.local` hardcodes the host and breaks silently when Replit migrates domains (e.g. picard→pike).

**How to apply:** In `artifacts/futsalcy/app/_layout.tsx`, the setup block is:
```typescript
if (Platform.OS === "web" && typeof window !== "undefined") {
  const hostname = window.location.hostname;
  const apiHostname = hostname.replace(/\.expo\./, ".");
  setBaseUrl(`${window.location.protocol}//${apiHostname}`);
} else if (process.env.EXPO_PUBLIC_DOMAIN) {
  setBaseUrl(`https://${process.env.EXPO_PUBLIC_DOMAIN}`);
}
```
Keep this pattern. Never set `setBaseUrl` unconditionally from `EXPO_PUBLIC_DOMAIN` — that breaks web.
