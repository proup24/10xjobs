/**
 * Parser for `claude -p --output-format stream-json --verbose` output and the
 * classification of failed calls. Field names are the ones recorded in
 * `fixtures/README.md` (Claude Code 2.1.314). Keys are often absent, so every
 * read is nullish-safe; `subtype` is never trusted, `is_error` decides.
 */

export type LimitKind = 'five_hour' | 'weekly' | 'weekly_sonnet' | 'other';

export interface LimitObservation {
  kind: LimitKind;
  status: 'allowed' | 'allowed_warning' | 'rejected';
  utilization: number | null;
  resetsAt: Date | null;
}

export interface ClaudeResult {
  structuredOutput: unknown | undefined;
  isError: boolean;
  apiErrorStatus: number | null;
  errorText: string | null;
  /** `terminal_reason`: `completed`, `max_turns`, `api_error`, … */
  terminalReason: string | null;
  model: string | null;
  sessionId: string | null;
  usage: { input: number; output: number; cachedInput: number };
  costUsd: number | null;
}

export interface ParsedStream {
  result: ClaudeResult | null;
  limits: LimitObservation[];
  /** The assistant wrapper carried `api_error: "usage_limit_reached"`. */
  usageLimitReached: boolean;
  /** Observation from the refusal's `api_error_params.rate_limit_info`. */
  refusalLimit: LimitObservation | null;
  /** A line carried the `authentication_failed` signal. */
  authSignal: boolean;
}

export type CallFailure =
  | { kind: 'usage_limit'; limit: LimitObservation | null }
  | { kind: 'auth' }
  | { kind: 'transient'; reason: string }
  | { kind: 'request'; reason: string }
  | { kind: 'output'; reason: string };

type Json = Record<string, any>;

const STATUSES = ['allowed', 'allowed_warning', 'rejected'] as const;

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function date(v: unknown): Date | null {
  const n = num(v);
  return n == null ? null : new Date(n * 1000);
}

function status(v: unknown, fallback: LimitObservation['status']) {
  return (STATUSES as readonly unknown[]).includes(v)
    ? (v as LimitObservation['status'])
    : fallback;
}

/** One observation per window of a `rate_limit_info` object. */
function observe(
  info: Json | null | undefined,
  forcedStatus?: LimitObservation['status'],
): LimitObservation[] {
  if (info == null || typeof info !== 'object') return [];
  const top = status(info.status, 'allowed');
  const out: LimitObservation[] = [];
  const windows: Json = info.unifiedWindows ?? {};
  for (const [key, kind] of [
    ['five_hour', 'five_hour'],
    ['seven_day', 'weekly'],
  ] as const) {
    const w = windows[key];
    if (w == null || typeof w !== 'object') continue;
    out.push({
      kind,
      status: forcedStatus ?? status(w.status, top),
      utilization: num(w.utilization),
      resetsAt: date(w.resetsAt),
    });
  }
  const type = info.rateLimitType;
  if (type === 'seven_day_sonnet') {
    out.push({
      kind: 'weekly_sonnet',
      status: forcedStatus ?? top,
      utilization: num(info.utilization),
      resetsAt: date(info.resetsAt),
    });
  } else if (type != null && type !== 'five_hour' && type !== 'seven_day') {
    out.push({
      kind: 'other',
      status: forcedStatus ?? top,
      utilization: num(info.utilization),
      resetsAt: date(info.resetsAt),
    });
  }
  return out;
}

/** The observation a refusal is about: its top-level rateLimitType decides. */
function refusalObservation(info: Json): LimitObservation | null {
  const all = observe(info, 'rejected');
  const type = info.rateLimitType;
  const kind: LimitKind =
    type === 'five_hour'
      ? 'five_hour'
      : type === 'seven_day'
        ? 'weekly'
        : type === 'seven_day_sonnet'
          ? 'weekly_sonnet'
          : 'other';
  const match = all.find((l) => l.kind === kind);
  if (match) return match;
  const resetsAt = date(info.resetsAt);
  return {
    kind,
    status: 'rejected',
    utilization: num(info.utilization),
    resetsAt,
  };
}

