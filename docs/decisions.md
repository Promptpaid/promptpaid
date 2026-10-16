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

## 2026-10-11 — Onboarding profile setup (step 1)

### Two status fields, not one

**Decision:** account standing and journey position are separate. `UserStatus`
is the account switch — `{ ACTIVE, FROZEN }` — and every request that needs an
enabled account checks it. `OnboardingStatus` is the journey —
`{ CREATED, PROFILE_COMPLETE, SCREENING_IN_PROGRESS, SCREENING_PASSED,
TIER_CHOSEN, ACTIVATED }`. The onboarding gate passes only when the account is
`ACTIVE` **and** the journey status is in the action's allowed list.

**Why:** "frozen" is not a step in the journey; it is a switch that overrides
every step. Modelling it as one of the journey states would let a frozen user
sit at a valid-looking step. This also keeps the existing login and middleware
frozen checks (`USER_STATUS.ACTIVE`) unchanged in shape.

**Supersedes** the earlier "`SUSPENDED` vs `FROZEN`" mapping decision: the
value is now literally `FROZEN`; `SUSPENDED` no longer exists.

### Status wording lives in `@promptpaid/shared`

`ONBOARDING_STATUS`, the next-step map, and the action table
(`ACTION_ALLOWED_STATUSES`) live in `packages/shared`. `NEXT_STEP` wording is
shared so the web app and the server cannot drift.

### `POST /onboarding/profile`, not `PUT`

**Decision:** use `POST`, matching every other write endpoint. Saving the same
profile twice is safe and produces the same state (the endpoint is idempotent),
so `PUT`'s one guarantee is preserved without a new CORS method.

### Conditional update for the gate

**Decision:** the profile save is a single `updateMany` that only touches a row
whose `onboardingStatus` is still allowed, and the caller branches on the
affected count. If the count is 0 the user moved first (e.g. screening started
in another tab) and the request returns `409`.

**Why:** checking status in one query and updating in another lets two requests
both pass the check. The conditional update makes check-and-write one atomic
action.

### Signup now starts a session

**Decision:** `POST /auth/signup` issues a session cookie (same helper as
login), so a freshly created account enters onboarding authenticated instead of
having to log in again.

### Languages and timezone

**Decision:** all nine languages are listed in `@promptpaid/shared` with an
`open` flag; only English is open at launch. The user's timezone is stored as an
IANA name (e.g. `Africa/Lagos`), never an offset, and validated with
`Intl.DateTimeFormat` on the server. Default timezone is suggested from country
(NG/ZA/GH/KE) but editable.

## 2026-10-11 — D-015: migrations are the source of truth

**Decision:** the schema is managed by committed Prisma migrations. `db push` is
allowed only on a throwaway local database. The database had drifted (login and
profile columns were pushed without a migration), so the migration history was
reset to a single squashed `baseline` migration that matches `schema.prisma`
exactly.

**Why:** the dev database was wiped anyway (test accounts only), and any shared
database from this point on must be reproducible from the migrations folder. A
dev-only seed script (`pnpm -F server dev:set-status`) replaces the old habit of
hand-editing statuses, and refuses to run outside development.

