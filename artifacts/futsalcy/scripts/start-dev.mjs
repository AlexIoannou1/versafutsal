#!/usr/bin/env node
/**
 * Dev launcher for Expo Go on physical Android and iOS devices.
 *
 * Replit's artifact router exposes Metro at the artifact's HTTPS domain.
 * EXPO_PACKAGER_PROXY_URL tells Expo CLI to put that public URL in the
 * manifest and QR code. This avoids third-party tunnels, which can expire
 * or return 502s while Metro is still healthy.
 */
import { spawn } from "child_process";
import http from "http";
import { writeFileSync } from "fs";
import { createRequire } from "module";

const PORT = parseInt(process.env.PORT || "20728");
const replDomain = process.env.REPLIT_DEV_DOMAIN || "";
const replId = process.env.REPL_ID || "";
// The artifact service maps local Metro PORT (20728) to external HTTPS 3000.
// Keep the port explicit so Expo Go does not fall back to Replit's default
// HTTPS router, which may target a different service.
const publicBaseUrl = replDomain ? `https://${replDomain}:3000` : "";
// Replit's public router is TLS-only. `exp://` maps to plain HTTP in Expo Go,
// while `exps://` maps to HTTPS, so the QR must use the secure scheme.
const secureExpoUrl = replDomain ? `exps://${replDomain}:3000` : "";

if (!publicBaseUrl) {
  throw new Error("REPLIT_DEV_DOMAIN is required to start the Expo packager");
}

function printSecureExpoQr() {
  // qrcode-terminal is already bundled with the direct Expo CLI dependency.
  // Resolve it from Expo rather than adding another application dependency.
  const localRequire = createRequire(import.meta.url);
  const expoRequire = createRequire(localRequire.resolve("@expo/cli/package.json"));
  const qrcode = expoRequire("qrcode-terminal");
  process.stdout.write(`\n› Secure Expo Go link: ${secureExpoUrl}\n`);
  process.stdout.write("› Scan this HTTPS QR code with Expo Go (Android or iOS):\n");
  qrcode.generate(secureExpoUrl, { small: true });
}

writeFileSync(
  ".env.local",
  `EXPO_PUBLIC_DOMAIN=${replDomain}\nEXPO_PUBLIC_REPL_ID=${replId}\n`
);

// Use the public artifact URL for Expo's manifest, QR code, bundles, assets,
// and native log transport. No ngrok/Serveo process is required.
const expo = spawn(
  "pnpm",
  ["exec", "expo", "start", "--host", "lan", "--port", String(PORT)],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      EXPO_PACKAGER_PROXY_URL: publicBaseUrl,
    },
  }
);
expo.on("exit", (code) => process.exit(code ?? 0));
expo.on("error", (error) => {
  process.stderr.write(`[dev] Expo failed to start: ${error.message}\n`);
  process.exit(1);
});

// Pre-warm both platform bundles so the first device launch does not race
// Metro's initial dependency graph build.

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () =>
        resolve({ status: res.statusCode, body: Buffer.concat(chunks) })
      );
    });
    req.on("error", reject);
    req.setTimeout(0);
  });
}

async function prewarm() {
  process.stdout.write("[dev] Waiting for Metro...\n");
  for (;;) {
    try {
      const r = await get(`http://localhost:${PORT}/status`);
      if (r.status === 200) {
        // Expo CLI always labels its own QR as `exp://`, even when its
        // manifest uses an HTTPS proxy. Only print the safe equivalent once
        // Metro can answer a device request.
        printSecureExpoQr();
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 3000));
  }

  for (const platform of ["ios", "android"]) {
    process.stdout.write(`[dev] Reading ${platform} manifest...\n`);
    try {
      const r = await get(`http://localhost:${PORT}/`, {
        "Expo-Protocol-Version": "1",
        "Expo-Platform": platform,
        Accept: "application/expo+json,application/json",
        "User-Agent": `Expo Go ${platform}`,
      });
      const manifest = r.status === 200 ? JSON.parse(r.body.toString()) : null;
      const rawUrl = manifest?.launchAsset?.url;
      if (!rawUrl) {
        process.stderr.write(`[dev] ${platform} manifest has no launch asset\n`);
        continue;
      }

      const bundleUrl = new URL(rawUrl);
      bundleUrl.hostname = "localhost";
      bundleUrl.port = String(PORT);
      bundleUrl.protocol = "http:";
      process.stdout.write(`[dev] Pre-warming ${platform} bundle...\n`);
      const bundle = await get(bundleUrl.toString());
      const kb = Math.round(bundle.body.length / 1024);
      process.stdout.write(
        `[dev] ${platform} bundle ready (${kb} KB, HTTP ${bundle.status})\n`
      );
    } catch (e) {
      process.stderr.write(
        `[dev] ${platform} pre-warm error (non-fatal): ${e.message}\n`
      );
    }
  }
}

// Give Metro a head start before we start polling
setTimeout(prewarm, 8000);
