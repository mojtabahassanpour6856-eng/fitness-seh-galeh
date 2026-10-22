# Supabase staging availability check

Date: 2026-10-22
Scope: read-only project inventory; no database writes, migrations, or project creation.

## Result

The connected Supabase account currently lists exactly one project:

- `fitness seghale` — ref `qfakyudgidsumeuoqoot`, region `eu-west-1`, status `ACTIVE_HEALTHY`.

That is the live production project. No separate staging project is currently available in the connected account.

## Safety decision

- Do not run the draft RPC migration or any destructive/integration test against the production project.
- Do not create a Supabase project or database branch automatically; a new project/branch may incur charges and requires a separate cost review/approval.
- Continue free validation using the disposable PostgreSQL CI fixture, while clearly treating it as a model of the live security configuration—not a real authenticated Supabase integration.
- Before production transfer, either provide an existing isolated Supabase staging project or explicitly approve a quoted-cost option. If neither is available, the authenticated Supabase/RLS/trigger gate remains unresolved and production transfer stays blocked.

## What this check does not change

Production GitHub Pages, the `main` branch, Supabase schema/data, trainee records, and the production workout-save path remain untouched.
