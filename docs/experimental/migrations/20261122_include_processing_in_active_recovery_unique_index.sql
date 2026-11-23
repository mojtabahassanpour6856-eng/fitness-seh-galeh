-- EXPERIMENTAL DRAFT ONLY.
-- Not applied to Supabase Test or Production.
-- Run only after reviewing duplicate active rows and deployment/locking impact.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.trainee_password_recovery_requests
    WHERE status IN ('pending', 'approved', 'processing')
    GROUP BY trainee_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot create active recovery uniqueness index: duplicate active rows exist per trainee';
  END IF;
END
$$;

DROP INDEX IF EXISTS public.trainee_password_recovery_one_open_request_per_trainee;

CREATE UNIQUE INDEX trainee_password_recovery_one_open_request_per_trainee
ON public.trainee_password_recovery_requests (trainee_id)
WHERE status IN ('pending', 'approved', 'processing');

COMMIT;