export function parseStream(stdout: string): ParsedStream {
  const parsed: ParsedStream = {
    result: null,
    limits: [],
    usageLimitReached: false,
    refusalLimit: null,
    authSignal: false,
  };
  let initModel: string | null = null;
  let resultLine: Json | null = null;

  for (const raw of stdout.split('\n')) {
    const text = raw.trim();
    if (!text) continue;
    let line: Json;
    try {
      line = JSON.parse(text);
    } catch {
      continue;
    }
    if (line == null || typeof line !== 'object') continue;

    switch (line.type) {
      case 'system':
        if (line.subtype === 'init' && typeof line.model === 'string') {
          initModel = line.model;
        }
        if (line.error === 'authentication_failed') parsed.authSignal = true;
        break;
      case 'rate_limit_event':
        parsed.limits.push(...observe(line.rate_limit_info));
        break;
      case 'assistant':
        if (line.error === 'authentication_failed') parsed.authSignal = true;
        if (line.api_error === 'usage_limit_reached') {
          parsed.usageLimitReached = true;
          const info = line.api_error_params?.rate_limit_info;
          if (info != null && typeof info === 'object') {
            parsed.refusalLimit = refusalObservation(info);
            if (parsed.refusalLimit) parsed.limits.push(parsed.refusalLimit);
          }
        }
        break;
      case 'result':
        resultLine = line;
        break;
    }
  }

  if (resultLine) parsed.result = toResult(resultLine, initModel);
  return parsed;
}

function toResult(line: Json, initModel: string | null): ClaudeResult {
  const isError = line.is_error === true;
  const usedModel = Object.keys(line.modelUsage ?? {})[0];
  const errors: unknown = line.errors;
  const errorText =
    typeof line.result === 'string' && isError
      ? line.result
      : Array.isArray(errors) && errors.length > 0
        ? errors.map(String).join('; ')
        : isError && typeof line.result === 'string'
          ? line.result
          : null;
  return {
    structuredOutput: line.structured_output ?? undefined,
    isError,
    apiErrorStatus: num(line.api_error_status),
    errorText,
    terminalReason:
      typeof line.terminal_reason === 'string' ? line.terminal_reason : null,
    model: (isError ? (usedModel ?? initModel) : usedModel) ?? initModel,
    sessionId: typeof line.session_id === 'string' ? line.session_id : null,
    usage: {
      input: num(line.usage?.input_tokens) ?? 0,
      output: num(line.usage?.output_tokens) ?? 0,
      cachedInput: num(line.usage?.cache_read_input_tokens) ?? 0,
    },
    costUsd: num(line.total_cost_usd),
  };
}

export function classify(
  parsed: ParsedStream,
  exit: { code: number | null; timedOut: boolean },
): CallFailure | null {
  if (exit.timedOut) {
    return { kind: 'transient', reason: 'claude call timed out' };
  }
  const r = parsed.result;
  if (r == null) {
    if (parsed.authSignal) return { kind: 'auth' };
    return {
      kind: 'transient',
      reason:
        exit.code != null && exit.code !== 0
          ? `claude exited ${exit.code} without a result`
          : 'claude produced no result',
    };
  }

  if (r.isError) {
    const status = r.apiErrorStatus;
    const detail = r.errorText ?? 'no error text';
    // The typed kind decides; the status may be missing or other than 429.
    if (parsed.usageLimitReached) {
      const rejected = [...parsed.limits]
        .reverse()
        .find((l) => l.status === 'rejected');
      return {
        kind: 'usage_limit',
        limit: parsed.refusalLimit ?? rejected ?? null,
      };
    }
    if (status === 401 || (status == null && parsed.authSignal))
      return { kind: 'auth' };
    if (status != null) {
      if (status === 429 || status === 529 || status >= 500) {
        return { kind: 'transient', reason: `API ${status}: ${detail}` };
      }
      if (status >= 400) {
        return { kind: 'request', reason: `API ${status}: ${detail}` };
      }
    }
    // Only a turn-limit end (no output, or output the schema rejected) is
    // the model's fault. A status-less API error (connection error, request
    // timeout) and anything unknown are retried.
    if (r.terminalReason === 'max_turns') {
      return { kind: 'output', reason: detail };
    }
    return { kind: 'transient', reason: detail };
  }

  if (r.structuredOutput === undefined) {
    return { kind: 'output', reason: 'no structured_output in result' };
  }
  return null;
}
