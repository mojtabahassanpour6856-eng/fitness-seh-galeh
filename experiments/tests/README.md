# Disposable PostgreSQL test harness

This directory is only for local/CI integration tests of the experimental workout-save SQL. The workflow uses a fresh PostgreSQL service container and never connects to Supabase or production data.

Tests must confirm create/update, stale fingerprint rejection, authorization rejection, and transactional rollback after a forced child-row insert failure. A green CI run validates the mock harness only; it does not prove compatibility with the live Supabase schema or policies.
