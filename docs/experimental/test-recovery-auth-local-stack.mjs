import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
assert.ok(url && url.startsWith('http://127.0.0.1:'), 'Auth integration test must target the local loopback stack');
assert.ok(anonKey && serviceRoleKey, 'Local disposable Auth keys are required');
assert.ok(!/supabase\.co$/i.test(new URL(url).hostname), 'Hosted Supabase is forbidden');

const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
const admin = createClient(url, serviceRoleKey, options);
const makeAnon = () => createClient(url, anonKey, options);
const email = `recovery-auth-${randomUUID()}@example.test`;
const oldPassword = 'Old-Disposable-Password-123!';
const newPassword = 'New-Disposable-Password-456!';
let userId;

async function signIn(password) {
  const client = makeAnon();
  const result = await client.auth.signInWithPassword({ email, password });
  return { client, ...result };
}

try {
  const created = await admin.auth.admin.createUser({
    email, password: oldPassword, email_confirm: true,
    user_metadata: { test_fixture: 'password-recovery-local-auth-only' }
  });
  assert.equal(created.error, null, 'disposable test user creation must succeed');
  userId = created.data.user.id;

  const sessionA = await signIn(oldPassword);
  const sessionB = await signIn(oldPassword);
  assert.equal(sessionA.error, null);
  assert.equal(sessionB.error, null);
  assert.ok(sessionA.data.session?.refresh_token && sessionB.data.session?.refresh_token);

  const changed = await admin.auth.admin.updateUserById(userId, { password: newPassword });
  assert.equal(changed.error, null, 'Auth Admin password update must succeed');
  assert.equal(changed.data.user.id, userId);

  const oldLogin = await signIn(oldPassword);
  assert.ok(oldLogin.error, 'old password must be rejected after password update');
  const newLogin = await signIn(newPassword);
  assert.equal(newLogin.error, null, 'new password must authenticate');
  assert.equal(newLogin.data.user.id, userId);

  const refreshAfterPasswordChange = await sessionB.client.auth.refreshSession({
    refresh_token: sessionB.data.session.refresh_token
  });
  const passwordChangeRevokedExistingRefresh = Boolean(refreshAfterPasswordChange.error);
  const oldAccessAfterPasswordChange = await admin.auth.getUser(sessionA.data.session.access_token);
  const passwordChangeLeftOldAccessAccepted = !oldAccessAfterPasswordChange.error;
  assert.equal(passwordChangeRevokedExistingRefresh, true,
    'password update must revoke previously issued refresh tokens');
  assert.equal(passwordChangeLeftOldAccessAccepted, false,
    'old access JWT must be rejected by Auth getUser after password update');

  const sessionC = await signIn(newPassword);
  const sessionD = await signIn(newPassword);
  assert.equal(sessionC.error, null);
  assert.equal(sessionD.error, null);
  const revoked = await admin.auth.admin.signOut(sessionC.data.session.access_token, 'global');
  assert.equal(revoked.error, null, 'global server-side sign-out must succeed');

  const refreshAfterGlobalSignOut = await sessionD.client.auth.refreshSession({
    refresh_token: sessionD.data.session.refresh_token
  });
  assert.ok(refreshAfterGlobalSignOut.error, 'global sign-out must revoke other sessions refresh tokens');
  const oldAccessAfterGlobalSignOut = await admin.auth.getUser(sessionC.data.session.access_token);
  const globalSignOutLeftOldAccessAccepted = !oldAccessAfterGlobalSignOut.error;
  assert.equal(globalSignOutLeftOldAccessAccepted, false,
    'global sign-out must reject old access JWTs in the disposable Auth stack');

  console.log('PASS: disposable local Auth user; admin password update; old-password rejection; new-password login; global sign-out revokes other refresh tokens.');
  console.log(`OBSERVATION: password update alone revoked existing refresh tokens: ${passwordChangeRevokedExistingRefresh ? 'yes' : 'no'}.`);
  console.log(`OBSERVATION: old access JWT accepted by Auth getUser after password update: ${passwordChangeLeftOldAccessAccepted ? 'yes' : 'no'}.`);
  console.log(`OBSERVATION: old access JWT accepted by Auth getUser after global sign-out: ${globalSignOutLeftOldAccessAccepted ? 'yes' : 'no'}.`);
} finally {
  if (userId) {
    const removed = await admin.auth.admin.deleteUser(userId);
    assert.equal(removed.error, null, 'disposable Auth test user cleanup must succeed');
  }
}
