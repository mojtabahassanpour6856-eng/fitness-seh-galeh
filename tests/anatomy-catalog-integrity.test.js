const fs = require('node:fs');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const html = fs.readFileSync('experiments/anatomy-smart-prototype.html', 'utf8');
const catalog = JSON.parse(fs.readFileSync('experiments/ANATOMY-MUSCLE-CATALOG.json', 'utf8'));

// Keep the catalog fingerprint tied to the exact committed source bytes.
const gitBlobSha = crypto.createHash('sha1')
  .update(Buffer.concat([
    Buffer.from('blob ' + Buffer.byteLength(html, 'utf8') + '\0'),
    Buffer.from(html, 'utf8')
  ]))
  .digest('hex');
assert.equal(catalog.source_blob_sha, gitBlobSha, 'catalog source_blob_sha must match the prototype Git blob');
assert.equal(catalog.source_verification.source_blob_sha, gitBlobSha,
  'catalog source_verification.source_blob_sha must match the prototype Git blob');

// DATA is a JSON-compatible literal embedded in the standalone prototype.
const match = html.match(/const DATA=(\{[\s\S]*?\});\s*(?:const|let|function)\s/);
assert.ok(match, 'prototype DATA object must be extractable');
const data = JSON.parse(match[1]);

const catalogByPath = new Map();
for (const group of catalog.groups) {
  for (const [view, entries] of Object.entries(group.geometry_by_view || {})) {
    for (const entry of entries) {
      const key = view + ':' + entry.index;
      assert.ok(!catalogByPath.has(key), 'duplicate catalog entry for ' + key);
      catalogByPath.set(key, { group, entry });
    }
  }
}

let sourcePathCount = 0;
for (const [view, model] of Object.entries(data)) {
  for (const [index, path] of (model.muscles || []).entries()) {
    sourcePathCount++;
    const key = view + ':' + index;
    const found = catalogByPath.get(key);
    assert.ok(found, 'source SVG path missing from catalog: ' + key);
    assert.equal(found.entry.id || null, path.id || null, 'path ID mismatch: ' + key);
    assert.equal(found.group.source_group_key, path.group, 'path group mismatch: ' + key);
    catalogByPath.delete(key);
  }
}
assert.equal(catalogByPath.size, 0, 'catalog contains entries absent from source DATA');
assert.equal(sourcePathCount, 116, 'unexpected anatomy source path count');
assert.equal(catalog.source_verification.inventory_path_count, sourcePathCount);
assert.equal(catalog.source_verification.catalog_entry_count, sourcePathCount);

for (const group of catalog.groups) {
  if (group.anatomical_validation_status !== 'reviewed') {
    assert.notEqual(group.pairing_status, 'reviewed',
      'bilateral pairing cannot be enabled before anatomical review: ' + group.group_id);
    assert.equal(group.paired_selection_enabled, false,
      'unreviewed group must keep bilateral pairing disabled: ' + group.group_id);
  }
}

console.log('PASS: Git blob fingerprint, all 116 source/catalog path references, and unreviewed pairing gates.');
