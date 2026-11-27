/**
 * What the model requests of one `claude -p` call did, read from its
 * stream-json stdout (slice 03 task 12): stored on the call's
 * `processing_attempts.turns`, so a call that needed two or three requests
 * shows whether it answered in text (and was nudged) or had its
 * `StructuredOutput` call rejected by the CLI's schema check. A type, not an
 * interface, so it is assignable to the jsonb column's `JsonValue`.
 */
export type CallTurns = {
  /** The result line's `num_turns`. */
  numTurns: number | null;
  /** The result line's `subtype`: `success`, `error_max_turns`, … */
  subtype: string | null;
  /** Model requests: assistant messages (lines sharing a message id are one). */
  requests: number;
  /** Requests with text but no `StructuredOutput` call. */
  textReplies: number;
  /** `[structured-output-enforce]` messages the CLI injected. */
  enforceNudges: number;
  /** `StructuredOutput` calls. */
  toolCalls: number;
  /** The text of each rejected tool call (`is_error: true`), clipped; the last few. */
  rejections: string[];
};

const REJECTION_MAX = 300;
const REJECTIONS_KEPT = 3;
const TOOL = 'StructuredOutput';
const NUDGE = '[structured-output-enforce]';

type Json = Record<string, any>;

const clip = (text: string): string =>
  text.length > REJECTION_MAX ? `${text.slice(0, REJECTION_MAX)}…` : text;

const blocks = (line: Json): Json[] => {
  const content = line.message?.content;
  return Array.isArray(content)
    ? content.filter((b) => b != null && typeof b === 'object')
    : [];
};

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content
      .map((c) => (typeof c?.text === 'string' ? c.text : ''))
      .filter(Boolean)
      .join(' ');
  return '';
}

/** Pure: never throws, whatever the stdout holds. */
export function parseTurns(stdout: string): CallTurns {
  const turns: CallTurns = {
    numTurns: null,
    subtype: null,
    requests: 0,
    textReplies: 0,
    enforceNudges: 0,
    toolCalls: 0,
    rejections: [],
  };
  // One request per message id; a line without an id is a request of its own.
  const requests = new Map<string, { text: boolean; tool: boolean }>();
  let anonymous = 0;

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

    if (line.type === 'assistant') {
      // The CLI's own error messages (usage limit, auth) are not model requests.
      if (line.message?.model === '<synthetic>') continue;
      const id =
        typeof line.message?.id === 'string'
          ? line.message.id
          : `#${anonymous++}`;
      const request = requests.get(id) ?? { text: false, tool: false };
      for (const b of blocks(line)) {
        if (b.type === 'text' && typeof b.text === 'string' && b.text.trim())
          request.text = true;
        if (b.type === 'tool_use' && b.name === TOOL) {
          request.tool = true;
          turns.toolCalls++;
        }
      }
      requests.set(id, request);
    } else if (line.type === 'user') {
      for (const b of blocks(line)) {
        if (b.type === 'text' && typeof b.text === 'string') {
          if (b.text.startsWith(NUDGE)) turns.enforceNudges++;
        } else if (b.type === 'tool_result' && b.is_error === true) {
          turns.rejections.push(clip(resultText(b.content)));
        }
      }
    } else if (line.type === 'result') {
      turns.numTurns =
        typeof line.num_turns === 'number' && Number.isFinite(line.num_turns)
          ? line.num_turns
          : null;
      turns.subtype = typeof line.subtype === 'string' ? line.subtype : null;
    }
  }

  turns.requests = requests.size;
  for (const r of requests.values()) if (r.text && !r.tool) turns.textReplies++;
  turns.rejections = turns.rejections.slice(-REJECTIONS_KEPT);
  return turns;
}

/** The compact form for the per-call log line. */
export function turnsSummary(t: CallTurns): string {
  return `requests ${t.requests} · text ${t.textReplies} · nudges ${t.enforceNudges} · rejected ${t.rejections.length}`;
}

/**
 * Why a call ran out of turns, for the attempt's `error`: the last rejection
 * text, or that no `StructuredOutput` call was made. Null when neither holds.
 */
export function maxTurnsReason(t: CallTurns): string | null {
  const requests = `${t.requests} request${t.requests === 1 ? '' : 's'}`;
  const last = t.rejections.at(-1);
  if (last !== undefined)
    return `max turns after ${requests}; last rejection: ${last}`;
  if (t.toolCalls === 0)
    return `max turns: no StructuredOutput call in ${requests}`;
  return null;
}
