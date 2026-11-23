-- EXPERIMENTAL ONLY: dedicated SMS Outbox lease protocol.
-- Apply only after the disposable recovery request schema exists. Never deploy as-is.
BEGIN;
CREATE TABLE IF NOT EXISTS public.trainee_password_recovery_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recovery_request_id uuid NOT NULL
    REFERENCES public.trainee_password_recovery_requests(id) ON DELETE CASCADE,
  delivery_operation_id uuid NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','sent','failed','unknown')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0 AND attempt_count <= 10),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lock_owner uuid,
  locked_until timestamptz,
  lease_generation bigint NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
  send_started_at timestamptz,
  provider_idempotency_key text NOT NULL UNIQUE,
  provider_message_id text,
  last_safe_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'processing' AND lock_owner IS NOT NULL AND locked_until IS NOT NULL)
      OR (status <> 'processing' AND lock_owner IS NULL AND locked_until IS NULL))
);
CREATE INDEX IF NOT EXISTS trainee_password_recovery_outbox_claim_idx
  ON public.trainee_password_recovery_outbox(next_attempt_at, created_at)
  WHERE status IN ('pending','processing');

CREATE SCHEMA IF NOT EXISTS recovery_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA recovery_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA recovery_private TO service_role;

CREATE OR REPLACE FUNCTION recovery_private.claim_recovery_outbox(
  p_worker_id uuid, p_lease_seconds integer DEFAULT 60
)
RETURNS TABLE(outbox_id uuid, recovery_request_id uuid, lease_generation bigint,
              locked_until timestamptz, provider_idempotency_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_row public.trainee_password_recovery_outbox%ROWTYPE;
BEGIN
  IF p_worker_id IS NULL OR p_lease_seconds NOT BETWEEN 5 AND 600 THEN
    RAISE EXCEPTION 'invalid worker or lease duration';
  END IF;
  SELECT o.* INTO v_row
  FROM public.trainee_password_recovery_outbox o
  WHERE ((o.status = 'pending' AND o.next_attempt_at <= now())
      OR (o.status = 'processing' AND o.locked_until <= now() AND o.send_started_at IS NULL))
    AND EXISTS (
      SELECT 1
      FROM public.trainee_password_recovery_requests r
      JOIN public.trainees t ON t.id=r.trainee_id
      WHERE r.id=o.recovery_request_id AND r.status='approved'
        AND r.delivery_outcome='pending'
        AND r.delivery_operation_id=o.delivery_operation_id
        AND r.reviewed_by IS NOT NULL AND t.coach_user_id = r.reviewed_by
        AND t.approval_status='active' AND t.archived_at IS NULL
    )
  ORDER BY o.next_attempt_at, o.created_at
  FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.trainee_password_recovery_outbox o
  SET status='processing', lock_owner=p_worker_id,
      locked_until=now() + make_interval(secs => p_lease_seconds),
      lease_generation=o.lease_generation + 1, updated_at=now()
  WHERE o.id=v_row.id
  RETURNING o.id,o.recovery_request_id,o.lease_generation,o.locked_until,o.provider_idempotency_key
  INTO outbox_id,recovery_request_id,lease_generation,locked_until,provider_idempotency_key;
  RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION recovery_private.heartbeat_recovery_outbox(
  p_outbox_id uuid,p_worker_id uuid,p_generation bigint,p_lease_seconds integer DEFAULT 60
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF p_lease_seconds NOT BETWEEN 5 AND 600 THEN RETURN false; END IF;
  UPDATE public.trainee_password_recovery_outbox
  SET locked_until=now()+make_interval(secs=>p_lease_seconds),updated_at=now()
  WHERE id=p_outbox_id AND status='processing' AND lock_owner=p_worker_id
    AND lease_generation=p_generation AND locked_until>now();
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION recovery_private.begin_recovery_outbox_send(
  p_outbox_id uuid,p_worker_id uuid,p_generation bigint
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_row public.trainee_password_recovery_outbox%ROWTYPE;
        v_assignment_changed boolean;
BEGIN
  SELECT * INTO v_row FROM public.trainee_password_recovery_outbox
  WHERE id=p_outbox_id AND status='processing' AND lock_owner=p_worker_id
    AND lease_generation=p_generation AND locked_until>now()
    AND send_started_at IS NULL AND attempt_count<10
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  -- Lock the trainee row while re-checking the current coach assignment.
  -- This serializes the send-start transition against concurrent reassignment.
  SELECT (t.coach_user_id IS DISTINCT FROM r.reviewed_by
       OR t.approval_status IS DISTINCT FROM 'active'
       OR t.archived_at IS NOT NULL)
    INTO v_assignment_changed
  FROM public.trainee_password_recovery_requests r
  JOIN public.trainees t ON t.id=r.trainee_id
  WHERE r.id=v_row.recovery_request_id
    AND r.status='approved'
    AND r.delivery_operation_id=v_row.delivery_operation_id
    AND r.delivery_outcome='pending'
  FOR SHARE OF t;

  IF v_assignment_changed IS TRUE THEN
    UPDATE public.trainee_password_recovery_requests
    SET status='expired',token_hash=NULL,token_expires_at=NULL,
        delivery_outcome='confirmed_failure',updated_at=now()
    WHERE id=v_row.recovery_request_id AND status='approved'
      AND delivery_operation_id=v_row.delivery_operation_id
      AND delivery_outcome='pending';
    UPDATE public.trainee_password_recovery_outbox
    SET status='failed',lock_owner=NULL,locked_until=NULL,
        last_safe_error_code='coach_assignment_changed',
        delivery_payload=NULL,updated_at=now()
    WHERE id=p_outbox_id AND status='processing' AND lock_owner=p_worker_id
      AND lease_generation=p_generation AND send_started_at IS NULL;
    RETURN false;
  END IF;

  UPDATE public.trainee_password_recovery_requests r
  SET delivery_outcome='attempting',delivery_attempted_at=now(),updated_at=now()
  WHERE r.id=v_row.recovery_request_id AND r.status='approved'
    AND r.delivery_operation_id=v_row.delivery_operation_id
    AND r.delivery_outcome='pending'
    AND EXISTS (
      SELECT 1 FROM public.trainees t
      WHERE t.id=r.trainee_id
        AND r.reviewed_by IS NOT NULL AND t.coach_user_id = r.reviewed_by
        AND t.approval_status='active' AND t.archived_at IS NULL
    );
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.trainee_password_recovery_outbox
  SET send_started_at=now(),attempt_count=attempt_count+1,updated_at=now()
  WHERE id=p_outbox_id AND status='processing' AND lock_owner=p_worker_id
    AND lease_generation=p_generation AND locked_until>now()
    AND send_started_at IS NULL;
  IF NOT FOUND THEN
    -- The request row was already updated in this transaction. Raising (not
    -- returning false) forces the caller's transaction to roll back both rows.
    RAISE EXCEPTION 'outbox send-start state changed';
  END IF;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION recovery_private.finish_recovery_outbox(
  p_outbox_id uuid,p_worker_id uuid,p_generation bigint,p_outcome text,
  p_provider_message_id text DEFAULT NULL,p_safe_error_code text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_row public.trainee_password_recovery_outbox%ROWTYPE;
        v_request_outcome text;
BEGIN
  IF p_outcome NOT IN ('sent','failed','unknown') THEN RAISE EXCEPTION 'invalid outcome'; END IF;
  IF p_outcome IN ('sent','failed') AND p_provider_message_id IS NOT NULL
     AND length(p_provider_message_id)>128 THEN RAISE EXCEPTION 'invalid message id'; END IF;
  IF p_safe_error_code IS NOT NULL AND
     (length(p_safe_error_code) NOT BETWEEN 1 AND 64 OR p_safe_error_code !~ '^[a-z0-9_.-]+$')
     THEN RAISE EXCEPTION 'invalid safe error code'; END IF;
  SELECT * INTO v_row FROM public.trainee_password_recovery_outbox
  WHERE id=p_outbox_id AND status='processing' AND lock_owner=p_worker_id
    AND lease_generation=p_generation AND send_started_at IS NOT NULL
    AND locked_until>now()
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  v_request_outcome := CASE p_outcome WHEN 'sent' THEN 'sent'
    WHEN 'failed' THEN 'confirmed_failure' ELSE 'unknown' END;
  UPDATE public.trainee_password_recovery_requests
  SET status=CASE WHEN v_request_outcome='confirmed_failure' THEN 'pending' ELSE 'approved' END,
      token_hash=CASE WHEN v_request_outcome='confirmed_failure' THEN NULL ELSE token_hash END,
      token_expires_at=CASE WHEN v_request_outcome='confirmed_failure' THEN NULL ELSE token_expires_at END,
      reviewed_at=CASE WHEN v_request_outcome='confirmed_failure' THEN NULL ELSE reviewed_at END,
      reviewed_by=CASE WHEN v_request_outcome='confirmed_failure' THEN NULL ELSE reviewed_by END,
      token_attempts=CASE WHEN v_request_outcome='confirmed_failure' THEN 0 ELSE token_attempts END,
      delivery_outcome=v_request_outcome,updated_at=now()
  WHERE id=v_row.recovery_request_id AND status='approved'
    AND delivery_operation_id=v_row.delivery_operation_id
    AND delivery_outcome='attempting';
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.trainee_password_recovery_outbox
  SET status=p_outcome,
      provider_message_id=CASE WHEN p_outcome='sent' THEN p_provider_message_id ELSE NULL END,
      last_safe_error_code=p_safe_error_code,
      lock_owner=NULL,locked_until=NULL,updated_at=now()
  WHERE id=p_outbox_id AND status='processing' AND lock_owner=p_worker_id
    AND lease_generation=p_generation;
  IF NOT FOUND THEN
    -- Do not allow a committed request transition without its Outbox transition.
    RAISE EXCEPTION 'outbox completion state changed';
  END IF;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION recovery_private.reconcile_expired_recovery_outbox()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_count integer;
BEGIN
  WITH expired AS (
    SELECT id,recovery_request_id,delivery_operation_id
    FROM public.trainee_password_recovery_outbox
    WHERE status='processing' AND locked_until<=now() AND send_started_at IS NOT NULL
    FOR UPDATE
  ), request_updates AS (
    UPDATE public.trainee_password_recovery_requests r
    SET delivery_outcome='unknown',updated_at=now()
    FROM expired e
    WHERE r.id=e.recovery_request_id AND r.status='approved'
      AND r.delivery_operation_id=e.delivery_operation_id
      AND r.delivery_outcome='attempting'
    RETURNING e.id
  ), outbox_updates AS (
    UPDATE public.trainee_password_recovery_outbox o
    SET status='unknown',lock_owner=NULL,locked_until=NULL,
        last_safe_error_code='lease_expired_after_send_start',updated_at=now()
    FROM expired e JOIN request_updates ru ON ru.id=e.id
    WHERE o.id=e.id
    RETURNING o.id
  )
  SELECT count(*)::integer INTO v_count FROM outbox_updates;
  RETURN v_count;
END $$;


-- The approved request and its SMS outbox row are committed in the same transaction.
-- Each approval has its own immutable delivery operation; a later coach re-approval
-- after confirmed non-delivery therefore creates a distinct Outbox item.
CREATE OR REPLACE FUNCTION recovery_private.enqueue_approved_recovery_delivery()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $outbox_trigger$
DECLARE v_outbox_operation uuid;
BEGIN
  IF NEW.status='approved' AND NEW.delivery_outcome='pending'
     AND NEW.delivery_operation_id IS NOT NULL
     AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status
          OR OLD.delivery_outcome IS DISTINCT FROM NEW.delivery_outcome
          OR OLD.delivery_operation_id IS DISTINCT FROM NEW.delivery_operation_id) THEN
    INSERT INTO public.trainee_password_recovery_outbox
      (recovery_request_id,delivery_operation_id,provider_idempotency_key)
    VALUES
      (NEW.id,NEW.delivery_operation_id,'trainee-recovery:'||NEW.delivery_operation_id::text)
    ON CONFLICT (delivery_operation_id) DO NOTHING;

    SELECT o.delivery_operation_id INTO v_outbox_operation
    FROM public.trainee_password_recovery_outbox o
    WHERE o.recovery_request_id=NEW.id
      AND o.delivery_operation_id=NEW.delivery_operation_id;

    IF v_outbox_operation IS NULL THEN
      RAISE EXCEPTION 'recovery outbox enqueue invariant failed';
    END IF;
  END IF;
  RETURN NEW;
END $outbox_trigger$;

DROP TRIGGER IF EXISTS trainee_recovery_enqueue_outbox ON public.trainee_password_recovery_requests;
CREATE TRIGGER trainee_recovery_enqueue_outbox
AFTER INSERT OR UPDATE OF status,delivery_outcome,delivery_operation_id
ON public.trainee_password_recovery_requests
FOR EACH ROW EXECUTE FUNCTION recovery_private.enqueue_approved_recovery_delivery();

REVOKE ALL ON FUNCTION recovery_private.enqueue_approved_recovery_delivery() FROM PUBLIC,anon,authenticated;

-- Public-schema RPC wrappers are required for Supabase/PostgREST Edge clients.
-- The private schema remains unexposed; only service_role may invoke these wrappers.
CREATE OR REPLACE FUNCTION public.recovery_outbox_claim(p_worker_id uuid,p_lease_seconds integer DEFAULT 60)
RETURNS TABLE(outbox_id uuid,recovery_request_id uuid,lease_generation bigint,
              locked_until timestamptz,provider_idempotency_key text)
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $wrapper$ SELECT * FROM recovery_private.claim_recovery_outbox(p_worker_id,p_lease_seconds) $wrapper$;

CREATE OR REPLACE FUNCTION public.recovery_outbox_heartbeat(
  p_outbox_id uuid,p_worker_id uuid,p_generation bigint,p_lease_seconds integer DEFAULT 60
) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $wrapper$ SELECT recovery_private.heartbeat_recovery_outbox(p_outbox_id,p_worker_id,p_generation,p_lease_seconds) $wrapper$;

CREATE OR REPLACE FUNCTION public.recovery_outbox_begin_send(
  p_outbox_id uuid,p_worker_id uuid,p_generation bigint
) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $wrapper$ SELECT recovery_private.begin_recovery_outbox_send(p_outbox_id,p_worker_id,p_generation) $wrapper$;

CREATE OR REPLACE FUNCTION public.recovery_outbox_finish(
  p_outbox_id uuid,p_worker_id uuid,p_generation bigint,p_outcome text,
  p_provider_message_id text DEFAULT NULL,p_safe_error_code text DEFAULT NULL
) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $wrapper$ SELECT recovery_private.finish_recovery_outbox(
  p_outbox_id,p_worker_id,p_generation,p_outcome,p_provider_message_id,p_safe_error_code
) $wrapper$;

CREATE OR REPLACE FUNCTION public.recovery_outbox_reconcile_expired()
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $wrapper$ SELECT recovery_private.reconcile_expired_recovery_outbox() $wrapper$;

REVOKE ALL ON FUNCTION public.recovery_outbox_claim(uuid,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.recovery_outbox_heartbeat(uuid,uuid,bigint,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.recovery_outbox_begin_send(uuid,uuid,bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.recovery_outbox_finish(uuid,uuid,bigint,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.recovery_outbox_reconcile_expired() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recovery_outbox_claim(uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.recovery_outbox_heartbeat(uuid,uuid,bigint,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.recovery_outbox_begin_send(uuid,uuid,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.recovery_outbox_finish(uuid,uuid,bigint,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.recovery_outbox_reconcile_expired() TO service_role;

REVOKE ALL ON public.trainee_password_recovery_outbox FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.trainee_password_recovery_outbox TO service_role;
REVOKE ALL ON FUNCTION recovery_private.claim_recovery_outbox(uuid,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION recovery_private.heartbeat_recovery_outbox(uuid,uuid,bigint,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION recovery_private.begin_recovery_outbox_send(uuid,uuid,bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION recovery_private.finish_recovery_outbox(uuid,uuid,bigint,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION recovery_private.reconcile_expired_recovery_outbox() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION recovery_private.claim_recovery_outbox(uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION recovery_private.heartbeat_recovery_outbox(uuid,uuid,bigint,integer) TO service_role;
GRANT EXECUTE ON FUNCTION recovery_private.begin_recovery_outbox_send(uuid,uuid,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION recovery_private.finish_recovery_outbox(uuid,uuid,bigint,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION recovery_private.reconcile_expired_recovery_outbox() TO service_role;
COMMIT;
