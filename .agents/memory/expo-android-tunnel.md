---
name: Expo Android tunnel fix — Replit
description: How to make Expo Go on Android connect to Metro running on Replit (firewalled ports, ngrok broken)
---

## The problem
Replit only exposes port 80/443 externally. Metro runs on a high port (20728+).
Expo Go on Android can't reach that port directly.

## What was tried and why it failed

| Approach | Failure |
|---|---|
| `REACT_NATIVE_PACKAGER_HOSTNAME` | Metro still appends `:PORT` to QR URL; that port is firewalled |
| `expo start --tunnel` (ngrok v2 binary) | Replit's IP is blocked by ngrok — `ERR_NGROK_4018` / "remote gone away", even with Expo's own shared authtoken |
| localtunnel (loca.lt) | loca.lt shows an HTML "bypass verification" page to all new clients; Expo Go gets HTML instead of JSON manifest → "packager not running" |
| serveo with wrong domain regex | SSH parsed `console.serveo.net` (management URL) instead of the actual tunnel URL |
| Metro `enhanceMiddleware` to intercept manifest | Manifest at `/` is served by Expo CLI's own Express route, NOT Metro's internal middleware — `enhanceMiddleware` never fires for manifest requests |

## What works: serveo tunnel + manifest-rewriting proxy

### Port layout
```
20727 — our manifest-rewriting proxy  (what the serveo tunnel forwards to)
20728 — Expo CLI / Metro              (also Replit external port 3000)
```

### Tunnel (serveo SSH shim)
Patch `@expo/ngrok/index.js` at:
`node_modules/.pnpm/@expo+ngrok@4.1.3/node_modules/@expo/ngrok/index.js`

Key change: `-R 80:localhost:${port - 1}` (tunnel to proxy, not Metro directly)

Serveo SSH output format:
```
Forwarding HTTP traffic from https://HASH-IP.serveousercontent.com
```
- Domain is `serveousercontent.com` (NOT `serveo.net`)
- Must match "Forwarding HTTP traffic from" prefix to skip the `console.serveo.net` management URL

Correct regex: `/Forwarding HTTP traffic from (https?:\/\/[a-zA-Z0-9.-]+\.serveo(?:usercontent)?\.(?:com|net))/i`

### Manifest-rewriting proxy (start-dev.mjs)
The proxy on 20727 intercepts Expo manifest requests and rewrites `launchAsset.url` and `assets[].url` from `http://TUNNEL_HOST/...` to `https://REPLIT_DEV_DOMAIN:3000/...`:
- Android then downloads the bundle/assets via Replit's standard HTTPS proxy (port 3000 → local 20728)
- No tunnel size limits, no SSH bandwidth bottleneck, built-in gzip
- WebSocket upgrades are also proxied (for HMR/logging)

### Why the manifest must be intercepted separately
Expo CLI's manifest endpoint (`GET /` with `Accept: application/expo+json`) is handled by Expo CLI's own Express route, which runs BEFORE Metro's internal `enhanceMiddleware`. There is no way to intercept it via `metro.config.js`.

### Bundle URL routing
After manifest rewrite:
- `https://REPLIT_DEV_DOMAIN:3000/...entry.bundle?...` → Replit proxy → local 20728 (Metro)
- Our `metro.config.js` gzip middleware fires here (OkHttp/4.12.0 sends `Accept-Encoding: gzip`)
- 13 MB bundle → 2.2 MB (83% reduction)

**Why:** Replit external port 3000 maps to local port 20728 (`.replit`: `[[ports]] localPort=20728 externalPort=3000`). This is confirmed working from external: `https://REPLIT_DEV_DOMAIN:3000/status` returns 200.

## Gzip compression (metro.config.js enhanceMiddleware)

OkHttp 4.12.0 (Expo Go Android) sends `Accept-Encoding: gzip` for all requests.
Our gzip middleware intercepts `.bundle` URLs with gzip, buffers the full response, gzips, updates headers.
**Must use gzipSync** (not async) — async version causes "Cannot remove headers after they are sent" because there's a gap where Metro may flush headers during the async callback.
**Must suppress res.writeHead** during buffering to prevent Content-Length being committed before we gzip.

## patch persistence
The `@expo/ngrok` patch is NOT persisted across `pnpm install`. Must re-apply after any install.
The patch lives at the workspace root: `node_modules/.pnpm/@expo+ngrok@4.1.3/node_modules/@expo/ngrok/index.js`

## inlineRequires
`config.transformer.inlineRequires = true` in metro.config.js prevents heavy modules (Stripe, datetimepicker) from being eagerly loaded at startup. Without it, the 1990-module bundle evaluates everything at startup.
