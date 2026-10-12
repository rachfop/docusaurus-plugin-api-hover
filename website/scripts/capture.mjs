#!/usr/bin/env node
/**
 * One-command screenshot capture: builds the site, serves it with
 * `blume preview` on a scratch port, runs capture-hover.mjs against it,
 * and always stops the server. The screenshots land in ../media/ (README)
 * and public/ (the site itself), in both themes.
 *
 * Usage: npm run capture [-- --url-path /path] [-- --no-build]
 * --no-build serves the existing dist/ (CI builds around this step, so
 * the final build picks up the fresh images from public/).
 */
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = 4199;
const urlPath = process.argv.includes('--url-path')
  ? process.argv[process.argv.indexOf('--url-path') + 1]
  : '/quickinfo/';
const url = `http://127.0.0.1:${PORT}${urlPath}`;

async function run(cmd, args, opts = {}) {
  const proc = spawn(cmd, args, { stdio: 'inherit', ...opts });
  const code = await new Promise((resolve) => proc.on('close', resolve));
  if (code !== 0) throw new Error(`${cmd} ${args.join(' ')} exited with ${code}`);
}

async function portAnswers() {
  try {
    await fetch(`http://127.0.0.1:${PORT}/`);
    return true;
  } catch {
    return false;
  }
}

async function waitUntilUp(server) {
  // A server that dies while we wait means the port or the build is
  // broken; fail fast so the caller learns why.
  const dead = new Promise((resolve) => server.once('exit', resolve));
  for (let i = 0; i < 60; i++) {
    if (await portAnswers()) return;
    const exited = await Promise.race([dead.then(() => true), delay(500).then(() => false)]);
    if (exited) throw new Error('blume preview exited before accepting connections');
  }
  throw new Error(`preview server never answered at ${url}`);
}

if (await portAnswers()) {
  throw new Error(
    `port ${PORT} is already in use (stale preview server?); ` +
      'kill it before capturing, or the capture may shoot the wrong site',
  );
}

if (!process.argv.includes('--no-build')) {
  await run('npm', ['run', 'build']);
}
// Spawn the blume binary directly (not through npx): kill() then reaches
// the actual preview server, not just a wrapper around it.
const server = spawn('node_modules/.bin/blume', ['preview', `--port=${PORT}`, '--host=127.0.0.1']);
try {
  await waitUntilUp(server);
  // The port answers; now the page itself must. A non-OK response here
  // is a bad --url-path, not a slow server.
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`preview server answered ${res.status} at ${url} (bad --url-path?)`);
  }
  await run('node', ['scripts/capture-hover.mjs', '--url', url]);
} finally {
  server.kill();
}
