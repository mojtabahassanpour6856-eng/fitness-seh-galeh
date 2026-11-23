-- EXPERIMENTAL ONLY. REVIEWED TEST-DATABASE CLEANUP CANDIDATE.
-- DO NOT RUN without explicit approval. Never run on Production.
-- Purpose: the read-only Test inspection on 2026-11-22 found exactly one
-- legacy approved request whose token_expires_at is already in the past.
-- This script changes ONLY that expired recovery-request row:
--   approved -> expired; clear token_hash and token_expires_at.
-- It does NOT modify trainees, Auth users/passwords, phone numbers, or sessions.
-- It aborts unless the database still has exactly one expired approved row,
-- zero unexpired approved rows, and zero processing rows.

BEGIN;
LOCK TABLE public.trainee_password_recovery_requests IN SHARE ROW EXCLUSIVE MODE;

DO $guard$
DECLARE
  v_expired_approved integer;
  v_live_approved integer;
  v_processing integer;
BEGIN
  SELECT count(*) INTO v_expired_approved
  FROM public.trainee_password_recovery_requests
  WHERE status = 'approved' AND token_expires_at <= now();

  SELECT count(*) INTO v_live_approved
  FROM public.trainee_password_recovery_requests
  WHERE status = 'approved' AND token_expires_at > now();

  SELECT count(*) INTO v_processing
  FROM public.trainee_password_recovery_requests
  WHERE status = 'processing';

  IF v_expired_approved <> 1 OR v_live_approved <> 0 OR v_processing <> 0 THEN
    RAISE EXCEPTION
      'Safety guard: expected exactly one expired approved row, zero live approved rows, and zero processing rows; found expired=%, live=%, processing=%',
      v_expired_approved, v_live_approved, v_processing;
  END IF;
END
$guard$;

UPDATE public.trainee_password_recovery_requests
SET status = 'expired',
    token_hash = NULL,
    token_expires_at = NULL,
    updated_at = now()
WHERE status = 'approved'
  AND token_expires_at <= now();

DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.trainee_password_recovery_requests
    WHERE status IN ('approved','processing')
  ) THEN
    RAISE EXCEPTION 'Safety verification failed: approved/processing recovery rows remain';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.trainee_password_recovery_requests
    WHERE status = 'expired' AND token_hash IS NULL AND token_expires_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Safety verification failed: expired legacy request was not finalized';
  END IF;
END
$verify$;

COMMIT;
