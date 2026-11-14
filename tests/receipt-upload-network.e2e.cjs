/* Dedicated Chromium regression tests for the real receipt submission handler.
 * The handler is extracted from index.html; Supabase is replaced by an in-memory,
 * deterministic fake. No production URL, credentials, database, or storage is used.
 */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const html = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
const marker = 'window.submitPaymentReceipt=async function(){';
let handler = null;
for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
  const script = match[1];
  const start = script.indexOf(marker);
  if (start < 0) continue;
  const nextHandler = script.indexOf('async function loadCoachReceipts', start);
  const end = nextHandler < 0 ? -1 : script.lastIndexOf('};', nextHandler);
  if (end < 0) throw new Error('Could not find the end of submitPaymentReceipt before loadCoachReceipts in index.html');
  handler = script.slice(start, end + 2);
  break;
}
if (!handler) throw new Error('Real submitPaymentReceipt handler was not found in index.html');

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><html><head><title>Receipt test harness</title></head><body><input id="receiptFile" type="file"><input id="receiptAmount" value="125000"><input id="receiptDate" value="1405/08/23"><input id="receiptNote" value="آزمایش"><select id="receiptMembershipId"><option value="71" selected>71</option></select><button id="submitPaymentReceiptBtn">ارسال</button></body></html>');
});

function makeBackend() {
  return {
    receipts: [],
    objects: new Map(),
    failUploadResponseOnce: false,
    failSignedUrlOnce: false,
    failInsertResponseOnce: false,
    failSelectResponseOnce: false,
    uploadCalls: 0,
    insertCalls: 0,
    events: [],
    async call(op, payload) {
      this.events.push({ op, payload, objectCount: this.objects.size, receiptCount: this.receipts.length });
      if (op === 'upload') {
        this.uploadCalls++;
        if (this.objects.has(payload.path)) return { error: { message: 'Object already exists' } };
        this.objects.set(payload.path, payload.fileName);
        if (this.failUploadResponseOnce) {
          this.failUploadResponseOnce = false;
          return { error: { message: 'Network response lost after upload commit' } };
        }
        return { error: null };
      }
      if (op === 'signedUrl') {
        if (this.failSignedUrlOnce) {
          this.failSignedUrlOnce = false;
          return { error: { message: 'Network unavailable' }, data: null };
        }
        return this.objects.has(payload.path)
          ? { data: { signedUrl: 'https://receipt.test/signed' }, error: null }
          : { data: null, error: { message: 'Not found' } };
      }
      if (op === 'insert') {
        this.insertCalls++;
        const existing = this.receipts.find(r => r.submitted_by === payload.submitted_by && r.submission_operation_id === payload.submission_operation_id);
        if (!existing) this.receipts.push({ id: 'receipt-' + (this.receipts.length + 1), ...payload });
        if (this.failInsertResponseOnce) {
          this.failInsertResponseOnce = false;
          return { error: { message: 'Network response lost after database commit' } };
        }
        return { error: existing ? { message: 'Duplicate operation key' } : null };
      }
      if (op === 'select') {
        if (this.failSelectResponseOnce) {
          this.failSelectResponseOnce = false;
          throw new Error('Network unavailable during verification query');
        }
        const rows = this.receipts.filter(r =>
          r.submitted_by === payload.submittedBy &&
          r.submission_operation_id === payload.operationId
        );
        return { data: rows.slice(0, 2), error: null };
      }
      throw new Error('Unexpected backend operation: ' + op);
    }
  };
}

async function installHarness(page, backend) {
  await page.exposeFunction('__receiptBackendCall', (op, payload) => backend.call(op, payload));
  await page.addInitScript(() => {
    window.$ = id => document.getElementById(id);
    window.isTrainee = () => true;
    window.currentClient = { id: 'trainee-501' };
    window.isoDate = value => value === '1405/08/23' ? '2026-11-14' : null;
    window.__fitnessGetApiSession = async () => ({ user: { id: 'trainee-user-9' } });
    window.sehOptimizeUploadImage = async file => file;
    window.alert = message => { window.__lastAlert = String(message); };
    window.SEH_RECEIPT_MEMBERSHIP_LINK_ENABLED = true;
    window.AUTH_SUPABASE = {
      storage: { from: () => ({
        upload: async (path, file) => window.__receiptBackendCall('upload', { path, fileName: file.name }),
        createSignedUrl: async path => window.__receiptBackendCall('signedUrl', { path })
      }) },
      from: () => ({
        insert: payload => window.__receiptBackendCall('insert', payload),
        select: () => {
          const filters = {};
          const query = {
            eq: (key, value) => { filters[key] = value; return query; },
            limit: () => window.__receiptBackendCall('select', {
              submittedBy: filters.submitted_by,
              operationId: filters.submission_operation_id
            })
          };
          return query;
        }
      })
    };
  });
  await page.goto('http://127.0.0.1:4179/');
  await page.addScriptTag({ content: handler });
  await page.locator('#receiptFile').setInputFiles({
    name: 'bank-receipt.png', mimeType: 'image/png', buffer: Buffer.from('synthetic receipt bytes')
  });
  // Build a File with an explicitly stable lastModified value; Chromium otherwise
  // assigns a fresh timestamp to each synthetic file on page recreation.
  await page.evaluate(() => {
    const input = document.getElementById('receiptFile');
    const transfer = new DataTransfer();
    transfer.items.add(new File(['synthetic receipt bytes'], 'bank-receipt.png', {
      type: 'image/png', lastModified: 1700000000000
    }));
    input.files = transfer.files;
  });
}

