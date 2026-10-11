/**
 * Copies non-TS assets into lib/ after tsc (tsc only emits JS + d.ts).
 */
const { copyFileSync, mkdirSync, existsSync } = require('fs');
const path = require('path');

const pairs = [
  ['src/browser/styles.css', 'lib/browser/styles.css'],
  ['src/fallback-data.json', 'lib/fallback-data.json'],
  ['src/fallback-config.json', 'lib/fallback-config.json'],
];

for (const [from, to] of pairs) {
  const src = path.join(__dirname, '..', from);
  const dest = path.join(__dirname, '..', to);
  if (!existsSync(src)) {
    console.error(`copy-assets: missing ${from}`);
    process.exit(1);
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  console.log(`copy-assets: ${from} -> ${to}`);
}
