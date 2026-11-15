import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const match = html.match(/const removeUploadedHealthFile = async \(storage, path\) => \{([\s\S]*?)\n  \};/);
assert.ok(match, 'production cleanup helper must exist in the health-report module');
const removeUploadedHealthFile = new Function('storage', 'path', `return (async () => {\n${match[1]}\n})();`);

function fakeStorage(removeResult, thrownError) {
  const calls = [];
  return {
    calls,
    from(bucket) {
      assert.equal(bucket, 'trainee-health-reports');
      return { async remove(paths) { calls.push(paths); if (thrownError) throw thrownError; return removeResult; } };
    }
  };
}

test('cleanup succeeds only when Storage remove returns no error', async () => {
  const storage = fakeStorage({ data: [{ name: 'removed' }], error: null });
  await removeUploadedHealthFile(storage, 'user/trainee/health_1_lab.pdf');
  assert.deepEqual(storage.calls, [['user/trainee/health_1_lab.pdf']]);
});

test('cleanup rejects a returned Storage error object', async () => {
  const error = Object.assign(new Error('storage remove denied'), { statusCode: '403' });
  const storage = fakeStorage({ data: null, error });
  await assert.rejects(
    removeUploadedHealthFile(storage, 'user/trainee/health_2_lab.pdf'),
    err => err === error
  );
});

test('cleanup propagates a thrown Storage exception', async () => {
  const error = new TypeError('Failed to fetch');
  const storage = fakeStorage(null, error);
  await assert.rejects(
    removeUploadedHealthFile(storage, 'user/trainee/health_3_lab.pdf'),
    err => err === error
  );
});

test('upload failure path records and visibly reports cleanup failure', () => {
  assert.match(html, /cleanupFailure=cleanupError/);
  assert.match(html, /health report upload cleanup failed:/);
  assert.match(html, /پاکسازی فایل موقت هم ناموفق بود/);
  assert.match(html, /ممکن است فایل بدون سابقه در فضای ذخیره‌سازی باقی مانده باشد/);
});
