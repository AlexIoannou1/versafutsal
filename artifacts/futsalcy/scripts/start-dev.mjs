#!/usr/bin/env node
/**
 * Dev launcher for Expo Go on physical Android and iOS devices.
 *
 * Expo Go requests `exp://` packagers over HTTP. Replit's development router
 * is HTTPS-only, so use a short-lived Cloudflare development tunnel to supply
 * Expo Go with a compatible public HTTP address.
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

function startTunnel() {
  return new Promise((resolve, reject) => {
    const cloudflared = spawn(
      "cloudflared",
      ["tunnel", "--url", `http://127.0.0.1:${PORT}`, "--no-autoupdate"],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let output = "";
    let connected = false;
    const timeout = setTimeout(() => {
      cloudflared.kill("SIGTERM");
      reject(new Error("Cloudflare tunnel did not provide a public URL within 45 seconds"));
    }, 45_000);

    const capture = (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(`[tunnel] ${text}`);
      const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (match && !connected) {
        connected = true;
        clearTimeout(timeout);
        resolve({ cloudflared, publicUrl: match[0] });
      }
    };

    cloudflared.stdout.on("data", capture);
    cloudflared.stderr.on("data", capture);
    cloudflared.on("error", (error) => {
      clearTimeout(timeout);
      reject(new Error(`Cloudflare tunnel failed to start: ${error.message}`));
    });
    cloudflared.on("exit", (code) => {
      if (!connected) {
        clearTimeout(timeout);
        reject(new Error(`Cloudflare tunnel exited before connecting (code ${code ?? "unknown"})`));
      }
    });
  });
}

async function startExpo() {
  const { cloudflared, publicUrl } = await startTunnel();
  // Cloudflare serves this quick-tunnel URL over HTTP, which makes Expo CLI's
  // standard `exp://` QR usable by Expo Go.
  const expo = spawn(
    "pnpm",
    ["exec", "expo", "start", "--host", "lan", "--port", String(PORT)],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        EXPO_PACKAGER_PROXY_URL: publicUrl.replace(/^https:/, "http:"),
      },
    }
  );
  expo.on("exit", (code) => {
    cloudflared.kill("SIGTERM");
    process.exit(code ?? 0);
  });
  expo.on("error", (error) => {
    cloudflared.kill("SIGTERM");
    process.stderr.write(`[dev] Expo failed to start: ${error.message}\n`);
    process.exit(1);
  });
  cloudflared.on("exit", (code) => {
    if (!expo.killed && code !== 0) {
      process.stderr.write("[dev] Cloudflare tunnel closed; restarting Expo is required.\n");
      expo.kill("SIGTERM");
    }
  });
}

startExpo().catch((error) => {
  process.stderr.write(`[dev] ${error.message}\n`);
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