(async () => {
  await new Promise(resolve => server.listen(4179, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    // 1. Object upload commits, but both the upload response and immediate existence
    // check are lost. A retry must reuse the same object path and operation UUID.
    {
      const backend = makeBackend();
      backend.failUploadResponseOnce = true;
      backend.failSignedUrlOnce = true;
      const context = await browser.newContext();
      let page = await context.newPage();
      await installHarness(page, backend);
      await page.evaluate(() => window.submitPaymentReceipt());
      const pendingBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('seh-receipt-submit-op:trainee-user-9:trainee-501')));
      assert.ok(pendingBefore?.operationId, 'operation ID must survive ambiguous upload failure');
      await page.close();
      page = await context.newPage();
      await installHarness(page, backend);
      await page.evaluate(() => window.submitPaymentReceipt());
      assert.equal(backend.receipts.length, 1, 'retry after upload interruption must create one receipt; diagnostics=' + JSON.stringify({events:backend.events,objects:[...backend.objects.keys()],receipts:backend.receipts,lastAlert:await page.evaluate(() => window.__lastAlert || null),pending:await page.evaluate(() => localStorage.getItem('seh-receipt-submit-op:trainee-user-9:trainee-501'))}));
      assert.equal(backend.objects.size, 1, 'retry must reuse the deterministic storage object');
      assert.equal(backend.receipts[0].submission_operation_id, pendingBefore.operationId);
      assert.equal(await page.evaluate(() => localStorage.getItem('seh-receipt-submit-op:trainee-user-9:trainee-501')), null);
      results.push('PASS upload committed + response lost + page recreated + retry');
      await context.close();
    }

    // 2. Database INSERT commits but its response and the follow-up verification query
    // are lost. Reloading and retrying must discover the committed row, not insert again.
    {
      const backend = makeBackend();
      backend.failInsertResponseOnce = true;
      backend.failSelectResponseOnce = true;
      const context = await browser.newContext();
      let page = await context.newPage();
      await installHarness(page, backend);
      await page.evaluate(() => window.submitPaymentReceipt());
      const pendingBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('seh-receipt-submit-op:trainee-user-9:trainee-501')));
      assert.ok(pendingBefore?.operationId, 'operation ID must survive ambiguous database response');
      assert.equal(backend.receipts.length, 1, 'fake database must model committed insert');
      await page.close();
      page = await context.newPage();
      await installHarness(page, backend);
      await page.evaluate(() => window.submitPaymentReceipt());
      assert.equal(backend.receipts.length, 1, 'retry after committed insert must not duplicate receipt');
      assert.equal(backend.receipts[0].submission_operation_id, pendingBefore.operationId);
      assert.equal(await page.evaluate(() => localStorage.getItem('seh-receipt-submit-op:trainee-user-9:trainee-501')), null);
      results.push('PASS database committed + response lost + page recreated + retry');
      await context.close();
    }

    // 3. Two overlapping submissions from the same page must converge on one stable
    // operation and one database row, even when both handlers begin before either ends.
    {
      const backend = makeBackend();
      const context = await browser.newContext();
      const page = await context.newPage();
      await installHarness(page, backend);
      await page.evaluate(async () => Promise.all([
        window.submitPaymentReceipt(),
        window.submitPaymentReceipt()
      ]));
      assert.equal(backend.receipts.length, 1, 'overlapping submissions must yield exactly one receipt');
      assert.equal(new Set(backend.receipts.map(r => r.submission_operation_id)).size, 1);
      results.push('PASS overlapping submit requests converge to one receipt');
      await context.close();
    }

    console.log(results.join('\n'));
    console.log('All dedicated Chromium receipt-upload interruption tests passed.');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
