# Onboarding profile — API contract (web)

Step 1 of onboarding. The client must send credentials so the `pp_session`
cookie travels, and it must decide which screen to show **only** from
`GET /onboarding/status`.

## Requests

All requests need `credentials: "include"` (the web app on `:3001` talks to the
API on `:3000`; the session cookie is `httpOnly`, `SameSite=Lax`). Refresh calls
should send the cookie too.

```
fetch(`${SERVER_BASE}/onboarding/status`, {
  method: "GET",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
})
```

### `POST /onboarding/profile`

Save the profile. Cookie required.

**Sends**

```json
{
  "languages": ["english"],
  "skills": ["algebra", "lesson planning"],
  "timezone": "Africa/Lagos"
}
```

- `languages`: at least 1, each one of the currently open languages (at launch
  only `"english"`), no duplicates.
- `skills`: up to 10, each trimmed to 40 characters; duplicates (case-insensitive)
  collapse to one.
- `timezone`: an IANA name such as `"Africa/Lagos"` (not an offset).

**Gets back**

- `200` — `{ "status": "ok", "nextStep": "Start the screening test.", "profile": { ... } }`
- `400` — `{ "status": "invalid", "errors": { "<field>": ["message"] } }`.
  Errors are keyed by field name so each can sit next to its input.
- `401` — no/expired session, or a frozen account.
- `403` — bad `Origin`.
- `409` — `{ "status": "wrong_status", "message": "...", "nextStep": "..." }`.
  The state is wrong (e.g. screening already started); show `nextStep`.
- `415` — body was not JSON.
- `500` — generic failure.

Saving the same profile twice is safe and returns the same result.

### `GET /onboarding/status`

Cookie required. This is the single source of truth for which screen to show.

**Gets back**

```json
{
  "status": "ok",
  "accountStatus": "ACTIVE",
  "onboardingStatus": "PROFILE_COMPLETE",
  "nextStep": "Start the screening test.",
  "profile": {
    "id": "...", "name": "...", "email": "...", "country": "NG",
    "status": "ACTIVE", "onboardingStatus": "PROFILE_COMPLETE",
    "languages": ["english"], "skills": ["algebra"],
    "timezone": "Africa/Lagos", "profileCompletedAt": "2026-10-11T00:00:00.000Z"
  },
  "editableFields": ["languages", "skills", "timezone"]
}
```

- `onboardingStatus` values, in journey order: `CREATED`, `PROFILE_COMPLETE`,
  `SCREENING_IN_PROGRESS`, `SCREENING_PASSED`, `TIER_CHOSEN`, `ACTIVATED`.
- `editableFields` is `[]` once the journey moves past profile setup today. It is
  the list the form may edit; do not hard-code it.
- `401` when there is no session or the account is frozen.

The client never sends `status`, `onboardingStatus`, `tier`, or `role`; the
server ignores them if sent.
