# Recovery Outbox encrypted delivery payload — required design gate

Status: design required; no Worker sender may be implemented or deployed until this gate is closed.

## Why the current Outbox is not yet sendable

The coach-review HTTP handler generates a four-digit code in memory and passes only its HMAC digest to `recovery_coach_review`. The atomic approval trigger creates an Outbox row containing request/operation identifiers and a provider idempotency key, but it does not contain the plaintext code or a recoverable encrypted payload. The HMAC digest is intentionally one-way and cannot be used to reconstruct the code.

Therefore, a Worker that reads the current Outbox cannot send the approved code. Do not add a Worker that invents a new code, sends a different code, or stores plaintext in the database.

## Required design

1. Generate the code once in the coach-review handler.
2. Encrypt the code before the approval RPC using authenticated encryption (AES-256-GCM) with a dedicated 256-bit delivery-payload key. The encryption key must be distinct from all recovery HMAC keys and Supabase service-role credentials.
3. Use a fresh cryptographically random 96-bit nonce for every encryption. Persist a versioned envelope containing algorithm, key version, nonce, and ciphertext+tag. Bind the request ID and delivery operation ID as authenticated additional data (AAD) so ciphertext cannot be transplanted between requests or operations.
4. Extend the coach-review RPC with a caller-generated operation UUID and the encrypted envelope. In one transaction, validate the actor/trainee assignment, store only the HMAC digest plus encrypted envelope and key version, mark the request approved, and create the Outbox row by trigger.
5. The Outbox row must copy the encrypted envelope and key version in the same transaction. It must never store plaintext code.
6. Worker retrieves the encrypted envelope through a service-role-only RPC, validates operation/request binding, decrypts with the dedicated key, rechecks recipient phone equality and active/non-archived trainee status, then invokes the provider with the stable Outbox idempotency key.
7. On terminal `sent`, `failed`, or `unknown`, clear encrypted payload material atomically with request/outbox finalization. Preserve the HMAC digest only while it is needed for code redemption. On expired/unknown states, never auto-resend.
8. Never log phone, code, ciphertext, encryption key, service-role key, or provider credentials. Provider responses are reduced to a bounded message ID and allowlisted safe error code.

## Required tests before Worker implementation

- AES-GCM round trip and tamper detection.
- Wrong request ID / operation ID AAD rejection.
- Nonce uniqueness and strict envelope parser limits.
- Missing/retired key version fails closed without calling provider.
- Ciphertext copied to another request or operation fails authentication.
- Transaction rollback leaves neither approved request nor Outbox payload.
- Duplicate coach approval cannot create another payload or Outbox operation.
- Outbox claim never exposes payload to anon/authenticated.
- Provider acceptance followed by Worker crash becomes unknown and is not resent.
- All terminal outcomes clear encrypted payload from both request and Outbox.

## Release gate

This file is a blocker, not a production implementation. Keep the Edge adapter under `docs/experimental`, keep provider delivery disabled, and do not run migrations against the live Supabase project until the encrypted-payload protocol and its disposable-PostgreSQL tests pass.
