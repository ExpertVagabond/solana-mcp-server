/**
 * Vendored subset of @psm/mcp-core-ts.
 *
 * PROVENANCE
 *   Upstream:  github.com/ExpertVagabond/psm-mcp-core-ts (private)
 *   Commit:    bb183cace8038df7fa9d77d55d77a5e2ac54702e (2026-03-31)
 *   Files:     src/error.ts, src/input.ts, src/filter.ts
 *   License:   MIT (same author) — see LICENSE
 *
 * WHY VENDORED
 *   @psm/mcp-core-ts is not published to npm and its GitHub repository is
 *   private, with dist/ excluded by .gitignore. The previous dependency spec
 *   "@psm/mcp-core-ts": "file:../psm-mcp-core-ts" only resolved on a machine
 *   that happened to have the sibling checkout, so it broke both CI (TS2307 at
 *   install/build time) and any `npm install solana-mcp-server` by a consumer.
 *   Copying the exact upstream implementations keeps the real behaviour and
 *   real type-checking with no unresolvable dependency.
 *
 * KEEPING IN SYNC
 *   The code below is byte-for-byte the upstream implementation, which itself
 *   mirrors psm-mcp-core (Rust) 1:1. If the upstream regexes, error codes, or
 *   redaction categories change, re-copy them here and bump the commit above.
 *
 * SCOPE
 *   Only the surface used by src/index.ts is vendored:
 *     - PsmMcpError    (error.ts) — thrown by validateNoInjection
 *     - sanitizeError  (error.ts)
 *     - validateNoInjection (input.ts)
 *     - OutputFilter   (filter.ts)
 */

// ============================================================================
// error.ts — Unified error type. Mirrors psm-mcp-core/src/error.rs 1:1.
// ============================================================================

export type PsmMcpErrorKind =
  | "InputValidation"
  | "ShellExec"
  | "PolicyViolation"
  | "Timeout"
  | "Sandbox"
  | "Config"
  | "RateLimited"
  | "NotFound"
  | "PermissionDenied"
  | "Internal";

const ERROR_CODES: Record<PsmMcpErrorKind, number> = {
  InputValidation: -32602,
  ShellExec: -32603,
  PolicyViolation: -32604,
  Timeout: -32605,
  Sandbox: -32606,
  Config: -32607,
  RateLimited: -32608,
  NotFound: -32609,
  PermissionDenied: -32610,
  Internal: -32603,
};

export class PsmMcpError extends Error {
  readonly kind: PsmMcpErrorKind;
  readonly code: number;

  constructor(kind: PsmMcpErrorKind, message: string) {
    super(message);
    this.name = "PsmMcpError";
    this.kind = kind;
    this.code = ERROR_CODES[kind];
  }

  static inputValidation(msg: string): PsmMcpError {
    return new PsmMcpError("InputValidation", `input validation failed: ${msg}`);
  }

  static shellExec(msg: string): PsmMcpError {
    return new PsmMcpError("ShellExec", `shell execution failed: ${msg}`);
  }

  static policyViolation(msg: string): PsmMcpError {
    return new PsmMcpError("PolicyViolation", `policy violation: ${msg}`);
  }

  static timeout(ms: number): PsmMcpError {
    return new PsmMcpError("Timeout", `timeout after ${ms}ms`);
  }

  static sandbox(msg: string): PsmMcpError {
    return new PsmMcpError("Sandbox", `sandbox error: ${msg}`);
  }

  static config(msg: string): PsmMcpError {
    return new PsmMcpError("Config", `configuration error: ${msg}`);
  }

  static rateLimited(retryAfterSecs: number): PsmMcpError {
    return new PsmMcpError("RateLimited", `rate limited: retry after ${retryAfterSecs}s`);
  }

  static notFound(msg: string): PsmMcpError {
    return new PsmMcpError("NotFound", `not found: ${msg}`);
  }

  static permissionDenied(msg: string): PsmMcpError {
    return new PsmMcpError("PermissionDenied", `permission denied: ${msg}`);
  }

  static internal(msg: string): PsmMcpError {
    return new PsmMcpError("Internal", msg);
  }
}

// Mirrors: sanitize_error() in error.rs
const PATH_RE = /(?:\/[a-zA-Z0-9._\-]+){3,}/g;

/**
 * Strip file paths, truncate to maxLen chars, redact tokens longer than 40 chars.
 */
