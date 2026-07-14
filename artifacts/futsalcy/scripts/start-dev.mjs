/**
 * Dev startup script: opens a localtunnel for the assigned $PORT so Expo Go
 * on Android/iOS can reach the Metro bundler via a public port-80 URL instead
 * of trying to hit $PORT directly (which Replit's firewall blocks externally).
 *
 * Flow:
 *  1. Write .env.local with EXPO_PUBLIC_* vars
 *  2. Open localtunnel → get a URL like https://xxx.loca.lt
 *  3. Extract hostname (no port) → set REACT_NATIVE_PACKAGER_HOSTNAME
 *  4. Spawn `expo start --port $PORT`
 *
 * QR code then reads exp://xxx.loca.lt  (port 80, no explicit port)
 * rather than exp://domain:20728 which is blocked externally.
 */

import localtunnel from 'localtunnel';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const port = parseInt(process.env.PORT || '8081');
const replDomain = process.env.REPLIT_DEV_DOMAIN || '';
const replId = process.env.REPL_ID || '';

writeFileSync(
  '.env.local',
  `EXPO_PUBLIC_DOMAIN=${replDomain}\nEXPO_PUBLIC_REPL_ID=${replId}\n`,
);

console.log(`Opening tunnel on local port ${port}...`);

let hostname;
try {
  const tunnel = await localtunnel({ port });
  hostname = new URL(tunnel.url).hostname;
  console.log(`\n✅ Tunnel ready: ${tunnel.url}  (hostname: ${hostname})\n`);

  tunnel.on('error', (err) => {
    console.error('Tunnel error (non-fatal):', err.message);
  });

  // Re-open tunnel if it closes unexpectedly
  tunnel.on('close', () => {
    console.warn('Tunnel closed — Metro may still be reachable via Replit proxy');
  });
} catch (err) {
  console.warn(`Tunnel failed (${err.message}), falling back to Replit Expo domain`);
  hostname = process.env.REPLIT_EXPO_DEV_DOMAIN || '';
}

const env = {
  ...process.env,
  ...(hostname ? { REACT_NATIVE_PACKAGER_HOSTNAME: hostname } : {}),
};

const expo = spawn(
  'pnpm',
  ['exec', 'expo', 'start', '--port', String(port)],
  { env, stdio: 'inherit', shell: false },
);

expo.on('close', (code) => {
  process.exit(code ?? 0);
});

process.on('SIGTERM', () => expo.kill('SIGTERM'));
process.on('SIGINT', () => expo.kill('SIGINT'));
