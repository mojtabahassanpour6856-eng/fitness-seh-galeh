/**
 * Supabase Edge Runtime adapter candidate.
 * Deliberately stored under docs/experimental, NOT supabase/functions.
 * Do not deploy without explicit approval and completion of the release gates.
 * No SMS provider is configured; coach approval is fail-closed until one is reviewed.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
// @ts-ignore -- dependency-injected Node/Deno-compatible candidate module is intentionally kept in docs/experimental.
import { createRecoveryCandidateHandler } from "./recovery-candidate-handler.mjs";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

if (!supabaseUrl || !serviceRoleKey || !anonKey) {
  throw new Error("Required Supabase server environment is unavailable");
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const createUserClient = (authorization: string) => createClient(supabaseUrl, anonKey, {
  global: { headers: { Authorization: authorization } },
  auth: { autoRefreshToken: false, persistSession: false }
});

const handler = createRecoveryCandidateHandler({
  env: {
    RECOVERY_HMAC_SECRET: Deno.env.get("RECOVERY_HMAC_SECRET"),
    RECOVERY_HMAC_KEY_VERSION: Deno.env.get("RECOVERY_HMAC_KEY_VERSION"),
    RECOVERY_ALLOWED_ORIGINS: Deno.env.get("RECOVERY_ALLOWED_ORIGINS")
  },
  admin,
  createUserClient
  // Intentionally no deliveryAdapter: no provider is enabled and no real SMS can be sent.
});

Deno.serve(handler);
