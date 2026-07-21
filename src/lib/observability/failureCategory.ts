/**
 * Terminal-failure classification.
 *
 * When a job exhausts its retries it becomes a dead letter. Before an operator
 * looks at it, we bucket the failure into a small, stable set of categories so
 * the dead-letter view is triageable and so replay can be gated: a
 * RIGHTS_DENIED or PROVIDER_REJECTED failure should NOT be blindly replayed,
 * whereas TRANSIENT_NETWORK / RATE_LIMITED usually can be.
 *
 * Classification is best-effort pattern matching over the error name/message —
 * it never throws and always returns a category (UNKNOWN as the floor).
 */

export type FailureCategory =
  | "TRANSIENT_NETWORK"
  | "RATE_LIMITED"
  | "RIGHTS_DENIED"
  | "MEDIA_INVALID"
  | "PROVIDER_REJECTED"
  | "CONFIG_MISSING"
  | "NOT_FOUND"
  | "TIMEOUT"
  | "UNKNOWN";

export interface FailureClassification {
  category: FailureCategory;
  /** Whether an automated/operator replay is reasonable without a code change. */
  retryable: boolean;
  message: string;
}

/** Categories where replay may succeed once the transient condition clears. */
const RETRYABLE: ReadonlySet<FailureCategory> = new Set<FailureCategory>([
  "TRANSIENT_NETWORK",
  "RATE_LIMITED",
  "TIMEOUT",
]);

interface Rule {
  category: FailureCategory;
  test: (name: string, msg: string) => boolean;
}

// Order matters: the first matching rule wins, most-specific first.
const RULES: Rule[] = [
  {
    category: "RIGHTS_DENIED",
    test: (_n, m) => /rights|permission|not permitted|denied|unauthori[sz]ed use|licen[sc]e/.test(m),
  },
  {
    category: "RATE_LIMITED",
    test: (_n, m) => /rate ?limit|429|too many requests|throttl|quota exceeded/.test(m),
  },
  {
    category: "TIMEOUT",
    test: (n, m) => /timeout/.test(n) || /timed? ?out|etimedout|deadline exceeded/.test(m),
  },
  {
    category: "MEDIA_INVALID",
    test: (n, m) =>
      /mediavalidation|ffmpeg/.test(n) ||
      /corrupt|invalid media|unsupported (codec|format)|could not parse|no video stream|dimension|probe/.test(m),
  },
  {
    category: "CONFIG_MISSING",
    test: (_n, m) =>
      /missing (env|config|api ?key|credential|secret)|not configured|no .* key set|enotfound.*localhost/.test(m) ||
      /\benv\b.*(required|missing)/.test(m),
  },
  {
    category: "TRANSIENT_NETWORK",
    test: (_n, m) =>
      /econnrefused|econnreset|enotfound|eai_again|socket hang up|network|dns|503|502|504|gateway/.test(m),
  },
  {
    category: "PROVIDER_REJECTED",
    test: (_n, m) =>
      /rejected|400|401|403|422|invalid_grant|invalid request|policy violation|blocked by platform|not approved|audit/.test(
        m,
      ),
  },
  {
    category: "NOT_FOUND",
    test: (_n, m) => /\b404\b|not found|no such|does not exist|missing record/.test(m),
  },
];

export function classifyFailure(err: unknown): FailureClassification {
  const message = err instanceof Error ? err.message : String(err ?? "unknown error");
  // Subclasses of Error often leave `.name` as "Error"; fall back to the
  // constructor name (e.g. "MediaTimeoutError") so class-based rules still fire.
  const name =
    err instanceof Error ? (err.name && err.name !== "Error" ? err.name : err.constructor?.name ?? err.name) : "";
  const n = name.toLowerCase();
  const m = message.toLowerCase();

  for (const rule of RULES) {
    if (rule.test(n, m)) {
      return { category: rule.category, retryable: RETRYABLE.has(rule.category), message };
    }
  }
  return { category: "UNKNOWN", retryable: false, message };
}

export function isRetryableCategory(category: FailureCategory): boolean {
  return RETRYABLE.has(category);
}