export function sanitizeError(msg: string, maxLen = 300): string {
  const stripped = msg.replace(PATH_RE, "[PATH]");
  const words = stripped.split(/\s+/);
  let out = "";
  for (const word of words) {
    const part = word.length > 40 ? "[REDACTED]" : word;
    if (out.length + part.length + 1 >= maxLen) {
      return out.slice(0, maxLen) + "...";
    }
    out += (out ? " " : "") + part;
  }
  return out;
}

// ============================================================================
// input.ts — Input validation. Mirrors psm-mcp-core/src/input.rs 1:1.
// ============================================================================

// Injection patterns — reject inputs containing these.
// Identical to Rust INJECTION_RE.
const INJECTION_PATTERNS: Array<[string, RegExp]> = [
  ["shell_meta", /[;|&`]/],
  ["path_traversal", /\.\.[\\/]/],
  ["null_byte", /\x00/],
  ["newline_inject", /[\r\n]/],
];

/**
 * Validate a string contains no shell injection characters.
 */
export function validateNoInjection(value: string, label: string): string {
  for (const [category, re] of INJECTION_PATTERNS) {
    if (re.test(value)) {
      throw PsmMcpError.inputValidation(
        `${label} contains forbidden characters (${category})`
      );
    }
  }
  return value;
}

// ============================================================================
// filter.ts — Output filtering. Mirrors psm-mcp-core/src/filter.rs 1:1.
// Same 9 secret patterns, same 4 PII patterns.
// ============================================================================

/** Record of a single redaction applied to output. */
export interface Redaction {
  category: string;
  originalLength: number;
}

/** Result of filtering output text. */
export interface FilterResult {
  modified: boolean;
  text: string;
  redactions: Redaction[];
}

interface PatternDef {
  name: string;
  regex: RegExp;
}

// 9 secret patterns — identical to Rust SECRET_PATTERNS.
const SECRET_PATTERNS: PatternDef[] = [
  { name: "aws_key", regex: /AKIA[0-9A-Z]{16}/g },
  {
    name: "aws_secret",
    regex: /aws[_\-]?secret[_\-]?access[_\-]?key\s*[=:]\s*\S{20,}/gi,
  },
  { name: "github_token", regex: /gh[ps]_[A-Za-z0-9_]{36,}/g },
  {
    name: "generic_api_key",
    regex: /(api[_\-]?key|api[_\-]?secret)\s*[=:]\s*\S{16,}/gi,
  },
  { name: "jwt", regex: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/g },
  {
    name: "private_key",
    regex: /-----BEGIN\s+(?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
  },
  { name: "slack_token", regex: /xox[bpras]-[A-Za-z0-9\-]{10,}/g },
  { name: "anthropic_key", regex: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: "openai_key", regex: /sk-[A-Za-z0-9]{20,}/g },
];

// 4 PII patterns — identical to Rust PII_PATTERNS.
const PII_PATTERNS: PatternDef[] = [
  { name: "ssn", regex: /\b\d{3}-\d{2}-\d{4}\b/g },
  {
    name: "credit_card",
    regex:
      /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6011)[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
  },
  {
    name: "email",
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  {
    name: "phone",
    regex: /\b(?:\+1[\s-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
  },
];

/** Output filter that redacts secrets and PII from text. */
export class OutputFilter {
  private readonly filterSecrets: boolean;
  private readonly filterPii: boolean;

  constructor(filterSecrets = true, filterPii = true) {
    this.filterSecrets = filterSecrets;
    this.filterPii = filterPii;
  }

  /** Filter text, redacting secrets and/or PII. */
  filter(text: string): FilterResult {
    let result = text;
    const redactions: Redaction[] = [];

    const apply = (patterns: PatternDef[]) => {
      for (const pat of patterns) {
        // Reset regex lastIndex for global patterns.
        pat.regex.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pat.regex.exec(result)) !== null) {
          redactions.push({
            category: pat.name,
            originalLength: match[0].length,
          });
        }
        pat.regex.lastIndex = 0;
        result = result.replace(
          pat.regex,
          `[REDACTED_${pat.name.toUpperCase()}]`
        );
      }
    };

    if (this.filterSecrets) apply(SECRET_PATTERNS);
    if (this.filterPii) apply(PII_PATTERNS);

    return {
      modified: redactions.length > 0,
      text: result,
      redactions,
    };
  }
}

/** Default filter instance (secrets + PII). */
export const defaultFilter = new OutputFilter();
