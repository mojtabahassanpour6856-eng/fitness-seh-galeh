-- EXPERIMENTAL ONLY. Apply only to a disposable PostgreSQL database.
-- This is NOT a Supabase migration and must not be deployed as-is.
BEGIN;

LOCK TABLE public.trainee_password_recovery_requests IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.trainee_password_recovery_requests
    WHERE status IN ('pending','approved','processing')
    GROUP BY trainee_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate active recovery requests exist; refusing index migration';
  END IF;
END
$$;

DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.trainee_password_recovery_requests
    WHERE status IN ('approved','processing')
  ) THEN
    RAISE EXCEPTION
      'Legacy approved/processing requests need an explicit disposition before the candidate migration';
  END IF;
END
$guard$;

ALTER TABLE public.trainee_password_recovery_requests
  ADD COLUMN IF NOT EXISTS operation_id uuid,
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS auth_outcome text,
  ADD COLUMN IF NOT EXISTS auth_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS auth_last_error_code text,
  ADD COLUMN IF NOT EXISTS hmac_key_version text,
  ADD COLUMN IF NOT EXISTS delivery_operation_id uuid,
  ADD COLUMN IF NOT EXISTS delivery_outcome text,
  ADD COLUMN IF NOT EXISTS delivery_attempted_at timestamptz;

ALTER TABLE public.trainee_password_recovery_requests
  DROP CONSTRAINT IF EXISTS trainee_password_recovery_auth_outcome_check;
ALTER TABLE public.trainee_password_recovery_requests
  ADD CONSTRAINT trainee_password_recovery_auth_outcome_check
  CHECK (auth_outcome IS NULL OR auth_outcome IN
    ('claimed','attempting','completed','confirmed_no_change','unknown'));

ALTER TABLE public.trainee_password_recovery_requests
  DROP CONSTRAINT IF EXISTS trainee_password_recovery_delivery_outcome_check;
ALTER TABLE public.trainee_password_recovery_requests
  ADD CONSTRAINT trainee_password_recovery_delivery_outcome_check
  CHECK (delivery_outcome IS NULL OR delivery_outcome IN
    ('pending','attempting','sent','confirmed_failure','unknown'));

ALTER TABLE public.trainee_password_recovery_requests
  DROP CONSTRAINT IF EXISTS trainee_password_recovery_auth_error_code_check;
ALTER TABLE public.trainee_password_recovery_requests
  ADD CONSTRAINT trainee_password_recovery_auth_error_code_check
  CHECK (auth_last_error_code IS NULL OR
    (length(auth_last_error_code) BETWEEN 1 AND 64 AND auth_last_error_code ~ '^[a-z0-9_.-]+$'));

DROP INDEX IF EXISTS public.trainee_password_recovery_one_open_request_per_trainee;
CREATE UNIQUE INDEX trainee_password_recovery_one_open_request_per_trainee
  ON public.trainee_password_recovery_requests (trainee_id)
  WHERE status IN ('pending','approved','processing');

CREATE UNIQUE INDEX IF NOT EXISTS trainee_password_recovery_operation_id_uidx
  ON public.trainee_password_recovery_requests (operation_id)
  WHERE operation_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS trainee_password_recovery_delivery_operation_id_uidx
  ON public.trainee_password_recovery_requests (delivery_operation_id)
  WHERE delivery_operation_id IS NOT NULL;

CREATE SCHEMA IF NOT EXISTS recovery_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA recovery_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA recovery_private TO service_role;

