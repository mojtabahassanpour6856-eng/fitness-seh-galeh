import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return reply({ error: "Unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
    const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
    const subject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com";
    if (!url || !anonKey || !serviceKey) return reply({ error: "Server configuration incomplete" }, 500);

    const caller = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userError } = await caller.auth.getUser();
    const user = userData?.user;
    if (userError || !user) return reply({ error: "Unauthorized" }, 401);

    const input = await req.json().catch(() => ({}));
    const traineeId = String(input?.trainee_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(traineeId)) return reply({ error: "Invalid trainee_id" }, 400);

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: trainee, error: traineeError } = await admin
      .from("trainees")
      .select("id, full_name, coach_user_id")
      .eq("id", traineeId)
      .maybeSingle();
    if (traineeError) return reply({ error: "Unable to verify trainee" }, 500);
    if (!trainee || trainee.coach_user_id !== user.id) return reply({ error: "Forbidden" }, 403);
    if (!publicKey || !privateKey) {
      return reply({ ok: false, configured: false, reason: "VAPID secrets are not configured yet" }, 200);
    }

    const { data: subscriptions, error: subError } = await admin
      .from("trainee_push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("trainee_id", trainee.id);
    if (subError) return reply({ error: "Unable to load trainee subscriptions" }, 500);
    if (!subscriptions?.length) return reply({ ok: true, sent: 0, reason: "No registered trainee devices" });

    webpush.setVapidDetails(subject, publicKey, privateKey);
    const payload = JSON.stringify({
      title: "فیتنس سه‌قلعه",
      body: "مربی برای شما پیام جدید فرستاد.",
      tag: "seh-coach-chat-" + trainee.id
    });

    let sent = 0;
    const staleIds: string[] = [];
    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { TTL: 60 * 60, urgency: "high" },
        );
        sent++;
      } catch (e) {
        const status = Number((e as { statusCode?: number })?.statusCode ?? 0);
        if (status === 404 || status === 410) staleIds.push(sub.id);
        console.error("Trainee push send failed", status || "unknown");
      }
    }
    if (staleIds.length) {
      await admin.from("trainee_push_subscriptions").delete().in("id", staleIds);
    }
    return reply({ ok: true, sent, removed_expired: staleIds.length });
  } catch (e) {
    console.error("send-coach-chat-push failed", e);
    return reply({ error: "Unexpected server error" }, 500);
  }
});

function reply(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}
