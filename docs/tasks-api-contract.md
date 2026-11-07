# Task System (M5) - API Contract for Web Developer

This document describes the complete API contract for the Task System (M5) endpoints. All endpoints require authentication (`Authorization: Bearer <token>`) and same-origin requests.

## Base URL
```
/tasks
```

## Authentication
All endpoints require:
- `Authorization: Bearer <access_token>`
- `Origin` header matching configured CORS origin
- User must be `ACTIVATED` with `ACTIVE` account status

## Onboarding Status Gates
| Action | Required Status |
|--------|----------------|
| View tasks summary | ACTIVATED |
| Start conversation | ACTIVATED + Tutorial completed |
| Send message | ACTIVATED |
| Submit conversation | ACTIVATED |
| Complete tutorial | ACTIVATED |

## Endpoints

---

### POST /tasks/tutorial/complete
**Idempotent** - Sets `tutorialCompletedAt` once; repeating returns existing timestamp.

**Request:** `{}`

**Response (200):**
```json
{
  "status": "ok",
  "alreadyCompleted": false,
  "completedAt": "2026-01-15T10:30:00.000Z"
}
```

**Errors:**
- `409 wrong_status` - User not ACTIVATED

---

### GET /tasks/summary
Returns tutorial state, active conversation, remaining daily allowance, next step.

**Response (200):**
```json
{
  "status": "ok",
  "tutorialCompleted": true,
  "tutorialCompletedAt": "2026-01-15T10:30:00.000Z",
  "activeConversation": { "id": "conversation_id", "scenarioTitle": "Scenario Title" } | null,
  "remainingToday": 3,
  "dailyLimit": 5,
  "startCapPerDay": 20,
  "nextStep": "Start a conversation."
}
```

---

### POST /tasks/start
Starts a new conversation or returns existing active one.

**Request:** `{}`

**Response (201 - new, 200 - resumed):**
```json
{
  "status": "ok",
  "resumed": false,
  "conversation": {
    "id": "conversation_id",
    "title": "Scenario Title",
    "userRole": "User role description",
    "aiRole": "AI role description",
    "objective": "Conversation objective",
    "minimumExchanges": 5,
    "startedAt": "2026-01-15T10:30:00.000Z"
  }
}
```

**Errors:**
- `403 tutorial_required` - Tutorial not completed
- `403 daily_limit` - Daily conversation limit reached
- `503 no_scenarios` - No scenarios available for user's language/tier

---

### GET /tasks/current?conversationId=<id>
Returns snapshot-safe conversation, all messages, and exchanges completed.

**Query Params:**
- `conversationId` (required)

**Response (200):**
```json
{
  "status": "ok",
  "conversation": {
    "id": "conversation_id",
    "title": "Scenario Title",
    "userRole": "User role",
    "aiRole": "AI role",
    "objective": "Objective",
    "minimumExchanges": 5,
    "startedAt": "2026-01-15T10:30:00.000Z",
    "turnCount": 10,
    "status": "IN_PROGRESS"
  },
  "messages": [
    {
      "id": "msg_id",
      "sender": "USER" | "AI",
      "content": "Message content",
      "wordCount": 5,
      "serverCreatedAt": "2026-01-15T10:30:00.000Z",
      "msSincePrevious": 5000,
      "flagged": false,
      "missingReply": false
    }
  ],
  "exchangesCompleted": 5
}
```

**Errors:**
- `404 not_found` - Conversation not found or not owned by user

---

### GET /tasks/history?limit=20&cursor=<iso_date>
Returns paginated list of user's conversations with statuses.

**Query Params:**
- `limit` (optional, 1-50, default 20)
- `cursor` (optional, ISO date string for pagination)

**Response (200):**
```json
{
  "status": "ok",
  "conversations": [
    {
      "id": "conversation_id",
      "title": "Scenario Title",
      "difficulty": "EASY",
      "category": "TEXT_CONVERSATION",
      "status": "IN_PROGRESS" | "SUBMITTED" | "AUTO_REJECTED" | "PENDING_REVIEW" | "EXPIRED" | "APPROVED" | "REJECTED",
      "turnCount": 10,
      "startedAt": "2026-01-15T10:30:00.000Z",
      "submittedAt": "2026-01-15T11:00:00.000Z" | null,
      "dayKey": "2026-01-15"
    }
  ],
  "nextCursor": "2026-01-14T10:30:00.000Z" | null
}
```

---

