/**
 * Supabase Edge Function packaging candidate copied from the isolated experiment.
 * This path is deployment-shaped for local bundle/type-check only.
 * It is NOT approved for deployment until mirror schema, backup/restore, provider and release gates pass.
 * No SMS provider is configured; coach approval is fail-closed until one is reviewed.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";
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
    RECOVERY_HMAC_KEYS: Deno.env.get("RECOVERY_HMAC_KEYS"),
    RECOVERY_HMAC_KEY_VERSION: Deno.env.get("RECOVERY_HMAC_KEY_VERSION"),
    RECOVERY_DELIVERY_KEYS: Deno.env.get("RECOVERY_DELIVERY_KEYS"),
    RECOVERY_DELIVERY_KEY_VERSION: Deno.env.get("RECOVERY_DELIVERY_KEY_VERSION"),
    RECOVERY_ALLOWED_ORIGINS: Deno.env.get("RECOVERY_ALLOWED_ORIGINS")
  },
  admin,
  createUserClient
  // Intentionally no deliveryAdapter: no provider is enabled and no real SMS can be sent.
});

Deno.serve(handler);
