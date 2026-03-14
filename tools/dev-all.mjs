import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, '..');
const gatewayCwd = path.join(repoRoot, 'ai-sprint-manager', 'backend', 'api-gateway');

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const node = process.execPath;

for (const [label, dir] of [
  ['repoRoot', repoRoot],
  ['gatewayCwd', gatewayCwd],
]) {
  if (!fs.existsSync(dir)) {
    console.error(`[dev-all] Missing ${label} directory: ${dir}`);
    process.exit(1);
  }
}

function spawnChild(name, command, args, cwd, extraOptions = {}) {
  const child = spawn(command, args, {
    cwd,
    stdio: 'inherit',
    ...extraOptions,
  });

  child.on('exit', (code, signal) => {
    const suffix = signal ? `signal ${signal}` : `code ${code}`;
    console.log(`[${name}] exited (${suffix})`);
  });

  return child;
}

async function isPortFree(port) {
  return await new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    // Bind to the unspecified address (same behavior as Next.js).
    // Using 127.0.0.1 can falsely report "free" when the port is taken on ::/0.0.0.0.
    server.listen(port);
  });
}

async function findFreePort(startPort, { maxAttempts = 50 } = {}) {
  for (let i = 0; i < maxAttempts; i += 1) {
    const port = startPort + i;
    if (await isPortFree(port)) return port;
  }
  throw new Error(`Could not find a free port starting at ${startPort}`);
}

function terminate(child) {
  if (!child || child.killed) return;

  // SIGTERM is best-effort on Windows; fall back to kill.
  try {
    child.kill('SIGTERM');
  } catch {
    try {
      child.kill();
    } catch {
      // ignore
    }
  }
}

const webPort = await findFreePort(3000);
const gatewayPort = await findFreePort(4000);

console.log(`[dev-all] web http://localhost:${webPort}`);
console.log(`[dev-all] gateway http://localhost:${gatewayPort}`);

const gateway = spawnChild('gateway', node, ['src/app.js'], gatewayCwd, {
  env: {
    ...process.env,
    PORT: String(gatewayPort),
    FRONTEND_URL: `http://localhost:${webPort}`,
  },
});

const web = spawnChild('web', npx, ['next', 'dev', '-p', String(webPort)], repoRoot, {
  shell: true,
  env: {
    ...process.env,
    API_GATEWAY_URL: `http://localhost:${gatewayPort}`,
    PORT: String(webPort),
  },
});

let shuttingDown = false;
function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  terminate(gateway);
  terminate(web);

  process.exitCode = exitCode;
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

for (const child of [gateway, web]) {
  child.on('exit', (code) => {
    // If one process exits unexpectedly, stop the other.
    if (!shuttingDown && code && code !== 0) shutdown(code);
  });
}