CREATE OR REPLACE FUNCTION recovery_private.submit_recovery_request(
  p_phone_normalized text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $
DECLARE
  v_match_count integer;
  v_trainee_id uuid;
  v_inserted integer;
BEGIN
  IF p_phone_normalized IS NULL OR
     p_phone_normalized !~ '^\\+989[0-9]{9}
  p_request_id uuid,
  p_actor_user_id uuid,
  p_decision text,
  p_token_hash text DEFAULT NULL,
  p_token_expires_at timestamptz DEFAULT NULL,
  p_hmac_key_version text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_trainee_id uuid;
  v_status text;
  v_actor_role text;
  v_current_coach uuid;
  v_approval_status text;
  v_archived_at timestamptz;
  v_delivery_operation_id uuid;
BEGIN
  IF p_decision IS NULL OR p_decision NOT IN ('approve','reject') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_decision');
  END IF;

  SELECT pr.role INTO v_actor_role
  FROM public.profiles AS pr
  WHERE pr.id = p_actor_user_id
  FOR SHARE;

  IF v_actor_role IS DISTINCT FROM 'coach' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authorized');
  END IF;

  SELECT r.trainee_id, r.status
    INTO v_trainee_id, v_status
  FROM public.trainee_password_recovery_requests AS r
  WHERE r.id = p_request_id
  FOR UPDATE;

  IF NOT FOUND OR v_status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_available');
  END IF;

  SELECT t.coach_user_id, t.approval_status, t.archived_at
    INTO v_current_coach, v_approval_status, v_archived_at
  FROM public.trainees AS t
  WHERE t.id = v_trainee_id
  FOR UPDATE;

  IF NOT FOUND OR v_current_coach IS DISTINCT FROM p_actor_user_id
     OR v_approval_status <> 'active' OR v_archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authorized');
  END IF;

  IF p_decision = 'reject' THEN
    UPDATE public.trainee_password_recovery_requests
    SET status = 'rejected', reviewed_at = now(), reviewed_by = p_actor_user_id,
        updated_at = now()
    WHERE id = p_request_id AND status = 'pending';
    RETURN jsonb_build_object('ok', true, 'status', 'rejected');
  END IF;

  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$'
     OR p_hmac_key_version IS NULL
     OR p_hmac_key_version !~ '^[A-Za-z0-9_-]{1,32}$'
     OR p_token_expires_at IS NULL
     OR p_token_expires_at <= now()
     OR p_token_expires_at > now() + interval '20 minutes' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_token_material');
  END IF;

  v_delivery_operation_id := gen_random_uuid();
  UPDATE public.trainee_password_recovery_requests
  SET status = 'approved', reviewed_at = now(), reviewed_by = p_actor_user_id,
      token_hash = p_token_hash, token_expires_at = p_token_expires_at,
      token_attempts = 0, hmac_key_version = p_hmac_key_version,
      delivery_operation_id = v_delivery_operation_id,
      delivery_outcome = 'pending', delivery_attempted_at = NULL,
      operation_id = NULL, processing_started_at = NULL,
      auth_outcome = NULL, auth_attempted_at = NULL, auth_last_error_code = NULL,
      updated_at = now()
  WHERE id = p_request_id AND status = 'pending';

  RETURN jsonb_build_object('ok', true, 'status', 'approved', 'delivery_operation_id', v_delivery_operation_id);
END;
$$;

CREATE OR REPLACE FUNCTION recovery_private.record_recovery_wrong_attempt(
  p_request_id uuid,
  p_submitted_digest text,
  p_max_attempts integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_attempts smallint;
  v_status text;
BEGIN
  IF p_max_attempts < 1 OR p_max_attempts > 10 THEN
    RAISE EXCEPTION 'Invalid attempt threshold';
  END IF;

  UPDATE public.trainee_password_recovery_requests AS r
  SET token_attempts = r.token_attempts + 1,
      status = CASE WHEN r.token_attempts + 1 >= p_max_attempts THEN 'expired' ELSE r.status END,
      token_hash = CASE WHEN r.token_attempts + 1 >= p_max_attempts THEN NULL ELSE r.token_hash END,
      token_expires_at = CASE WHEN r.token_attempts + 1 >= p_max_attempts THEN NULL ELSE r.token_expires_at END,
      updated_at = now()
  WHERE r.id = p_request_id
    AND r.status = 'approved'
    AND r.token_hash IS NOT NULL
    AND r.token_hash IS DISTINCT FROM p_submitted_digest
    AND r.token_expires_at > now()
    AND r.token_attempts < p_max_attempts
  RETURNING r.token_attempts, r.status INTO v_attempts, v_status;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('incremented', false);
  END IF;

  RETURN jsonb_build_object(
    'incremented', true,
    'attempts', v_attempts,
    'expired', v_status = 'expired'
  );
END;
$$;

CREATE OR REPLACE FUNCTION recovery_private.begin_recovery_delivery(
  p_request_id uuid,
  p_delivery_operation_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.trainee_password_recovery_requests
  SET delivery_outcome = 'attempting', delivery_attempted_at = now(), updated_at = now()
  WHERE id = p_request_id AND status = 'approved'
    AND delivery_operation_id = p_delivery_operation_id
    AND delivery_outcome = 'pending';
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION recovery_private.finish_recovery_delivery(
  p_request_id uuid,
  p_delivery_operation_id uuid,
  p_outcome text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('sent','confirmed_failure','unknown') THEN
    RAISE EXCEPTION 'Invalid delivery outcome';
  END IF;

  UPDATE public.trainee_password_recovery_requests
  SET status = CASE WHEN p_outcome = 'confirmed_failure' THEN 'pending' ELSE 'approved' END,
      token_hash = CASE WHEN p_outcome = 'confirmed_failure' THEN NULL ELSE token_hash END,
      token_expires_at = CASE WHEN p_outcome = 'confirmed_failure' THEN NULL ELSE token_expires_at END,
      reviewed_at = CASE WHEN p_outcome = 'confirmed_failure' THEN NULL ELSE reviewed_at END,
      reviewed_by = CASE WHEN p_outcome = 'confirmed_failure' THEN NULL ELSE reviewed_by END,
      token_attempts = CASE WHEN p_outcome = 'confirmed_failure' THEN 0 ELSE token_attempts END,
      delivery_outcome = p_outcome,
      updated_at = now()
  WHERE id = p_request_id AND status = 'approved'
    AND delivery_operation_id = p_delivery_operation_id
    AND delivery_outcome IN ('attempting','unknown');

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION recovery_private.claim_recovery_reset(
  p_request_id uuid,
  p_code_digest text,
  p_operation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_trainee_id uuid;
  v_auth_user_id uuid;
  v_phone text;
  v_trainee_phone text;
  v_approval_status text;
  v_archived_at timestamptz;
BEGIN
  IF p_code_digest IS NULL OR p_code_digest !~ '^[a-f0-9]{64}$'
     OR p_operation_id IS NULL THEN
    RETURN jsonb_build_object('claimed', false);
  END IF;

  SELECT r.trainee_id INTO v_trainee_id
  FROM public.trainee_password_recovery_requests AS r
  WHERE r.id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', false);
  END IF;

  SELECT t.auth_user_id, t.phone_normalized, t.approval_status, t.archived_at
    INTO v_auth_user_id, v_trainee_phone, v_approval_status, v_archived_at
  FROM public.trainees AS t
  WHERE t.id = v_trainee_id
  FOR UPDATE;

  IF NOT FOUND OR v_auth_user_id IS NULL OR v_approval_status <> 'active' OR v_archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('claimed', false);
  END IF;

  UPDATE public.trainee_password_recovery_requests AS r
  SET status = 'processing',
      operation_id = p_operation_id,
      processing_started_at = now(),
      auth_outcome = 'claimed',
      auth_attempted_at = NULL,
      auth_last_error_code = NULL,
      updated_at = now()
  WHERE r.id = p_request_id
    AND r.trainee_id = v_trainee_id
    AND r.phone_normalized = v_trainee_phone
    AND r.status = 'approved'
    AND r.token_hash = p_code_digest
    AND r.token_expires_at > now()
    AND r.token_attempts < 5
    AND r.delivery_outcome = 'sent'
  RETURNING r.phone_normalized INTO v_phone;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', false);
  END IF;

  RETURN jsonb_build_object(
    'claimed', true,
    'operation_id', p_operation_id,
    'auth_user_id', v_auth_user_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION recovery_private.begin_recovery_auth_update(
  p_request_id uuid,
  p_operation_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.trainee_password_recovery_requests
  SET auth_outcome = 'attempting', auth_attempted_at = now(), updated_at = now()
  WHERE id = p_request_id AND status = 'processing'
    AND operation_id = p_operation_id AND auth_outcome = 'claimed';
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION recovery_private.finish_recovery_auth_update(
  p_request_id uuid,
  p_operation_id uuid,
  p_outcome text,
  p_safe_error_code text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('completed','confirmed_no_change','unknown') THEN
    RAISE EXCEPTION 'Invalid Auth outcome';
  END IF;
  IF p_safe_error_code IS NOT NULL AND
     (length(p_safe_error_code) NOT BETWEEN 1 AND 64 OR p_safe_error_code !~ '^[a-z0-9_.-]+$') THEN
    RAISE EXCEPTION 'Unsafe error code';
  END IF;

  UPDATE public.trainee_password_recovery_requests
  SET status = CASE
        WHEN p_outcome = 'completed' THEN 'completed'
        WHEN p_outcome = 'confirmed_no_change' THEN 'approved'
        ELSE 'processing'
      END,
      completed_at = CASE WHEN p_outcome = 'completed' THEN now() ELSE completed_at END,
      token_hash = CASE WHEN p_outcome = 'completed' THEN NULL ELSE token_hash END,
      token_expires_at = CASE WHEN p_outcome = 'completed' THEN NULL ELSE token_expires_at END,
      auth_outcome = p_outcome,
      auth_last_error_code = p_safe_error_code,
      updated_at = now()
  WHERE id = p_request_id AND status = 'processing'
    AND operation_id = p_operation_id
    AND auth_outcome IN ('attempting','unknown');

  RETURN FOUND;
END;
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA recovery_private FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION recovery_private.submit_recovery_request(text) TO service_role;
GRANT EXECUTE ON FUNCTION recovery_private.coach_review_recovery_request(uuid,uuid,text,text,timestamptz,text) TO service_role;
GRANT EXECUTE ON FUNCTION recovery_private.record_recovery_wrong_attempt(uuid,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION recovery_private.begin_recovery_delivery(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION recovery_private.finish_recovery_delivery(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION recovery_private.claim_recovery_reset(uuid,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION recovery_private.begin_recovery_auth_update(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION recovery_private.finish_recovery_auth_update(uuid,uuid,text,text) TO service_role;

COMMIT;
 THEN
    RETURN false;
  END IF;

  SELECT count(*) INTO v_match_count
  FROM public.trainees AS t
  WHERE t.phone_normalized = p_phone_normalized
    AND t.approval_status = 'active'
    AND t.auth_user_id IS NOT NULL
    AND t.archived_at IS NULL;

  -- Ambiguous duplicate phone records must never pick an arbitrary account.
  IF v_match_count <> 1 THEN
    RETURN false;
  END IF;

  SELECT t.id INTO v_trainee_id
  FROM public.trainees AS t
  WHERE t.phone_normalized = p_phone_normalized
    AND t.approval_status = 'active'
    AND t.auth_user_id IS NOT NULL
    AND t.archived_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO public.trainee_password_recovery_requests
    (trainee_id, phone_normalized, status)
  VALUES (v_trainee_id, p_phone_normalized, 'pending')
  ON CONFLICT (trainee_id)
    WHERE status IN ('pending','approved','processing')
  DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted = 1;
END;
$;

CREATE OR REPLACE FUNCTION recovery_private.coach_review_recovery_request(
  p_request_id uuid,
  p_actor_user_id uuid,
  p_decision text,
  p_token_hash text DEFAULT NULL,
  p_token_expires_at timestamptz DEFAULT NULL,
  p_hmac_key_version text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_trainee_id uuid;
  v_status text;
  v_actor_role text;
  v_current_coach uuid;
  v_approval_status text;
  v_archived_at timestamptz;
  v_delivery_operation_id uuid;
BEGIN
  IF p_decision IS NULL OR p_decision NOT IN ('approve','reject') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_decision');
  END IF;

  SELECT pr.role INTO v_actor_role
  FROM public.profiles AS pr
  WHERE pr.id = p_actor_user_id
  FOR SHARE;

  IF v_actor_role IS DISTINCT FROM 'coach' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authorized');
  END IF;

  SELECT r.trainee_id, r.status
    INTO v_trainee_id, v_status
  FROM public.trainee_password_recovery_requests AS r
  WHERE r.id = p_request_id
  FOR UPDATE;

  IF NOT FOUND OR v_status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_available');
  END IF;

  SELECT t.coach_user_id, t.approval_status, t.archived_at
    INTO v_current_coach, v_approval_status, v_archived_at
  FROM public.trainees AS t
  WHERE t.id = v_trainee_id
  FOR UPDATE;

  IF NOT FOUND OR v_current_coach IS DISTINCT FROM p_actor_user_id
     OR v_approval_status <> 'active' OR v_archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authorized');
  END IF;

  IF p_decision = 'reject' THEN
    UPDATE public.trainee_password_recovery_requests
    SET status = 'rejected', reviewed_at = now(), reviewed_by = p_actor_user_id,
        updated_at = now()
    WHERE id = p_request_id AND status = 'pending';
    RETURN jsonb_build_object('ok', true, 'status', 'rejected');
  END IF;

  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$'
     OR p_hmac_key_version IS NULL
     OR p_hmac_key_version !~ '^[A-Za-z0-9_-]{1,32}$'
     OR p_token_expires_at IS NULL
     OR p_token_expires_at <= now()
     OR p_token_expires_at > now() + interval '20 minutes' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_token_material');
  END IF;

  v_delivery_operation_id := gen_random_uuid();
  UPDATE public.trainee_password_recovery_requests
  SET status = 'approved', reviewed_at = now(), reviewed_by = p_actor_user_id,
      token_hash = p_token_hash, token_expires_at = p_token_expires_at,
      token_attempts = 0, hmac_key_version = p_hmac_key_version,
      delivery_operation_id = v_delivery_operation_id,
      delivery_outcome = 'pending', delivery_attempted_at = NULL,
      operation_id = NULL, processing_started_at = NULL,
      auth_outcome = NULL, auth_attempted_at = NULL, auth_last_error_code = NULL,
      updated_at = now()
  WHERE id = p_request_id AND status = 'pending';

  RETURN jsonb_build_object('ok', true, 'status', 'approved', 'delivery_operation_id', v_delivery_operation_id);
END;
$$;

CREATE OR REPLACE FUNCTION recovery_private.record_recovery_wrong_attempt(
  p_request_id uuid,
  p_submitted_digest text,
  p_max_attempts integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_attempts smallint;
  v_status text;
BEGIN
  IF p_max_attempts < 1 OR p_max_attempts > 10 THEN
    RAISE EXCEPTION 'Invalid attempt threshold';
  END IF;

  UPDATE public.trainee_password_recovery_requests AS r
  SET token_attempts = r.token_attempts + 1,
      status = CASE WHEN r.token_attempts + 1 >= p_max_attempts THEN 'expired' ELSE r.status END,
      token_hash = CASE WHEN r.token_attempts + 1 >= p_max_attempts THEN NULL ELSE r.token_hash END,
      token_expires_at = CASE WHEN r.token_attempts + 1 >= p_max_attempts THEN NULL ELSE r.token_expires_at END,
      updated_at = now()
  WHERE r.id = p_request_id
    AND r.status = 'approved'
    AND r.token_hash IS NOT NULL
    AND r.token_hash IS DISTINCT FROM p_submitted_digest
    AND r.token_expires_at > now()
    AND r.token_attempts < p_max_attempts
  RETURNING r.token_attempts, r.status INTO v_attempts, v_status;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('incremented', false);
  END IF;

  RETURN jsonb_build_object(
    'incremented', true,
    'attempts', v_attempts,
    'expired', v_status = 'expired'
  );
END;
$$;

CREATE OR REPLACE FUNCTION recovery_private.begin_recovery_delivery(
  p_request_id uuid,
  p_delivery_operation_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.trainee_password_recovery_requests
  SET delivery_outcome = 'attempting', delivery_attempted_at = now(), updated_at = now()
  WHERE id = p_request_id AND status = 'approved'
    AND delivery_operation_id = p_delivery_operation_id
    AND delivery_outcome = 'pending';
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION recovery_private.finish_recovery_delivery(
  p_request_id uuid,
  p_delivery_operation_id uuid,
  p_outcome text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('sent','confirmed_failure','unknown') THEN
    RAISE EXCEPTION 'Invalid delivery outcome';
  END IF;

  UPDATE public.trainee_password_recovery_requests
  SET status = CASE WHEN p_outcome = 'confirmed_failure' THEN 'pending' ELSE 'approved' END,
      token_hash = CASE WHEN p_outcome = 'confirmed_failure' THEN NULL ELSE token_hash END,
      token_expires_at = CASE WHEN p_outcome = 'confirmed_failure' THEN NULL ELSE token_expires_at END,
      reviewed_at = CASE WHEN p_outcome = 'confirmed_failure' THEN NULL ELSE reviewed_at END,
      reviewed_by = CASE WHEN p_outcome = 'confirmed_failure' THEN NULL ELSE reviewed_by END,
      token_attempts = CASE WHEN p_outcome = 'confirmed_failure' THEN 0 ELSE token_attempts END,
      delivery_outcome = p_outcome,
      updated_at = now()
  WHERE id = p_request_id AND status = 'approved'
    AND delivery_operation_id = p_delivery_operation_id
    AND delivery_outcome IN ('attempting','unknown');

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION recovery_private.claim_recovery_reset(
  p_request_id uuid,
  p_code_digest text,
  p_operation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_trainee_id uuid;
  v_auth_user_id uuid;
  v_phone text;
  v_trainee_phone text;
  v_approval_status text;
  v_archived_at timestamptz;
BEGIN
  IF p_code_digest IS NULL OR p_code_digest !~ '^[a-f0-9]{64}$'
     OR p_operation_id IS NULL THEN
    RETURN jsonb_build_object('claimed', false);
  END IF;

  SELECT r.trainee_id INTO v_trainee_id
  FROM public.trainee_password_recovery_requests AS r
  WHERE r.id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', false);
  END IF;

  SELECT t.auth_user_id, t.phone_normalized, t.approval_status, t.archived_at
    INTO v_auth_user_id, v_trainee_phone, v_approval_status, v_archived_at
  FROM public.trainees AS t
  WHERE t.id = v_trainee_id
  FOR UPDATE;

  IF NOT FOUND OR v_auth_user_id IS NULL OR v_approval_status <> 'active' OR v_archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('claimed', false);
  END IF;

  UPDATE public.trainee_password_recovery_requests AS r
  SET status = 'processing',
      operation_id = p_operation_id,
      processing_started_at = now(),
      auth_outcome = 'claimed',
      auth_attempted_at = NULL,
      auth_last_error_code = NULL,
      updated_at = now()
  WHERE r.id = p_request_id
    AND r.trainee_id = v_trainee_id
    AND r.phone_normalized = v_trainee_phone
    AND r.status = 'approved'
    AND r.token_hash = p_code_digest
    AND r.token_expires_at > now()
    AND r.token_attempts < 5
    AND r.delivery_outcome = 'sent'
  RETURNING r.phone_normalized INTO v_phone;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', false);
  END IF;

  RETURN jsonb_build_object(
    'claimed', true,
    'operation_id', p_operation_id,
    'auth_user_id', v_auth_user_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION recovery_private.begin_recovery_auth_update(
  p_request_id uuid,
  p_operation_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.trainee_password_recovery_requests
  SET auth_outcome = 'attempting', auth_attempted_at = now(), updated_at = now()
  WHERE id = p_request_id AND status = 'processing'
    AND operation_id = p_operation_id AND auth_outcome = 'claimed';
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION recovery_private.finish_recovery_auth_update(
  p_request_id uuid,
  p_operation_id uuid,
  p_outcome text,
  p_safe_error_code text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('completed','confirmed_no_change','unknown') THEN
    RAISE EXCEPTION 'Invalid Auth outcome';
  END IF;
  IF p_safe_error_code IS NOT NULL AND
     (length(p_safe_error_code) NOT BETWEEN 1 AND 64 OR p_safe_error_code !~ '^[a-z0-9_.-]+$') THEN
    RAISE EXCEPTION 'Unsafe error code';
  END IF;

  UPDATE public.trainee_password_recovery_requests
  SET status = CASE
        WHEN p_outcome = 'completed' THEN 'completed'
        WHEN p_outcome = 'confirmed_no_change' THEN 'approved'
        ELSE 'processing'
      END,
      completed_at = CASE WHEN p_outcome = 'completed' THEN now() ELSE completed_at END,
      token_hash = CASE WHEN p_outcome = 'completed' THEN NULL ELSE token_hash END,
      token_expires_at = CASE WHEN p_outcome = 'completed' THEN NULL ELSE token_expires_at END,
      auth_outcome = p_outcome,
      auth_last_error_code = p_safe_error_code,
      updated_at = now()
  WHERE id = p_request_id AND status = 'processing'
    AND operation_id = p_operation_id
    AND auth_outcome IN ('attempting','unknown');

  RETURN FOUND;
END;
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA recovery_private FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION recovery_private.coach_review_recovery_request(uuid,uuid,text,text,timestamptz,text) TO service_role;
GRANT EXECUTE ON FUNCTION recovery_private.record_recovery_wrong_attempt(uuid,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION recovery_private.begin_recovery_delivery(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION recovery_private.finish_recovery_delivery(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION recovery_private.claim_recovery_reset(uuid,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION recovery_private.begin_recovery_auth_update(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION recovery_private.finish_recovery_auth_update(uuid,uuid,text,text) TO service_role;

COMMIT;