### POST /tasks/message
Sends a user message in an active conversation.

**Request:**
```json
{
  "conversationId": "conversation_id",
  "clientMessageId": "unique_client_idempotency_key",
  "content": "User message content (3-2000 chars)",
  "typingDurationMs": 5000,
  "pasted": false
}
```

**Validation Rules:**
- Min 3 words per message
- Max 2000 characters
- Rate limit: 10 messages/minute
- Duplicate detection: similarity ≥ 0.85 with any previous user message
- Idempotency via `clientMessageId` (max 64 chars)

**Response (200):**
```json
{
  "status": "ok",
  "message": {
    "id": "user_msg_id",
    "sender": "USER",
    "content": "User message",
    "wordCount": 5,
    "serverCreatedAt": "2026-01-15T10:30:00.000Z",
    "msSincePrevious": 5000,
    "flagged": false,
    "missingReply": false
  },
  "aiReply": {
    "id": "ai_msg_id",
    "sender": "AI",
    "content": "AI reply content",
    "wordCount": 10,
    "serverCreatedAt": "2026-01-15T10:30:05.000Z",
    "msSincePrevious": 5000,
    "flagged": false,
    "missingReply": false
  } | null,
  "exchangesCompleted": 3,
  "conversationStatus": "IN_PROGRESS"
}
```

**Errors:**
- `400 below_min_words` - Message has fewer than 3 words
- `400 exceeds_max_length` - Message exceeds 2000 characters
- `409 duplicate_message` - Too similar to previous message
- `429 rate_limited` - Exceeded 10 messages/minute
- `409 conversation_ended` - Conversation not IN_PROGRESS
- `404 not_found` - Conversation not found
- `200 idempotent_replay` - Message already processed (returns original)

---

### POST /tasks/retry-reply
Retries a failed AI reply (message with `missingReply=true`).

**Request:**
```json
{
  "conversationId": "conversation_id"
}
```

**Response (200):**
```json
{
  "status": "ok",
  "aiReply": {
    "id": "new_ai_msg_id",
    "sender": "AI",
    "content": "New AI reply content",
    "wordCount": 10,
    "serverCreatedAt": "2026-01-15T10:35:00.000Z",
    "msSincePrevious": 300000,
    "flagged": false,
    "missingReply": false
  },
  "exchangesCompleted": 5,
  "conversationStatus": "IN_PROGRESS"
}
```

**Errors:**
- `400 no_missing_reply` - No failed AI reply to retry
- `409 conversation_ended` - Conversation not IN_PROGRESS
- `404 not_found` - Conversation not found

---

### POST /tasks/submit
Submits conversation for review with automatic checks.

**Request:**
```json
{
  "conversationId": "conversation_id"
}
```

**Automatic Checks (run in order):**
1. **Minimum Exchanges** - Must have ≥ 5 user+AI exchange pairs
2. **Conversation-wide Uniqueness** - Min similarity between any two user messages < 0.85
3. **Flagged Ratio** - Flagged messages ≤ 30% of total messages
4. **Fake Judge Evaluation** - Heuristic checks:
   - Too many missing AI replies (>30% of exchanges)
   - Low user effort (avg < 5 words/message)
   - AI failure (avg < 3 words/AI message)

**Response (200):**
```json
{
  "status": "ok",
  "conversation": {
    "id": "conversation_id",
    "status": "AUTO_REJECTED" | "PENDING_REVIEW",
    "submittedAt": "2026-01-15T11:00:00.000Z",
    "rejectionReasonCodes": [
      "BELOW_MIN_EXCHANGES",
      "UNIQUENESS_BELOW_THRESHOLD",
      "FLAGGED_RATIO_EXCEEDED",
      "JUDGE_MISSING_REPLIES",
      "JUDGE_LOW_EFFORT",
      "JUDGE_AI_FAILURE"
    ],
    "rulesResult": {
      "exchangesCompleted": 5,
      "minimumExchanges": 5,
      "uniquenessScore": 0.72,
      "uniquenessThreshold": 0.85,
      "flaggedRatio": 0.15,
      "flaggedRatioThreshold": 0.3,
      "rejectionReasons": ["UNIQUENESS_BELOW_THRESHOLD"]
    },
    "judgeResult": {
      "avgUserWords": 4.2,
      "avgAiWords": 2.1,
      "missingReplies": 2,
      "exchangesCompleted": 5,
      "evaluatedAt": "2026-01-15T11:00:00.000Z"
    }
  }
}
```

