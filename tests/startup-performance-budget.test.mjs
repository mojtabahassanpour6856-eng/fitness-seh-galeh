import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync('index.html', 'utf8');
const byteLength = value => Buffer.byteLength(value, 'utf8');
const htmlBytes = byteLength(html);
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
const inlineScripts = scripts
  .filter(([, attributes, body]) => !/\bsrc\s*=/.test(attributes) && body.trim())
  .map(([, attributes, body], index) => ({
    index,
    id: (attributes.match(/\bid=["']([^"']+)["']/i) || [])[1] || null,
    bytes: byteLength(body)
  }));
const inlineBytes = inlineScripts.reduce((sum, script) => sum + script.bytes, 0);
const largest = [...inlineScripts].sort((a, b) => b.bytes - a.bytes)[0];

// Guardrails intentionally allow small maintenance growth while preventing
// further unreviewed expansion of the already-large synchronous app document.
const BUDGET = {
  htmlBytes: 1_350_000,
  inlineScriptBytes: 1_190_000,
  inlineScriptCount: 120,
  largestInlineScriptBytes: 145_000
};

console.log(JSON.stringify({
  measured: {
    htmlBytes,
    inlineScriptBytes: inlineBytes,
    inlineScriptCount: inlineScripts.length,
    largestInlineScriptBytes: largest?.bytes || 0,
    largestInlineScriptId: largest?.id || null
  },
  budget: BUDGET
}, null, 2));

assert.ok(htmlBytes <= BUDGET.htmlBytes,
  'index.html exceeded its startup document byte budget; reduce or externalize code only after dependency review');
assert.ok(inlineBytes <= BUDGET.inlineScriptBytes,
  'inline JavaScript exceeded its startup parse/compile budget');
assert.ok(inlineScripts.length <= BUDGET.inlineScriptCount,
  'too many inline script blocks were added; consolidate or modularize safely');
assert.ok((largest?.bytes || 0) <= BUDGET.largestInlineScriptBytes,
  'one inline script became too large; split it only after verifying execution order and global dependencies');

console.log('PASS: startup document and inline-script growth remain within the initial performance guardrails.');
