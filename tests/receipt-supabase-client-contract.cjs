/* Verify the exact fluent-query and Storage response shapes used by the receipt handler
 * against the official Supabase JS v2 client, without credentials or a live project.
 */
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');

const calls = [];
let duplicateUpload = false;
let missingSignedObject = false;
let duplicateInsert = false;
const rows = [{
  id: 'receipt-1',
  trainee_id: 'trainee-501',
  submitted_by: 'trainee-user-9',
  submission_operation_id: '11111111-1111-4111-8111-111111111111',
  membership_id: 71,
  receipt_path: 'trainee-user-9/trainee-501/receipt_test_bank-receipt.png',
  amount: 125000,
  payment_date: '2026-11-14',
  note: 'آزمایش',
  review_status: 'pending'
}];

async function fakeFetch(input, init = {}) {
  const url = new URL(String(input));
  const method = (init.method || 'GET').toUpperCase();
  calls.push({ method, path: url.pathname, search: url.search, headers: init.headers, body: init.body });
  if (url.pathname.startsWith('/storage/v1/object/payment-receipts/')) {
    assert.equal(method, 'POST');
    if (duplicateUpload) return new Response(JSON.stringify({ statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }), {
      status: 409, headers: { 'content-type': 'application/json' }
    });
    return new Response(JSON.stringify({ Key: 'payment-receipts/test-object' }),
      status: 200, headers: { 'content-type': 'application/json' }
    });
  }
  if (url.pathname.startsWith('/storage/v1/object/sign/payment-receipts/')) {
    assert.equal(method, 'POST');
    if (missingSignedObject) return new Response(JSON.stringify({ statusCode: '404', error: 'Not Found', message: 'Object not found' }), {
      status: 404, headers: { 'content-type': 'application/json' }
    });
    return new Response(JSON.stringify({ signedURL: '/object/sign/payment-receipts/test-object?token=fake' }), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
  }
  if (url.pathname === '/rest/v1/trainee_payment_receipts' && method === 'GET') {
    assert.equal(url.searchParams.get('submitted_by'), 'eq.trainee-user-9');
    assert.equal(url.searchParams.get('submission_operation_id'), 'eq.11111111-1111-4111-8111-111111111111');
    assert.equal(url.searchParams.get('limit'), '2');
    return new Response(JSON.stringify(rows), {
      status: 200, headers: { 'content-type': 'application/json', 'content-range': '0-0/1' }
    });
  }
  if (url.pathname === '/rest/v1/trainee_payment_receipts' && method === 'POST') {
    const payload = JSON.parse(init.body);
    if (duplicateInsert) return new Response(JSON.stringify({ code: '23505', details: null, hint: null, message: 'duplicate key value violates unique constraint' }), {
      status: 409, headers: { 'content-type': 'application/json' }
    });
    assert.equal(payload.submission_operation_id, '11111111-1111-4111-8111-111111111111');
    assert.equal(payload.membership_id, 71);
    // Supabase JS v2 omits Prefer when using the default return=minimal behavior;
    // PostgREST treats the absent preference as minimal return.
    assert.equal(new Headers(init.headers).get('prefer'), null);
    return new Response(null, { status: 201 });
  }
  throw new Error('Unexpected Supabase SDK request: ' + method + ' ' + url);
}

(async () => {
  const supabase = createClient('https://project-ref.supabase.co', 'test-anon-key', {
    global: { fetch: fakeFetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  const { data, error } = await supabase.from('trainee_payment_receipts')
    .select('id,trainee_id,submitted_by,submission_operation_id,membership_id,receipt_path,amount,payment_date,note,review_status')
    .eq('submitted_by', 'trainee-user-9')
    .eq('submission_operation_id', '11111111-1111-4111-8111-111111111111')
    .limit(2);
  assert.equal(error, null);
  assert.equal(data.length, 1);
  assert.equal(data[0].membership_id, 71);

  const insert = await supabase.from('trainee_payment_receipts').insert({
    trainee_id: 'trainee-501', submitted_by: 'trainee-user-9',
    submission_operation_id: '11111111-1111-4111-8111-111111111111',
    membership_id: 71, receipt_path: rows[0].receipt_path, amount: 125000,
    payment_date: '2026-11-14', note: 'آزمایش', review_status: 'pending'
  });
  assert.equal(insert.error, null);

  const upload = await supabase.storage.from('payment-receipts').upload(
    rows[0].receipt_path,
    new Blob(['synthetic receipt'], { type: 'image/png' }),
    { upsert: false, contentType: 'image/png' }
  );
  assert.equal(upload.error, null);

  const signed = await supabase.storage.from('payment-receipts').createSignedUrl(rows[0].receipt_path, 60);
  assert.equal(signed.error, null);
  assert.ok(signed.data?.signedUrl, 'SDK must normalize signedURL into data.signedUrl');

  duplicateUpload = true;
  const duplicate = await supabase.storage.from('payment-receipts').upload(
    rows[0].receipt_path, new Blob(['synthetic receipt'], { type: 'image/png' }), { upsert: false }
  );
  assert.ok(duplicate.error, 'existing deterministic object must surface as an upload error');
  assert.equal(duplicate.error.statusCode, '409');
  duplicateUpload = false;

  missingSignedObject = true;
  const missing = await supabase.storage.from('payment-receipts').createSignedUrl(rows[0].receipt_path, 60);
  assert.ok(missing.error, 'missing storage object must surface as signed-url error');
  assert.equal(missing.data, null);
  missingSignedObject = false;

  duplicateInsert = true;
  const conflict = await supabase.from('trainee_payment_receipts').insert({
    trainee_id: 'trainee-501', submitted_by: 'trainee-user-9',
    submission_operation_id: rows[0].submission_operation_id,
    membership_id: 71, receipt_path: rows[0].receipt_path, amount: 125000,
    payment_date: '2026-11-14', note: 'آزمایش', review_status: 'pending'
  });
  assert.equal(conflict.error?.code, '23505');
  duplicateInsert = false;

  assert.equal(calls.filter(c => c.method === 'GET' && c.path === '/rest/v1/trainee_payment_receipts').length, 1);
  assert.equal(calls.filter(c => c.method === 'POST' && c.path === '/rest/v1/trainee_payment_receipts').length, 1);
  assert.equal(calls.filter(c => c.path.startsWith('/storage/v1/object/payment-receipts/')).length, 1);
  assert.equal(calls.filter(c => c.path.startsWith('/storage/v1/object/sign/payment-receipts/')).length, 1);
  console.log('PASS Supabase JS v2 PostgREST select/limit response shape');
  console.log('PASS Supabase JS v2 insert return-minimal response shape');
  console.log('PASS Supabase JS v2 Storage upload response shape');
  console.log('PASS Supabase JS v2 createSignedUrl data.signedUrl response shape');
  console.log('PASS Supabase JS v2 duplicate Storage upload error shape');
  console.log('PASS Supabase JS v2 missing signed URL error shape');
  console.log('PASS Supabase JS v2 unique-index conflict error shape');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
