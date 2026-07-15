#!/usr/bin/env node
/**
 * Dev launcher: starts expo with --tunnel, then pre-warms the Android bundle
 * via localhost so it's cached before the user scans the QR code.
 *
 * The serveo tunnel drops idle HTTP connections — and Metro takes ~42 s to
 * compile Hermes bytecode for 1999 modules. By pre-warming via localhost
 * (no tunnel, no timeout), the bundle is cached and served in ~93ms when
 * Expo Go actually connects.
 */
import { spawn } from "child_process";
import http from "http";
import { writeFileSync } from "fs";

const PORT = parseInt(process.env.PORT || "20728");

const replDomain = process.env.REPLIT_DEV_DOMAIN || "";
const replId = process.env.REPL_ID || "";
writeFileSync(
  ".env.local",
  `EXPO_PUBLIC_DOMAIN=${replDomain}\nEXPO_PUBLIC_REPL_ID=${replId}\n`
);

// ── 1. Start expo --tunnel ──────────────────────────────────────────────────
const expo = spawn(
  "pnpm",
  ["exec", "expo", "start", "--tunnel", "--port", String(PORT)],
  { stdio: "inherit", env: process.env }
);
expo.on("exit", (code) => process.exit(code ?? 0));

// ── 2. Fetch the Expo manifest to discover the exact bundle URL ─────────────
// Then pre-warm that URL via localhost (bypassing the tunnel timeout).

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.setTimeout(0);
  });
}

async function prewarm() {
  // Wait for Metro to be ready
  process.stdout.write("[dev] Waiting for Metro...\n");
  for (;;) {
    try {
      const r = await get(`http://localhost:${PORT}/status`);
      if (r.status === 200) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 3000));
  }

  // Fetch the Expo manifest (same headers Expo Go sends) to get bundle URL
  process.stdout.write("[dev] Metro ready — reading manifest to find bundle URL...\n");
  let bundleUrl;
  try {
    const r = await get(`http://localhost:${PORT}/`, {
      "Expo-Protocol-Version": "1",
      "Expo-Platform": "android",
      Accept: "application/expo+json,application/json",
      "User-Agent": "Expo Go Android",
    });
    if (r.status === 200) {
      const manifest = JSON.parse(r.body.toString());
      const rawUrl = manifest?.launchAsset?.url;
      if (rawUrl) {
        // Replace the tunnel hostname with localhost for the pre-warm request
        const u = new URL(rawUrl);
        u.hostname = "localhost";
        u.port = String(PORT);
        u.protocol = "http:";
        bundleUrl = u.toString();
      }
    }
  } catch (e) {
    process.stderr.write(`[dev] Manifest fetch failed: ${e.message}\n`);
  }

  if (!bundleUrl) {
    process.stderr.write("[dev] Could not determine bundle URL — skipping pre-warm\n");
    return;
  }

  process.stdout.write(`[dev] Pre-warming: ${bundleUrl.slice(0, 80)}...\n`);
  try {
    const r = await get(bundleUrl);
    const kb = Math.round(r.body.length / 1024);
    process.stdout.write(`[dev] Android bundle cached (${kb} KB, HTTP ${r.status}) — QR code ready!\n`);
  } catch (e) {
    process.stderr.write(`[dev] Pre-warm error (non-fatal): ${e.message}\n`);
  }
}

// Give Metro a head start before we start polling
setTimeout(prewarm, 8000);
