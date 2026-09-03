---
name: Expo physical-device packager routing
description: How Expo Go on physical Android and iOS devices reaches Metro running on Replit
---

## The stable route

The Expo artifact maps its local Metro port to external HTTPS port 3000. Use
Replit's dedicated Expo device domain when starting Expo CLI:

```text
EXPO_PACKAGER_PROXY_URL=https://<REPLIT_EXPO_DEV_DOMAIN>:3000
```

Expo's built-in QR can still display `exp://`, which Expo Go treats as plain
HTTP. Print and scan an `exps://<REPLIT_EXPO_DEV_DOMAIN>:3000` QR instead so Expo
Go stays on TLS. Both the Expo manifest and platform bundles are served by the Replit HTTPS router, so no
ngrok, Serveo, or localtunnel process is needed.

Keep Metro interactive for hot reload, but filter only the child CLI's default
QR output. Do not use CI mode to suppress the built-in QR: CI disables Metro
reloads.

## Why third-party tunnels are unsafe here

Metro can be healthy locally while a third-party tunnel URL returns HTTP 502.
Expo Go then reports that the packager is not running on both Android and iOS.

## Bundle delivery

Keep Metro's synchronous gzip middleware enabled. Expo Go sends
`Accept-Encoding: gzip`, and the public Replit route can deliver the compressed
bundle reliably to both platforms.

## inlineRequires
`config.transformer.inlineRequires = true` in metro.config.js prevents heavy modules (Stripe, datetimepicker) from being eagerly loaded at startup. Without it, the 1990-module bundle evaluates everything at startup.
