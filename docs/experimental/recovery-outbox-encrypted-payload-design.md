# Recovery Outbox encrypted delivery payload — implementation status and release gate

Last reviewed: 2026-11-23

Status: the encrypted-payload and fake-only Worker candidates now exist and are covered by isolated CI. This document supersedes the earlier design-only status below. It does NOT approve deployment, real SMS, or migration execution.

## Implemented in the experimental branch

- Coach review candidate accepts a caller-generated delivery operation UUID and AES-256-GCM envelope.
- The envelope is bound to recovery request ID and delivery operation ID as authenticated additional data.
- The encrypted envelope is copied to the Outbox in the approval transaction; plaintext code is not stored.
- A service-role-only RPC fetches the payload for the current fenced lease.
- The experimental Worker rechecks request/trainee status, phone equality, archive status, and coach assignment before provider invocation.
- The Worker only accepts FakeRecoverySmsProvider. Any other provider is rejected with REAL_PROVIDER_DISABLED_IN_EXPERIMENT.
- Timeout, malformed provider result, decryption failure after durable send-start, and unconfirmed completion are treated as ambiguous; the Worker does not blindly resend.
- The isolated CI workflow runs the fake-only Worker tests and disposable PostgreSQL/PostgREST Outbox contract tests.

## Remaining provider integration gate

No real provider adapter is implemented or enabled in this branch. The deploy-shaped Edge Function deliberately has no deliveryAdapter. Do not add provider credentials or enable a provider as part of this experiment.

Before a real adapter can be proposed, obtain and review the current official provider API contract and verify all of the following with documented evidence:

1. Authentication method and secret handling.
2. Exact request schema, recipient normalization, template/pattern identifier, and variable mapping.
3. Exact success and rejection response schemas, including whether a provider message ID is returned.
4. Whether the provider supports an idempotency key, and its scope and retention period.
5. Whether provider status can be queried after a timeout or connection loss.
6. Which errors prove non-acceptance versus leave acceptance ambiguous.
7. Rate limits, retry-after behavior, delivery restrictions, and operational monitoring.
8. A sandbox/test credential or provider-supported non-delivery mode. Never use a real trainee phone for contract testing.

If the provider has no idempotency or status lookup, the system must retain fail-closed handling for ambiguous outcomes and must not claim exactly-once delivery.

## Release blockers unrelated to provider adapter

- Historical mirror recovery row still needs an audited disposition/request-time coach mapping. Do not infer the historical coach from the current trainee assignment.
- A verified full backup and restore rehearsal are still outstanding.
- The candidate migration sequence and currently deployed Edge Function have not been applied or replaced on the mirror.
- Live mirror compatibility, provider behavior, and real Auth password mutation have not been validated end-to-end.

## Safety boundary

- Keep PR #260 Draft and unmerged.
- Do not run any candidate migration against mirror or production.
- Do not deploy the candidate Edge Function.
- Do not configure real SMS credentials or send real SMS.
- Do not modify trainee records, passwords, or existing Auth settings.
- Continue only with isolated branch code, synthetic fixtures, and disposable CI infrastructure.

## Earlier design rationale

The original design-only note correctly identified that an HMAC digest cannot reconstruct the one-time code and that a Worker must never invent a replacement code or store plaintext. The encrypted envelope + Outbox + fake-only Worker implementation now addresses that design gap in the isolated candidate. The real-provider integration and release gates above remain open.