**Errors:**
- `400 below_min_exchanges` - Fewer than 5 exchanges completed
- `409 conversation_ended` - Conversation already submitted/ended
- `404 not_found` - Conversation not found

**Status Values:**
- `AUTO_REJECTED` - Failed automatic checks, no human review
- `PENDING_REVIEW` - Passed all automatic checks, awaiting human review
- `EXPIRED` - Auto-expired after 30 minutes of inactivity

---

## Shared Constants (from @promptpaid/shared)

```typescript
// Conversation limits
TASK_MIN_EXCHANGES = 5
TASK_MIN_WORDS_PER_MESSAGE = 3
TASK_MAX_MESSAGE_LENGTH = 2000
TASK_UNIQUENESS_THRESHOLD = 0.85
TASK_RATE_LIMIT_MPM = 10
TASK_INACTIVITY_TIMEOUT_MINUTES = 30
TASK_START_CAP_PER_DAY = 20
TASK_FLAGGED_RATIO_THRESHOLD = 0.3

// AI Adapter
TASK_AI_REPLY_TIMEOUT_MS = 30000
TASK_AI_TOKEN_CAP_PER_REPLY = 500
TASK_AI_TOKEN_CAP_TOTAL = 8000

// Difficulty access per tier
TIER_DIFFICULTY_ACCESS = {
  ROOKIE: ["EASY", "MEDIUM"],
  ELITE: ["EASY", "MEDIUM", "HARD"],
  LEGENDARY: ["EASY", "MEDIUM", "HARD", "EXPERT"]
}
```

---

## Rejection Reason Codes & User Messages

| Code | User Message |
|------|--------------|
| `BELOW_MIN_EXCHANGES` | "The conversation needs more exchanges before it can be submitted." |
| `BELOW_MIN_WORDS` | "Your message is too short. Please write at least 3 words." |
| `EXCEEDS_MAX_LENGTH` | "Your message is too long. Please keep it under 2000 characters." |
| `DUPLICATE_MESSAGE` | "This message is too similar to one you already sent." |
| `FLAGGED_RATIO_EXCEEDED` | "Too many messages were flagged for review." |
| `UNIQUENESS_BELOW_THRESHOLD` | "The conversation doesn't have enough unique messages." |
| `JUDGE_MISSING_REPLIES` | (from judge) |
| `JUDGE_LOW_EFFORT` | (from judge) |
| `JUDGE_AI_FAILURE` | (from judge) |

---

## Error Response Format
All errors follow this format:
```json
{
  "status": "error_code",
  "message": "Human-readable message"
}
```

For validation errors:
```json
{
  "status": "invalid",
  "errors": { "fieldName": ["error message"] }
}
```

---

## Web Implementation Notes

1. **Idempotency**: Generate a unique `clientMessageId` (UUID) for each user message. Reuse the same ID on retry.

2. **Message Flow**:
   - User types message → POST /message → Receive user message + AI reply
   - If AI fails → AI message has `missingReply: true` → Show "Retry" button → POST /retry-reply

3. **Submission**: User clicks "Submit" when `exchangesCompleted >= 5` → POST /submit → Check `status` in response:
   - `AUTO_REJECTED` - Show rejection reasons
   - `PENDING_REVIEW` - Show "Submitted for review" state

4. **Polling**: For long conversations, poll `/current` periodically to update UI with new AI replies.

5. **Rate Limiting**: Implement client-side debounce (6 seconds between messages) to avoid 429 errors.

6. **Typing Indicators**: Send `typingDurationMs` and `pasted` with each message for analytics.

---

## Environment Variables (Server-side)

```bash
AI_PROVIDER=fake|nim
NIM_API_URL=https://... (if AI_PROVIDER=nim)
NIM_API_KEY=... (if AI_PROVIDER=nim)
```

---

## Testing Checklist for Web

- [ ] Tutorial completion flow
- [ ] Start conversation (new and resume)
- [ ] Send messages with validation
- [ ] Duplicate message detection
- [ ] Rate limiting handling
- [ ] AI reply retry
- [ ] Submit with <5 exchanges (should reject)
- [ ] Submit with duplicate messages (should auto-reject)
- [ ] Submit with high flagged ratio (should auto-reject)
- [ ] Submit with low effort (should auto-reject via judge)
- [ ] Successful submit → PENDING_REVIEW
- [ ] Conversation history pagination
- [ ] Idempotent message replay