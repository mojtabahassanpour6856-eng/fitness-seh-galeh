import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbUrl = process.env.SUPABASE_DB_URL;
assert.ok(url && url.startsWith('http://127.0.0.1:'), 'Auth integration test must target the local loopback stack');
assert.ok(anonKey && serviceRoleKey, 'Local disposable Auth keys are required');
assert.ok(!/supabase\\.co$/i.test(new URL(url).hostname), 'Hosted Supabase is forbidden');
assert.ok(dbUrl, 'Local disposable database URL is required');
const parsedDbUrl = new URL(dbUrl);
assert.ok(['127.0.0.1', 'localhost'].includes(parsedDbUrl.hostname), 'Database URL must target loopback only');

const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
const admin = createClient(url, serviceRoleKey, options);
const makeAnon = () => createClient(url, anonKey, options);
const pool = new Pool({ connectionString: dbUrl, max: 1 });
const email = `recovery-auth-${randomUUID()}@example.test`;
const oldPassword = 'Old-Disposable-Password-123!';
const newPassword = 'New-Disposable-Password-456!';
const suffix = randomUUID().replaceAll('-', '');
const tableName = `recovery_jwt_probe_${suffix}`;
const policyName = `recovery_jwt_probe_policy_${suffix}`;
const privateSchema = `recovery_probe_private_${suffix}`;
const sessionFunction = `${privateSchema}.session_is_active`;
const probeId = randomUUID();
const probeSecret = `synthetic-probe-${randomUUID()}`;
let userId;
let probeTableCreated = false;

function jwtLifetimeSeconds(accessToken) {
  const parts = String(accessToken || '').split('.');
  assert.equal(parts.length, 3, 'Auth access token must be a JWT');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  assert.ok(Number.isInteger(payload.iat) && Number.isInteger(payload.exp), 'JWT must contain integer iat/exp claims');
  return payload.exp - payload.iat;
}
function assertCandidateJwtLifetime(session, label) {
  assert.ok(session?.access_token, `${label}: access token is required`);
  assert.equal(jwtLifetimeSeconds(session.access_token), 900,
    `${label}: disposable Auth JWT must expire exactly 900 seconds after issuance`);
}

async function signIn(password) {
  const client = makeAnon();
  const result = await client.auth.signInWithPassword({ email, password });
  return { client, ...result };
}

