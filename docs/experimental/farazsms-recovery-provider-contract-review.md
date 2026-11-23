# FarazSMS recovery provider contract review

Review date: 2026-11-23
Branch: experiment/trainee-password-recovery-mock-20261122
Status: selected provider candidate; integration BLOCKED pending current official API evidence and network/IP approval.

## Decision history
- On 2026-11-18, the coach accepted four-digit SMS login/password-recovery codes through FarazSMS.
- This is the clearest explicit provider choice for the recovery flow.
- Mediana was later explicitly excluded because of IP restrictions; do not re-enable it or send real messages.
- A later safety decision paused live SMS/provider activation pending confirmation of access, IP allowlisting, and stability. That pause remains binding.
- SMS.ir appears in an older active function, but it is not the selected provider for this recovery candidate.
- No provider credentials, sender number, pattern identifier, or live connectivity test are available in this review.

## Evidence reviewed
1. FarazSMS public announcement says legacy web services were scheduled to be disabled from 7 Aban and directs integrators to new web-service documentation on the official FarazSMS site. Do not use old send_url.php examples or legacy endpoints for a new adapter.
2. FarazSMS public channel material mentions API-key based web-service access, but the reviewed material does not provide a complete current request/response contract.
3. An unofficial community SDK describes pattern sending, message lookup, and recipient status methods. This is discovery evidence only, not authoritative implementation documentation.
4. The official API documentation host referenced by the community SDK (docs.ippanel.com) could not be retrieved during this review. No endpoint paths, request fields, success codes, or error semantics are asserted here.

## Contract facts requiring official confirmation
| Topic | Current status | Required evidence |
|---|---|---|
| Current base URL and API version | Unknown | Current official FarazSMS/IPPANEL developer docs |
| Authentication | API-key mentioned publicly; exact header/scheme unknown | Official auth section and token scope |
| Pattern send endpoint | Unknown | Official endpoint, method, JSON schema |
| Pattern code and variable mapping | Unknown | Approved template and exact variable contract |
| Sender/originator requirements | Unknown | Account-specific sender eligibility |
| Accepted/success response | Unknown | Exact status and response schema |
| Provider message ID | Unknown | Field name, uniqueness and retention |
| Definite non-acceptance errors | Unknown | Documented error codes and semantics |
| Timeout / connection reset semantics | Unknown | Written provider guidance or sandbox observation |
| Idempotency support | Unknown | Documented key, scope, retention and duplicate behavior |
| Status lookup | Public SDK suggests capability, but unverified | Official endpoint and lookup-by-message-ID semantics |
| IP allowlisting | Not confirmed for current environment | Written confirmation of required source IPs and allowlist procedure |
| Rate limits / retry policy | Unknown | Official limits and Retry-After semantics |
| Sandbox / non-delivery mode | Unknown | Provider-supported safe test mechanism |

## Required adapter contract (provider-neutral)
The production adapter, if later approved, must implement one operation:

    sendRecoveryCode({ recipient, approvedPatternId, variables, idempotencyKey })

It must return exactly one normalized result:
- accepted: documented provider acceptance is confirmed; include a validated bounded provider message ID if available.
- definite_rejection: official contract proves the provider did not accept the message; include only an allowlisted safe error code.
- unknown: timeout, disconnect, malformed/contradictory response, undocumented status, or any condition where acceptance cannot be ruled out.

A timeout or malformed response must never be converted into definite rejection. A provider message ID is not proof of handset delivery unless official semantics say so.

## Idempotency and retry rules
- Do not claim exactly-once delivery.
- Keep one stable idempotency key per immutable Outbox item, never per retry or lease generation.
- If FarazSMS documents idempotency, validate its scope and retention before relying on it.
- If it does not support idempotency, an ambiguous result remains unknown; do not automatically resend.
- A status query may resolve an unknown result only if the official API supports authoritative lookup with documented consistency.
- Retry only a documented definite non-acceptance, under bounded backoff and attempt limits.

## Security and operational gates
1. Obtain current official developer docs from the FarazSMS account or support team; archive version/date in this review.
2. Confirm production egress IP requirements and allowlisting in writing. Do not work around IP restrictions.
3. Confirm approved recovery pattern, sender, and variable names.
4. Confirm safe sandbox/test mode and use synthetic recipient data only.
5. Store API credentials only in the approved secret manager; never commit or request them in chat.
6. Add contract fixtures for accepted, definite rejection, timeout-after-possible-acceptance, malformed response, rate limit, and status lookup.
7. Keep the real adapter uninstantiated by the Edge Function until separate release approval.

## Current implementation boundary
- Candidate Edge Function intentionally has no deliveryAdapter.
- Worker accepts only FakeRecoverySmsProvider.
- No real SMS, provider credential, provider API request, or deployment is authorized by this review.
- Keep PR #260 Draft and unmerged.
- Do not run migrations against mirror or production.
- Do not alter existing live SMS configuration, Auth, trainee data, or passwords.

## Decision
FarazSMS is the historically accepted provider candidate for four-digit recovery codes, but its current API contract and IP/network compatibility are not yet verified. The correct next action is to obtain authoritative documentation and account-specific network confirmation—not to code against legacy examples or enable a real adapter.