-- EXPERIMENTAL ONLY. Apply after the atomic RPC and Outbox candidate migrations
-- on disposable PostgreSQL. Never deploy to Supabase or production as-is.
BEGIN;

ALTER TABLE public.trainee_password_recovery_requests
  ADD COLUMN IF NOT EXISTS delivery_payload jsonb;
ALTER TABLE public.trainee_password_recovery_outbox
  ADD COLUMN IF NOT EXISTS delivery_payload jsonb;

-- Strict envelope shape: AES-256-GCM v1, 96-bit IV (12 bytes), 4-digit
-- plaintext + 128-bit GCM tag (20 bytes total). No plaintext column exists.
ALTER TABLE public.trainee_password_recovery_requests
  DROP CONSTRAINT IF EXISTS trainee_recovery_delivery_payload_shape_check;
ALTER TABLE public.trainee_password_recovery_requests
  ADD CONSTRAINT trainee_recovery_delivery_payload_shape_check CHECK (
    delivery_payload IS NULL OR (
      jsonb_typeof(delivery_payload) = 'object'
      AND delivery_payload ?& ARRAY['v','alg','kid','iv','ct']
      AND jsonb_object_length(delivery_payload) = 5
      AND delivery_payload->>'v' = '1'
      AND delivery_payload->>'alg' = 'A256GCM'
      AND delivery_payload->>'kid' ~ '^[A-Za-z0-9_-]{1,32}$'
      AND delivery_payload->>'iv' ~ '^[A-Za-z0-9+/]{16}$'
      AND delivery_payload->>'ct' ~ '^[A-Za-z0-9+/]{28}$'
    )
  );
ALTER TABLE public.trainee_password_recovery_outbox
  DROP CONSTRAINT IF EXISTS trainee_recovery_outbox_payload_shape_check;
ALTER TABLE public.trainee_password_recovery_outbox
  ADD CONSTRAINT trainee_recovery_outbox_payload_shape_check CHECK (
    delivery_payload IS NULL OR (
      jsonb_typeof(delivery_payload) = 'object'
      AND delivery_payload ?& ARRAY['v','alg','kid','iv','ct']
      AND jsonb_object_length(delivery_payload) = 5
      AND delivery_payload->>'v' = '1'
      AND delivery_payload->>'alg' = 'A256GCM'
      AND delivery_payload->>'kid' ~ '^[A-Za-z0-9_-]{1,32}$'
      AND delivery_payload->>'iv' ~ '^[A-Za-z0-9+/]{16}$'
      AND delivery_payload->>'ct' ~ '^[A-Za-z0-9+/]{28}$'
    )
  );