async function readProbe(accessToken) {
  const endpoint = new URL(`/rest/v1/${tableName}`, url);
  endpoint.searchParams.set('select', 'secret');
  endpoint.searchParams.set('id', `eq.${probeId}`);
  return fetch(endpoint, {
    headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` }
  });
}

async function assertPostgrestStillAccepts(accessToken, label) {
  const response = await readProbe(accessToken);
  const body = await response.text();
  assert.equal(response.status, 200,
    `${label}: PostgREST should accept the still-unexpired signed JWT in this disposable stack; got ${response.status}: ${body}`);
  const rows = JSON.parse(body);
  assert.equal(rows.length, 1, `${label}: RLS should expose exactly the synthetic row to its owner`);
  assert.equal(rows[0].secret, probeSecret);
}

async function assertPostgrestRlsDenies(accessToken, label) {
  const response = await readProbe(accessToken);
  const body = await response.text();
  assert.equal(response.status, 200, `${label}: RLS denial should not expose an API error`);
  assert.deepEqual(JSON.parse(body), [], `${label}: revoked session must not see protected rows`);
}

async function restoreBaselineJwtExpiryPolicy() {
  await pool.query('DROP POLICY ' + policyName + ' ON public.' + tableName);
  await pool.query('CREATE POLICY ' + policyName + ' ON public.' + tableName + ' FOR SELECT TO authenticated USING (auth.uid() = owner_id)');
}

async function assertPostgrestRejectsExpiredJwt(accessToken, label) {
  const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8'));
  assert.ok(Number.isInteger(payload.exp), `${label}: JWT exp claim must be an integer`);
  const waitMs = Math.max(0, payload.exp * 1000 - Date.now() + 2500);
  console.log(`Waiting ${Math.ceil(waitMs / 1000)} seconds for the same signed JWT to expire before the PostgREST rejection check.`);
  if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
  const response = await readProbe(accessToken);
  const body = await response.text();
  assert.ok([401, 403].includes(response.status),
    `${label}: PostgREST must reject the expired JWT; got ${response.status}: ${body}`);
}

async function installSensitiveSessionPolicy() {
  await pool.query(`CREATE SCHEMA ${privateSchema}`);
  await pool.query(`REVOKE ALL ON SCHEMA ${privateSchema} FROM PUBLIC`);
  await pool.query(`GRANT USAGE ON SCHEMA ${privateSchema} TO authenticated`);
  await pool.query(`
    CREATE FUNCTION ${sessionFunction}()
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = ''
    AS $function$
      SELECT EXISTS (
        SELECT 1
        FROM auth.sessions AS s
        WHERE s.id = (auth.jwt() ->> 'session_id')::uuid
          AND s.user_id = auth.uid()
          AND (s.not_after IS NULL OR s.not_after > now())
      )
    $function$
  `);
  await pool.query(`REVOKE ALL ON FUNCTION ${sessionFunction}() FROM PUBLIC`);
  await pool.query(`GRANT EXECUTE ON FUNCTION ${sessionFunction}() TO authenticated`);
  await pool.query(`DROP POLICY ${policyName} ON public.${tableName}`);
  await pool.query(`
    CREATE POLICY ${policyName}
    ON public.${tableName}
    FOR SELECT TO authenticated
    USING (auth.uid() = owner_id AND ${sessionFunction}())
  `);
}

try {
  const created = await admin.auth.admin.createUser({
    email, password: oldPassword, email_confirm: true,
    user_metadata: { test_fixture: 'password-recovery-local-auth-only' }
  });
  assert.equal(created.error, null, 'disposable test user creation must succeed');
  userId = created.data.user.id;

  await pool.query(`CREATE TABLE public.${tableName} (id uuid PRIMARY KEY, owner_id uuid NOT NULL, secret text NOT NULL)`);
  probeTableCreated = true;
  await pool.query(`ALTER TABLE public.${tableName} ENABLE ROW LEVEL SECURITY`);
  await pool.query(`CREATE POLICY ${policyName} ON public.${tableName} FOR SELECT TO authenticated USING (auth.uid() = owner_id)`);
  await pool.query(`GRANT SELECT ON public.${tableName} TO authenticated`);
  await pool.query(`INSERT INTO public.${tableName} (id, owner_id, secret) VALUES ($1, $2, $3)`, [probeId, userId, probeSecret]);
  await pool.query("NOTIFY pgrst, 'reload schema'");

  const sessionA = await signIn(oldPassword);
  const sessionB = await signIn(oldPassword);
  assert.equal(sessionA.error, null);
  assert.equal(sessionB.error, null);
  assert.ok(sessionA.data.session?.refresh_token && sessionB.data.session?.refresh_token);
  assertCandidateJwtLifetime(sessionA.data.session, 'first disposable Auth session');
  assertCandidateJwtLifetime(sessionB.data.session, 'second disposable Auth session');

  const refreshProbe = await signIn(oldPassword);
  assert.equal(refreshProbe.error, null);
  const refreshedProbe = await refreshProbe.client.auth.refreshSession({
    refresh_token: refreshProbe.data.session.refresh_token
  });
  assert.equal(refreshedProbe.error, null, 'refresh before password change must remain functional');
  assertCandidateJwtLifetime(refreshedProbe.data.session, 'refreshed disposable Auth session');

  const changed = await admin.auth.admin.updateUserById(userId, { password: newPassword });
  assert.equal(changed.error, null, 'Auth Admin password update must succeed');
  assert.equal(changed.data.user.id, userId);

  const oldLogin = await signIn(oldPassword);
  assert.ok(oldLogin.error, 'old password must be rejected after password update');
  const newLogin = await signIn(newPassword);
  assert.equal(newLogin.error, null, 'new password must authenticate');
  assert.equal(newLogin.data.user.id, userId);
  assertCandidateJwtLifetime(newLogin.data.session, 'new-password disposable Auth session');

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

  // PostgREST validates the JWT signature/claims locally. It does not consult
  // Auth getUser for every request, so a still-unexpired JWT may remain usable.
  await assertPostgrestStillAccepts(sessionA.data.session.access_token,
    'pre-password-update access JWT');
  await assertPostgrestStillAccepts(newLogin.data.session.access_token,
    'new-password access JWT');

  const sessionC = await signIn(newPassword);
  const sessionD = await signIn(newPassword);
  assert.equal(sessionC.error, null);
  assert.equal(sessionD.error, null);
  assert.ok(sessionC.data.session.access_token, 'sensitive route probe requires an access JWT');
  const sessionCClaims = JSON.parse(Buffer.from(sessionC.data.session.access_token.split('.')[1], 'base64url').toString('utf8'));
  assert.match(sessionCClaims.session_id || '', /^[0-9a-f-]{36}$/i, 'JWT must contain the Supabase session_id UUID');
  await installSensitiveSessionPolicy();
  await assertPostgrestStillAccepts(sessionC.data.session.access_token,
    'active session under the sensitive-operation session policy');

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
  // Baseline RLS still accepts this signed JWT until exp; the sensitive policy
  // additionally checks auth.sessions and therefore denies it after sign-out.
  await assertPostgrestRlsDenies(sessionC.data.session.access_token,
    'revoked session under the sensitive-operation session policy');
  await restoreBaselineJwtExpiryPolicy();
  await assertPostgrestRejectsExpiredJwt(sessionC.data.session.access_token,
    'same old JWT after its actual 900-second expiry');

  console.log('PASS: PostgREST rejected the exact same signed JWT after its actual 900-second expiry.');
  console.log('PASS: disposable local Auth password update, old/new password behavior, refresh revocation, and Auth getUser rejection.');
  console.log('PASS: targeted RLS session_id check denied the still-unexpired JWT after global sign-out while allowing it before sign-out.');
  console.log('OBSERVATION: baseline PostgREST/RLS without a session lookup still accepts a signed old JWT until exp; the session-aware policy closes that window for the protected probe route only.');
  console.log('SECURITY NOTE: session_id validation is a targeted sensitive-operation control; ordinary RLS behavior and bounded JWT expiry remain separate controls.');
} finally {
  try {
    if (probeTableCreated) {
      await pool.query(`DROP TABLE IF EXISTS public.${tableName}`);
    }
    await pool.query(`DROP SCHEMA IF EXISTS ${privateSchema} CASCADE`);
  } finally {
    await pool.end();
    if (userId) {
      const removed = await admin.auth.admin.deleteUser(userId);
      assert.equal(removed.error, null, 'disposable Auth test user cleanup must succeed');
    }
  }
}
