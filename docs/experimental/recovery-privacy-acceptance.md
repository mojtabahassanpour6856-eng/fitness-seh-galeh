# Password recovery privacy and account-enumeration acceptance criteria

Status: design/acceptance criteria only. This file does not implement an HTTP endpoint or connect to real accounts.

## Public response contract
- A public recovery-request endpoint must return the same status code, response shape, and generic message whether the submitted phone belongs to an account, no account, a disabled account, or an account that is not eligible for recovery.
- Example generic response: "If the information matches an eligible account, instructions will be sent after the required review."
- Never return trainee ID, coach ID/name, account state, whether a phone is registered, whether a trainee is active, or whether a coach relationship exists.
- Do not return a request identifier that can be used to enumerate or inspect another person's request. If a tracking token is needed, it must be high-entropy, unguessable, scoped, and disclosed only to the authenticated owner.
- Do not expose internal errors, provider responses, delivery retry counts, or whether the coach approved/rejected.

## Identity and authorization
- Resolve the trainee exclusively from a verified phone-to-account mapping on the server. Never accept traineeId or coachId as authority from request JSON.
- Resolve the coach relationship from trusted server-side records. A coach can review only requests for trainees currently assigned to that coach, subject to an auditable authorization check.
- The code may be delivered only to the phone already verified and stored on the account; never to a phone supplied in the recovery request.
- Coach approval is mandatory before code issuance, but approval/rejection status is private to the authenticated trainee and assigned coach.
- Public request submission must not disclose whether a request is pending, rejected, expired, or completed.

## Abuse controls
- Apply rate limits before account lookup where possible, using normalized input, IP/network and privacy-preserving account-level keys. Do not rely on IP alone.
- Keep per-account limits even when the public response is generic. Avoid lockout behavior that lets attackers deny service to a victim.
- Use generic, bounded responses and avoid distinguishable timing paths; do not claim perfect timing equality, but test for large differences.
- Log security events without plaintext codes, full phone numbers, passwords, or unnecessary personal data. Restrict and audit access to logs.
- Do not reveal the coach's identity or contact details to an unauthenticated requester.

## Required tests before production
1. Registered, unregistered, disabled, and ineligible phone inputs produce identical public status and response schema.
2. Responses do not contain trainee/coach identifiers or account-state details.
3. Wrong coach cannot list, inspect, approve, reject, or cancel another coach's recovery request.
4. Changing client-supplied traineeId/coachId cannot change the server-resolved identity.
5. SMS destination always equals the verified phone stored for the resolved account.
6. Rate limiting does not reveal account existence through different public errors.
7. Timing distributions are reviewed for material enumeration signals.
8. Logs and telemetry contain no plaintext recovery code or full phone number.
9. All tests run against the real server endpoint and real authorization middleware in an isolated test environment before release.

## Explicit non-goals of this mock
The current in-memory fixture has no phone lookup, account directory, HTTP response layer, authentication middleware, coach directory, SMS provider, database, or production logs. Therefore it cannot prove account-enumeration resistance, identity authenticity, or privacy of a live system.

## Owner-scoped request reads
- Coach-facing reads must query only requests assigned to the authenticated coach; trainee-facing reads must query only requests owned by the authenticated trainee.
- A missing request and a request owned by another actor must produce the same generic denial at the public boundary.
- Never return internal code digests, delivery callback details, full phone numbers, or another user's identity in a request snapshot.
- Authorization must be enforced in the server/database query boundary and rechecked for every operation. A helper in this in-memory fixture is not production authorization.
