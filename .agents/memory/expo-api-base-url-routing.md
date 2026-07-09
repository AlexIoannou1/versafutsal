---
name: Expo web API base URL routing
description: How to correctly point the Expo app at the API server in Replit's expo-domain routing setup, for both web and native.
---

## Rule
On web, auto-derive the API base URL by stripping `.expo.` from `window.location.hostname`. Do NOT rely on `EXPO_PUBLIC_DOMAIN` for web — it goes stale across Replit domain migrations.

For native (iOS/Android), `EXPO_PUBLIC_DOMAIN` in `artifacts/futsalcy/.env.local` is still used and **must be kept up to date** when Replit migrates domains. When the Replit host changes (e.g. picard→pike), update this value to the current `$REPLIT_DEV_DOMAIN`.

**Why:** The Expo app uses `router = "expo-domain"` in its artifact config, so it runs on `*.expo.<replit-host>`. The API server is on `*.<replit-host>` (no `.expo.`). Relative `/api/...` paths fetched from the Expo domain hit the wrong server. `EXPO_PUBLIC_DOMAIN` in `.env.local` hardcodes the host and breaks silently when Replit migrates domains. Web bypasses this by auto-deriving the hostname at runtime, but native has no `window.location` and relies entirely on `EXPO_PUBLIC_DOMAIN`.

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

**On domain migration:** Run `echo $REPLIT_DEV_DOMAIN` and paste the output into `.env.local` as `EXPO_PUBLIC_DOMAIN=<value>`. The current domain (as of 2026-07-09) is `55954ffe-e66f-485d-859a-0d4d1971ba5f-00-1xnbwuoie835v-g1qxhxpb.pike.replit.dev`.
