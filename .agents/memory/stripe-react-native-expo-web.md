---
name: Stripe React Native — Expo web bundling workaround
description: How to use @stripe/stripe-react-native in an Expo app without breaking the web bundler
---

## Rule
Never import `@stripe/stripe-react-native` directly in a file that Expo Router's `require.context` will compile for web.  Create a platform-specific shim pair instead:

- `lib/stripe-native.native.ts` → `export { StripeProvider, useStripe } from "@stripe/stripe-react-native";`
- `lib/stripe-native.ts` → stub implementations for web

Then import `@/lib/stripe-native` everywhere; Metro resolves the correct file per platform.

**Why:** Expo Router's `require.context` compiles ALL `app/` files for web, even files with a `.web.tsx` counterpart, so the native Stripe import causes bundler errors. Platform file extensions only work for modules imported via a non-context path.

**How to apply:** Any native-only SDK (Stripe, camera, etc.) used inside an Expo Router screen must go through a `.native.ts` / `.ts` shim in a non-`app/` directory.

## App.json plugin config
The `@stripe/stripe-react-native` plugin requires explicit options; bare string fails:
```json
["@stripe/stripe-react-native", { "merchantIdentifier": "merchant.com.futsalcy", "enableGooglePay": false }]
```
Without `merchantIdentifier`, the plugin throws `TypeError: Cannot read properties of undefined (reading 'merchantIdentifier')` and Expo refuses to start.

## Version note
Stripe SDK `0.68.0` was installed; Expo recommends `0.50.3` for SDK 54. The app still runs — the version mismatch warning appears on startup but is non-fatal.