-- The operation UUID is caller-generated before encryption, so AES-GCM AAD
-- can bind ciphertext to both request and immutable delivery operation.
CREATE OR REPLACE FUNCTION recovery_private.coach_review_recovery_request_encrypted(
  p_request_id uuid,
  p_actor_user_id uuid,
  p_decision text,
  p_token_hash text DEFAULT NULL,
  p_token_expires_at timestamptz DEFAULT NULL,
  p_hmac_key_version text DEFAULT NULL,
  p_delivery_operation_id uuid DEFAULT NULL,
  p_delivery_payload jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_trainee_id uuid;
  v_status text;
  v_actor_role text;
  v_current_coach uuid;
  v_approval_status text;
  v_archived_at timestamptz;
BEGIN
  IF p_decision IS NULL OR p_decision NOT IN ('approve','reject') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_decision');
  END IF;
  SELECT pr.role INTO v_actor_role FROM public.profiles pr
  WHERE pr.id=p_actor_user_id FOR SHARE;
  IF v_actor_role IS DISTINCT FROM 'coach' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authorized');
  END IF;
  SELECT r.trainee_id,r.status INTO v_trainee_id,v_status
  FROM public.trainee_password_recovery_requests r
  WHERE r.id=p_request_id FOR UPDATE;
  IF NOT FOUND OR v_status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_available');
  END IF;
  SELECT t.coach_user_id,t.approval_status,t.archived_at
  INTO v_current_coach,v_approval_status,v_archived_at
  FROM public.trainees t WHERE t.id=v_trainee_id FOR UPDATE;
  IF NOT FOUND OR v_current_coach IS DISTINCT FROM p_actor_user_id
     OR v_approval_status <> 'active' OR v_archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authorized');
  END IF;
  IF p_decision='reject' THEN
    IF p_delivery_operation_id IS NOT NULL OR p_delivery_payload IS NOT NULL
       OR p_token_hash IS NOT NULL OR p_token_expires_at IS NOT NULL OR p_hmac_key_version IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'unexpected_reject_payload');
    END IF;
    UPDATE public.trainee_password_recovery_requests
    SET status='rejected',reviewed_at=now(),reviewed_by=p_actor_user_id,updated_at=now()
    WHERE id=p_request_id AND status='pending';
    RETURN jsonb_build_object('ok',true,'status','rejected');
  END IF;
  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$'
     OR p_hmac_key_version IS NULL OR p_hmac_key_version !~ '^[A-Za-z0-9_-]{1,32}$'
     OR p_token_expires_at IS NULL OR p_token_expires_at <= now()
     OR p_token_expires_at > now()+interval '20 minutes'
     OR p_delivery_operation_id IS NULL
     OR p_delivery_payload IS NULL
     OR jsonb_typeof(p_delivery_payload) <> 'object'
     OR NOT (p_delivery_payload ?& ARRAY['v','alg','kid','iv','ct'])
     OR jsonb_object_length(p_delivery_payload) <> 5
     OR p_delivery_payload->>'v' <> '1'
     OR p_delivery_payload->>'alg' <> 'A256GCM'
     OR p_delivery_payload->>'kid' !~ '^[A-Za-z0-9_-]{1,32}$'
     OR p_delivery_payload->>'iv' !~ '^[A-Za-z0-9+/]{16}$'
     OR p_delivery_payload->>'ct' !~ '^[A-Za-z0-9+/]{28}$'
     THEN
    RETURN jsonb_build_object('ok',false,'reason','invalid_token_material');
  END IF;
  UPDATE public.trainee_password_recovery_requests
  SET status='approved',reviewed_at=now(),reviewed_by=p_actor_user_id,
      token_hash=p_token_hash,token_expires_at=p_token_expires_at,
      token_attempts=0,hmac_key_version=p_hmac_key_version,
      delivery_operation_id=p_delivery_operation_id,delivery_outcome='pending',
      delivery_attempted_at=NULL,delivery_payload=p_delivery_payload,
      operation_id=NULL,processing_started_at=NULL,auth_outcome=NULL,
      auth_attempted_at=NULL,auth_last_error_code=NULL,updated_at=now()
  WHERE id=p_request_id AND status='pending';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','not_available'); END IF;
  RETURN jsonb_build_object('ok',true,'status','approved',
    'delivery_operation_id',p_delivery_operation_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.recovery_coach_review_encrypted(
  p_request_id uuid,p_actor_user_id uuid,p_decision text,
  p_token_hash text,p_token_expires_at timestamptz,p_hmac_key_version text,
  p_delivery_operation_id uuid,p_delivery_payload jsonb
)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $wrap$ SELECT recovery_private.coach_review_recovery_request_encrypted(
  p_request_id,p_actor_user_id,p_decision,p_token_hash,p_token_expires_at,
  p_hmac_key_version,p_delivery_operation_id,p_delivery_payload
) $wrap$;

-- Replace enqueue trigger so ciphertext is copied in the same transaction.
CREATE OR REPLACE FUNCTION recovery_private.enqueue_approved_recovery_delivery()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $outbox_trigger$
DECLARE v_outbox_operation uuid;
BEGIN
  IF NEW.status='approved' AND NEW.delivery_outcome='pending'
     AND NEW.delivery_operation_id IS NOT NULL
     AND NEW.delivery_payload IS NOT NULL
     AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status
          OR OLD.delivery_outcome IS DISTINCT FROM NEW.delivery_outcome
          OR OLD.delivery_operation_id IS DISTINCT FROM NEW.delivery_operation_id) THEN
    INSERT INTO public.trainee_password_recovery_outbox
      (recovery_request_id,delivery_operation_id,provider_idempotency_key,delivery_payload)
    VALUES
      (NEW.id,NEW.delivery_operation_id,'trainee-recovery:'||NEW.delivery_operation_id::text,NEW.delivery_payload)
    ON CONFLICT (delivery_operation_id) DO NOTHING;
    SELECT o.delivery_operation_id INTO v_outbox_operation
    FROM public.trainee_password_recovery_outbox o
    WHERE o.recovery_request_id=NEW.id AND o.delivery_operation_id=NEW.delivery_operation_id
      AND o.delivery_payload=NEW.delivery_payload;
    IF v_outbox_operation IS NULL THEN
      RAISE EXCEPTION 'encrypted recovery outbox enqueue invariant failed';
    END IF;
  END IF;
  RETURN NEW;
