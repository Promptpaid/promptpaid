// Single place for every request the web app makes to the Express server.
//
// - The base address comes from NEXT_PUBLIC_SERVER_URL (declared in
//   apps/web/.env.schema), never hardcoded.
// - Every request includes credentials so the httpOnly session cookie set by
//   the server travels. Nothing about the session is stored client-side.
// - Every status the server can return is mapped once, here, to a small
//   typed error: field errors keyed by field name (400), 401/403, 409
//   wrong_status with nextStep, 415, 429, 5xx and no connection. Callers
//   never see raw server errors or stack traces.
//
// Error objects carry only safe data: HTTP status, the server's `status`
// code word, user-facing messages written for display, and field errors.
// Nothing is logged and no personal data is attached.

export type FieldErrors = Record<string, string[]>;

export type ApiErrorKind =
  | "fields" // 400 - validation errors, one entry per field name
  | "unauthorized" // 401 - no/expired session; caller clears state and goes to login
  | "forbidden" // 403
  | "wrong_status" // 409 - server says the user is on another step; recover via GET /onboarding/status
  | "not_found" // 404 - nothing there yet (e.g. no open attempt, no result)
  | "rate_limited" // 429 - tell the user to wait
  | "unsupported_media" // 415 - client bug; treated like any retryable failure
  | "server" // 5xx
  | "offline"; // fetch failed / timeout / device offline

const OFFLINE_MESSAGE = "No connection. Check your data and try again.";
const SERVER_MESSAGE = "Something went wrong. Please try again.";
const FIELDS_MESSAGE = "Please check the highlighted fields.";
const RATE_LIMITED_MESSAGE = "Too many attempts. Please wait a few minutes, then try again.";
const UNAUTHORIZED_MESSAGE = "Please sign in to continue.";
const FORBIDDEN_MESSAGE = "You don't have access to that.";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  /** HTTP status, or 0 when the request never completed. */
  readonly status: number;
  /** The server's body `status` word (e.g. "expired", "duplicate", "cooldown"). */
  readonly code: string | null;
  /** 400 only: messages per field name, ready to sit next to each input. */
  readonly fieldErrors: FieldErrors;
  /** 409/404 bodies carry the real next step sentence for display. */
  readonly nextStep: string | null;
  /**
   * The parsed response body, for endpoints whose success-shaped error
   * bodies carry extra display facts (e.g. cooldown's nextAttemptDate,
   * payment shortfall). Callers read it defensively.
   */
  readonly body: unknown;

  constructor(args: {
    kind: ApiErrorKind;
    status: number;
    message: string;
    code?: string | null;
    fieldErrors?: FieldErrors;
    nextStep?: string | null;
    body?: unknown;
  }) {
    super(args.message);
    this.name = "ApiError";
    this.kind = args.kind;
    this.status = args.status;
    this.code = args.code ?? null;
    this.fieldErrors = args.fieldErrors ?? {};
    this.nextStep = args.nextStep ?? null;
    this.body = args.body ?? null;
  }
}

const SERVER_BASE = (process.env.NEXT_PUBLIC_SERVER_URL ?? "").replace(/\/+$/, "");

if (!SERVER_BASE && typeof window !== "undefined") {
  // Config problem, not a secret: say so once, without echoing any values.
  console.warn("NEXT_PUBLIC_SERVER_URL is not set; API requests will fail.");
}

function asFieldErrors(value: unknown): FieldErrors {
  if (typeof value !== "object" || value === null) return {};
  const out: FieldErrors = {};
  for (const [field, messages] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(messages)) {
      const text = messages.filter((m): m is string => typeof m === "string");
      if (text.length > 0) out[field] = text;
    }
  }
  return out;
}

interface ApiInit {
  method?: "GET" | "POST";
  body?: unknown;
  /** Milliseconds before the request gives up and reports an offline error. */
  timeoutMs?: number;
  /** Callers may pass their own signal (e.g. cancel on unmount) instead. */
  signal?: AbortSignal;
}

/** Authenticated or not, every request must carry the session cookie. */
export async function api<T = unknown>(path: string, init: ApiInit = {}): Promise<T> {
  const method = init.method ?? "GET";
  const hasBody = init.body !== undefined;
  const signal = init.signal ?? AbortSignal.timeout(init.timeoutMs ?? 15_000);

  let res: Response | null = null;
  try {
    res = await fetch(`${SERVER_BASE}${path}`, {
      method,
      // Session cookie travels on every call. The cookie itself is set and
      // owned by the server; nothing is cached client-side.
      credentials: "include",
      cache: "no-store",
      headers: hasBody ? { "Content-Type": "application/json" } : undefined,
      body: hasBody ? JSON.stringify(init.body) : undefined,
      signal,
    });
  } catch {
    // Network failure, device offline, or timeout. Never touches user input.
    throw new ApiError({ kind: "offline", status: 0, message: OFFLINE_MESSAGE });
  }

  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const message = typeof data?.message === "string" ? data.message : null;
  const code = typeof data?.status === "string" ? data.status : null;

  if (res.ok) return (data ?? {}) as T;

  const base = {
    status: res.status,
    code,
    body: data,
  };

  switch (res.status) {
    case 400: {
      const fieldErrors =
        Object.keys(asFieldErrors(data?.errors)).length > 0
          ? asFieldErrors(data?.errors)
          : {};
      throw new ApiError({
        ...base,
        kind: fieldErrors ? "fields" : "server",
        message: message ?? FIELDS_MESSAGE,
        fieldErrors,
      });
    }
    case 401:
      throw new ApiError({
        ...base,
        kind: "unauthorized",
        message: message ?? UNAUTHORIZED_MESSAGE,
      });
    case 403:
      throw new ApiError({
        ...base,
        kind: "forbidden",
        message: message ?? FORBIDDEN_MESSAGE,
      });
    case 404:
      throw new ApiError({
        ...base,
        kind: "not_found",
        message: message ?? "Not found.",
        nextStep: typeof data?.nextStep === "string" ? data.nextStep : null,
      });
    case 409:
      throw new ApiError({
        ...base,
        kind: "wrong_status",
        message: message ?? "Your place in the journey changed.",
        nextStep: typeof data?.nextStep === "string" ? data.nextStep : null,
      });
    case 415:
      throw new ApiError({
        ...base,
        kind: "unsupported_media",
        message: message ?? SERVER_MESSAGE,
      });
    case 429:
      throw new ApiError({
        ...base,
        kind: "rate_limited",
        message: message ?? RATE_LIMITED_MESSAGE,
      });
    default:
      // 5xx and anything unmapped: friendly retry, nothing technical.
      throw new ApiError({
        ...base,
        kind: "server",
        message: message ?? SERVER_MESSAGE,
      });
  }
}
