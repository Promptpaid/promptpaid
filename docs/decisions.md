# Decisions

Short, dated notes on security/behaviour choices that are easy to second-guess
later. Add a new entry rather than rewriting an old one.

## 2026-10-11 — Login timing and account status

### Login response timing (email enumeration)

**Decision:** equalise the unknown-email and wrong-password paths by doing the
same work in both. `login()` runs an Argon2 verify against `DUMMY_HASH` and then
performs a matching no-op database write (`recordFailedLoginForUnknownUser`,
an `UPDATE ... WHERE id = '__unknown_email__'` that matches no row). The
wrong-password path already does one write (`recordFailedLogin`), so both paths
now cost one lookup + one round trip.

**Why not "respond first, record after":** deferring the failed-attempt write
would hide the latency, but on serverless (Vercel) a function can be frozen once
the response is sent, and a dropped write means a weaker account lockout. The
lockout is the protection that matters, so we keep it awaited.

**Measured:** before the change the unknown-email path answered in ~0.28s
against ~0.55s for a wrong password (~2x). After, with the loop order controlled
(the first request of each pair is consistently slower from connection warm-up),
unknown ≈0.75s vs wrong-password ≈0.72s — the gap is gone.

**Residual risk:** signup already returns `409` for existing email/phone, so
enumeration is possible there regardless. This change is hygiene, not a fix for
the primary leak. The two paths can still differ under network jitter; the
distributions overlap and neither is reliably faster, so that is accepted.

### `SUSPENDED` vs `FROZEN`

**Decision:** use the Prisma `UserStatus` enum values, so the canonical list is
`{ ACTIVE, SUSPENDED }`, centralised as `USER_STATUS` in `@promptpaid/shared`.
The product plan's "frozen" account maps to `SUSPENDED`. Middleware and the
login service both compare against `USER_STATUS.ACTIVE` rather than typed-in
strings. Renaming the enum to `FROZEN` would need a migration and was not worth
the churn; document the mapping instead.

### Missing `Origin` header

**Decision:** requests without an `Origin` header are **allowed** through
`requireSameOrigin`. Browsers always send `Origin` on cross-site and
state-changing requests, so a missing header means a non-browser client (curl,
server-to-server). This is intentional: rejecting header-less requests would
break legitimate API clients while adding no browser CSRF protection.

Confirmed by test: `POST /auth/login` and `POST /auth/logout` with no `Origin`
header behave exactly like same-origin requests (login `200` + cookie, logout
`200`). The CSRF protection is the `Origin` mismatch check and the `SameSite=Lax`
cookie, not the absence of the header.

## 2026-10-11 — Login IP rate limit

**Decision:** raise the per-IP login limit from 10 to 100 per 15 minutes.

Nigerian mobile carriers put many subscribers behind one public IP, so a tight
per-IP cap locks out ordinary users who share a NAT. The primary protection is
the per-account lockout (5 failures, stored in Postgres), which works across
instances. The `express-rate-limit` store is in-memory: on Vercel it resets on
cold starts and is not shared across instances, so treat it as best-effort
only.