END $outbox_trigger$;

-- Clear ciphertext from both records on every terminal delivery outcome.
CREATE OR REPLACE FUNCTION recovery_private.clear_terminal_recovery_payload()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $clear_payload$
BEGIN
  IF TG_TABLE_NAME='trainee_password_recovery_requests'
     AND NEW.delivery_outcome IN ('sent','confirmed_failure','unknown') THEN
    NEW.delivery_payload := NULL;
  ELSIF TG_TABLE_NAME='trainee_password_recovery_outbox'
     AND NEW.status IN ('sent','failed','unknown') THEN
    NEW.delivery_payload := NULL;
  END IF;
  RETURN NEW;
END $clear_payload$;
DROP TRIGGER IF EXISTS trainee_recovery_clear_terminal_payload ON public.trainee_password_recovery_requests;
CREATE TRIGGER trainee_recovery_clear_terminal_payload
BEFORE UPDATE OF delivery_outcome ON public.trainee_password_recovery_requests
FOR EACH ROW EXECUTE FUNCTION recovery_private.clear_terminal_recovery_payload();
DROP TRIGGER IF EXISTS trainee_recovery_outbox_clear_terminal_payload ON public.trainee_password_recovery_outbox;
CREATE TRIGGER trainee_recovery_outbox_clear_terminal_payload
BEFORE UPDATE OF status ON public.trainee_password_recovery_outbox
FOR EACH ROW EXECUTE FUNCTION recovery_private.clear_terminal_recovery_payload();

CREATE OR REPLACE FUNCTION recovery_private.fetch_recovery_outbox_payload(
  p_outbox_id uuid,p_worker_id uuid,p_generation bigint
)
RETURNS TABLE(recovery_request_id uuid,delivery_operation_id uuid,delivery_payload jsonb)
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $fetch_payload$
  SELECT o.recovery_request_id,o.delivery_operation_id,o.delivery_payload
  FROM public.trainee_password_recovery_outbox o
  JOIN public.trainee_password_recovery_requests r
    ON r.id=o.recovery_request_id
   AND r.delivery_operation_id=o.delivery_operation_id
  WHERE o.id=p_outbox_id AND o.status='processing'
    AND o.lock_owner=p_worker_id AND o.lease_generation=p_generation
    AND o.locked_until>now() AND o.send_started_at IS NOT NULL
    AND o.delivery_payload IS NOT NULL
    AND r.status='approved' AND r.delivery_outcome='attempting'
    AND r.delivery_payload IS NOT NULL
    AND r.delivery_payload=o.delivery_payload
$fetch_payload$;

CREATE OR REPLACE FUNCTION public.recovery_outbox_fetch_payload(
  p_outbox_id uuid,p_worker_id uuid,p_generation bigint
)
RETURNS TABLE(recovery_request_id uuid,delivery_operation_id uuid,delivery_payload jsonb)
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $fetch_wrapper$ SELECT * FROM recovery_private.fetch_recovery_outbox_payload(
  p_outbox_id,p_worker_id,p_generation
) $fetch_wrapper$;

REVOKE ALL ON FUNCTION recovery_private.fetch_recovery_outbox_payload(uuid,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION recovery_private.fetch_recovery_outbox_payload(uuid,uuid,bigint) TO service_role;
REVOKE ALL ON FUNCTION public.recovery_outbox_fetch_payload(uuid,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recovery_outbox_fetch_payload(uuid,uuid,bigint) TO service_role;
REVOKE ALL ON FUNCTION recovery_private.coach_review_recovery_request_encrypted(uuid,uuid,text,text,timestamptz,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION recovery_private.coach_review_recovery_request_encrypted(uuid,uuid,text,text,timestamptz,text,uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.recovery_coach_review_encrypted(uuid,uuid,text,text,timestamptz,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recovery_coach_review_encrypted(uuid,uuid,text,text,timestamptz,text,uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION recovery_private.clear_terminal_recovery_payload() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION recovery_private.enqueue_approved_recovery_delivery() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.trainee_password_recovery_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT,UPDATE ON public.trainee_password_recovery_requests TO service_role;
REVOKE ALL ON public.trainee_password_recovery_outbox FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.trainee_password_recovery_outbox TO service_role;

COMMIT;
