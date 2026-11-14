import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const base = execFileSync('git', ['merge-base', 'origin/main', 'HEAD'], { encoding: 'utf8' }).trim();
const changed = execFileSync('git', ['diff', '--name-only', \`\${base}...HEAD\`], { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean);

const shellAssets = new Set([
  'index.html', 'manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png',
  'vendor/supabase-2.119.0.js', 'coach-nutrition-builder.html',
  'top-genesis-pdf-app-embed.js', 'top-genesis-pdf-test.html',
  'top-genesis-pdf-parser.js', 'top-genesis-csv-parser.js',
  'top-genesis-publication.js', 'top-genesis-archive.js'
]);
const shellChanged = changed.some(path => shellAssets.has(path));
if (shellChanged) {
  assert.ok(changed.includes('sw.js'),
    'A cached shell asset changed without updating sw.js; the service worker would keep serving the old cache version.');
  const previous = execFileSync('git', ['show', \`\${base}:sw.js\`], { encoding: 'utf8' });
  const current = fs.readFileSync('sw.js', 'utf8');
  const readCacheName = source => (source.match(/const SHELL_CACHE_NAME = '([^']+)'/) || [])[1];
  assert.ok(readCacheName(previous), 'Base service worker cache version must be readable');
  assert.ok(readCacheName(current), 'Current service worker cache version must be readable');
  assert.notEqual(readCacheName(current), readCacheName(previous),
    'Cached shell assets changed but SHELL_CACHE_NAME was not bumped; cached clients may keep stale files.');
}
console.log('PASS: cached shell asset changes require a new service-worker cache version.');
