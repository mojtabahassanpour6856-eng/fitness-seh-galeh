-- EXPERIMENTAL ONLY: dedicated SMS Outbox lease protocol.
-- Apply only after the disposable recovery request schema exists. Never deploy as-is.
BEGIN;
CREATE TABLE IF NOT EXISTS public.trainee_password_recovery_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recovery_request_id uuid NOT NULL UNIQUE
    REFERENCES public.trainee_password_recovery_requests(id) ON DELETE CASCADE,
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
  WHERE (o.status = 'pending' AND o.next_attempt_at <= now())
     OR (o.status = 'processing' AND o.locked_until <= now() AND o.send_started_at IS NULL)
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
BEGIN
  UPDATE public.trainee_password_recovery_outbox
  SET send_started_at=now(),attempt_count=attempt_count+1,updated_at=now()
  WHERE id=p_outbox_id AND status='processing' AND lock_owner=p_worker_id
    AND lease_generation=p_generation AND locked_until>now()
    AND send_started_at IS NULL AND attempt_count<10;
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION recovery_private.finish_recovery_outbox(
  p_outbox_id uuid,p_worker_id uuid,p_generation bigint,p_outcome text,
  p_provider_message_id text DEFAULT NULL,p_safe_error_code text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF p_outcome NOT IN ('sent','failed','unknown') THEN RAISE EXCEPTION 'invalid outcome'; END IF;
  IF p_outcome IN ('sent','failed') AND p_provider_message_id IS NOT NULL
     AND length(p_provider_message_id)>128 THEN RAISE EXCEPTION 'invalid message id'; END IF;
  IF p_safe_error_code IS NOT NULL AND
     (length(p_safe_error_code) NOT BETWEEN 1 AND 64 OR p_safe_error_code !~ '^[a-z0-9_.-]+$')
     THEN RAISE EXCEPTION 'invalid safe error code'; END IF;
  UPDATE public.trainee_password_recovery_outbox
  SET status=p_outcome,provider_message_id=CASE WHEN p_outcome='sent' THEN p_provider_message_id ELSE NULL END,
      last_safe_error_code=p_safe_error_code,lock_owner=NULL,locked_until=NULL,updated_at=now()
  WHERE id=p_outbox_id AND status='processing' AND lock_owner=p_worker_id
    AND lease_generation=p_generation AND send_started_at IS NOT NULL;
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION recovery_private.reconcile_expired_recovery_outbox()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_count integer;
BEGIN
  UPDATE public.trainee_password_recovery_outbox
  SET status='unknown',lock_owner=NULL,locked_until=NULL,
      last_safe_error_code='lease_expired_after_send_start',updated_at=now()
  WHERE status='processing' AND locked_until<=now() AND send_started_at IS NOT NULL;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
END $$;

REVOKE ALL ON public.trainee_password_recovery_outbox FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.trainee_password_recovery_outbox TO service_role;
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
