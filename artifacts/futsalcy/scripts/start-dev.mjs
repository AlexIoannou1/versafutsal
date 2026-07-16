#!/usr/bin/env node
/**
 * Dev launcher: starts expo with --tunnel, adds a manifest-rewriting proxy,
 * and pre-warms the Android bundle via localhost.
 *
 * Architecture:
 *   Expo Go → tunnel → proxy (PORT-1=20727) → intercepts manifest
 *                                            → rewrites bundle/asset URLs
 *                                            → transparent proxy for everything else → Metro (PORT=20728)
 *
 *   Expo Go → https://REPLIT_DEV_DOMAIN:3000/...entry.bundle → Replit proxy → Metro (20728)
 *           → fast HTTPS download — no tunnel bottleneck!
 *
 * The @expo/ngrok shim is patched to tunnel PORT-1 (not PORT), so the SSH
 * tunnel connects Expo Go to our proxy, not directly to Metro.
 * Metro stays on PORT (20728), also accessible via Replit's external port 3000.
 *
 * The proxy rewrites launchAsset.url and asset URLs from the manifest so
 * Android downloads the bundle/assets over Replit's standard HTTPS proxy
 * (external port 3000 → local 20728) instead of the slow SSH tunnel.
 */
import { spawn } from "child_process";
import http from "http";
import net from "net";
import { writeFileSync } from "fs";

const PORT = parseInt(process.env.PORT || "20728");
const PROXY_PORT = PORT - 1; // 20727 — what the tunnel forwards to

const replDomain = process.env.REPLIT_DEV_DOMAIN || "";
const replId = process.env.REPL_ID || "";
writeFileSync(
  ".env.local",
  `EXPO_PUBLIC_DOMAIN=${replDomain}\nEXPO_PUBLIC_REPL_ID=${replId}\n`
);

// ── 1. Manifest-rewriting proxy on PROXY_PORT ───────────────────────────────
// Sits between the serveo tunnel and Expo CLI/Metro.
// The @expo/ngrok patch tunnels PROXY_PORT so every Expo Go request lands here.

function startProxy() {
  if (!replDomain) {
    process.stderr.write("[proxy] REPLIT_DEV_DOMAIN not set — skipping proxy\n");
    return;
  }

  const server = http.createServer((req, res) => {
    const accept = req.headers["accept"] || "";
    const isManifest =
      (req.url === "/" || req.url === "") &&
      accept.includes("application/expo+json");

    const proxyReq = http.request(
      {
        hostname: "localhost",
        port: PORT,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: `localhost:${PORT}` },
      },
      (proxyRes) => {
        if (isManifest && proxyRes.statusCode === 200) {
          // Buffer the manifest, rewrite bundle + asset URLs, send modified response
          const chunks = [];
          proxyRes.on("data", (c) => chunks.push(c));
          proxyRes.on("end", () => {
            const body = Buffer.concat(chunks);
            try {
              const manifest = JSON.parse(body.toString("utf8"));

              // Rewrite main JS bundle URL
              if (manifest.launchAsset?.url) {
                const u = new URL(manifest.launchAsset.url);
                manifest.launchAsset.url =
                  `https://${replDomain}:3000${u.pathname}${u.search}`;
                process.stdout.write(
                  `[proxy] manifest bundle → https://${replDomain}:3000` +
                  `${u.pathname.slice(0, 50)}...\n`
                );
              }

              // Rewrite static asset URLs (fonts, images)
              if (Array.isArray(manifest.assets)) {
                manifest.assets = manifest.assets.map((a) => {
                  if (a.url) {
                    try {
                      const u = new URL(a.url);
                      a.url = `https://${replDomain}:3000${u.pathname}${u.search}`;
                    } catch (_) {}
                  }
                  return a;
                });
              }

              const newBody = Buffer.from(JSON.stringify(manifest), "utf8");

              // Preserve all headers except content-length (length changed)
              const headers = {};
              for (const [k, v] of Object.entries(proxyRes.headers)) {
                if (k.toLowerCase() !== "content-length") headers[k] = v;
              }
              headers["content-length"] = String(newBody.length);

              res.writeHead(proxyRes.statusCode, headers);
              res.end(newBody);
            } catch (e) {
              // Fallback: send original manifest unmodified
              process.stderr.write(`[proxy] manifest rewrite failed: ${e.message}\n`);
              res.writeHead(proxyRes.statusCode, proxyRes.headers);
              res.end(body);
            }
          });
        } else {
          // Transparent proxy for all non-manifest requests
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res, { end: true });
        }
      }
    );

    proxyReq.on("error", (err) => {
      if (!res.headersSent) {
        res.writeHead(502);
        res.end(`Proxy error: ${err.message}`);
      }
    });

    req.pipe(proxyReq, { end: true });
  });

  // Forward WebSocket upgrades (HMR, remote logging, inspector)
  server.on("upgrade", (req, socket, head) => {
    const proxySocket = net.connect(PORT, "localhost", () => {
      let rawHeaders = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
      for (const [k, v] of Object.entries(req.headers)) {
        rawHeaders += `${k}: ${v}\r\n`;
      }
      rawHeaders += "\r\n";
      proxySocket.write(rawHeaders);
      if (head && head.length) proxySocket.write(head);
    });
    socket.pipe(proxySocket);
    proxySocket.pipe(socket);
    proxySocket.on("error", () => { try { socket.destroy(); } catch (_) {} });
    socket.on("error", () => { try { proxySocket.destroy(); } catch (_) {} });
  });

  server.listen(PROXY_PORT, () => {
    process.stdout.write(`[proxy] Manifest proxy started on port ${PROXY_PORT}\n`);
    process.stdout.write(
      `[proxy] Bundle/asset URLs will be rewritten → https://${replDomain}:3000/...\n`
    );
  });
}

startProxy();

// ── 2. Start expo --tunnel ──────────────────────────────────────────────────
// The @expo/ngrok patch tunnels PROXY_PORT so Expo Go → tunnel → our proxy.
const expo = spawn(
  "pnpm",
  ["exec", "expo", "start", "--tunnel", "--port", String(PORT)],
  { stdio: "inherit", env: process.env }
);
expo.on("exit", (code) => process.exit(code ?? 0));

// ── 3. Pre-warm the Android bundle ─────────────────────────────────────────

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
      if (r.status === 200) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 3000));
  }

  // Fetch manifest directly from Metro (bypasses our proxy) to get the bundle URL
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
    process.stdout.write(
      `[dev] Android bundle cached (${kb} KB, HTTP ${r.status}) — QR code ready!\n`
    );
  } catch (e) {
    process.stderr.write(`[dev] Pre-warm error (non-fatal): ${e.message}\n`);
  }
}

// Give Metro a head start before we start polling
setTimeout(prewarm, 8000);
