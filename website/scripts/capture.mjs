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
  : '/docusaurus-plugin-api-hover/api-reference';
const url = `http://127.0.0.1:${PORT}${urlPath}`;

async function run(cmd, args, opts = {}) {
  const proc = spawn(cmd, args, { stdio: 'inherit', ...opts });
  const code = await new Promise((resolve) => proc.on('close', resolve));
  if (code !== 0) throw new Error(`${cmd} ${args.join(' ')} exited with ${code}`);
}

async function waitUntilUp() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // server not accepting connections yet
    }
    await delay(500);
  }
  throw new Error(`preview server never answered at ${url}`);
}

if (!process.argv.includes('--no-build')) {
  await run('npm', ['run', 'build']);
}
const server = spawn('npx', ['blume', 'preview', `--port=${PORT}`, '--host=127.0.0.1'], {
  stdio: 'ignore',
});
try {
  await waitUntilUp();
  await run('node', ['scripts/capture-hover.mjs', '--url', url]);
} finally {
  server.kill();
}
