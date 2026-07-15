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
| serveo with wrong regex prefix | timed out because regex required "Forwarding HTTP traffic from" but we also needed `serveousercontent.com` not `serveo.net` |

## What works: SSH tunnel via serveo.net

**Root cause fix:** Patch `@expo/ngrok/index.js` (at `node_modules/.pnpm/@expo+ngrok@4.1.3/node_modules/@expo/ngrok/index.js`) to use SSH + serveo.net instead of the ngrok binary.

**Why:** Expo CLI's `--tunnel` flag calls `instance.connect({port, ...})` from `@expo/ngrok` and uses the returned URL as the full QR code URL — no port appended. Serveo creates clean `https://xxx.serveousercontent.com` URLs via SSH, no auth/registration/bypass needed.

**Serveo SSH output format:**
```
Pseudo-terminal will not be allocated because stdin is not a terminal.
Forwarding HTTP traffic from https://HASH-IP.serveousercontent.com
```
- Domain is `serveousercontent.com` (NOT `serveo.net`)  
- Must match "Forwarding HTTP traffic from" prefix to skip the `console.serveo.net` management URL that appears first

**Correct regex:** `/Forwarding HTTP traffic from (https?:\/\/[a-zA-Z0-9.-]+\.serveo(?:usercontent)?\.(?:com|net))/i`

**SSH command:**
```
ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -R 80:localhost:$PORT serveo.net
```

**Dev script in package.json:**
```
"dev": "printf 'EXPO_PUBLIC_DOMAIN=%s\\nEXPO_PUBLIC_REPL_ID=%s\\n' \"$REPLIT_DEV_DOMAIN\" \"$REPL_ID\" > .env.local && pnpm exec expo start --tunnel --port $PORT"
```

## Bundle size fix

The `@expo/ngrok` patch is NOT persisted across `pnpm install`. Must re-apply after any install.

Added to `metro.config.js` to fix "stuck on bundling" over slow tunnel:
```js
config.transformer = config.transformer || {};
config.transformer.inlineRequires = true;
```
This lazy-loads modules so initial bundle is much smaller (only first screen's modules).

**Why:** 1999 modules take ~44s to compile + large transfer over tunnel. Inline requires sends only ~200 modules initially, rest loaded on demand.
