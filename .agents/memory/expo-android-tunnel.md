---
name: Expo physical-device packager routing
description: How Expo Go on physical Android and iOS devices reaches Metro running on Replit
---

## The compatible route

Expo Go requests `exp://` development URLs over HTTP. Replit's normal and
dedicated Expo development routers are HTTPS-only, so they return 400 to that
request even while their HTTPS manifests and bundles are healthy.

Use a Cloudflare quick tunnel to Metro for development. Its public HTTP URL can
be passed to Expo CLI as `EXPO_PACKAGER_PROXY_URL`; Expo then prints a standard
`exp://<random>.trycloudflare.com` QR that Expo Go can load.

**Why:** `exps://` QR codes and Replit's HTTPS endpoints still caused Android
Expo Go to report “Packager is not running at http://…”. Expo's official ngrok
tunnel also failed upstream with remote connection errors in this workspace.

**How to apply:** start the quick tunnel before Expo, wait for its generated
URL, then start Expo with that HTTP proxy URL. The URL changes on every
restart, so scan only the current workflow QR. Quick tunnels are for
development, not production.

## Why third-party tunnels are unsafe here

Metro can be healthy locally while a third-party tunnel URL returns HTTP 502.
Expo Go then reports that the packager is not running on both Android and iOS.

## Bundle delivery

Keep Metro's synchronous gzip middleware enabled. Expo Go sends
`Accept-Encoding: gzip`, and the public Replit route can deliver the compressed
bundle reliably to both platforms.

## inlineRequires
`config.transformer.inlineRequires = true` in metro.config.js prevents heavy modules (Stripe, datetimepicker) from being eagerly loaded at startup. Without it, the 1990-module bundle evaluates everything at startup.
