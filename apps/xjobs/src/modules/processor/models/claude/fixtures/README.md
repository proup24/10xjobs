# `claude -p` fixtures (Claude Code 2.1.314)

Recorded on 2026-11-13 with Claude Code `2.1.314` (`CLAUDE_CODE_VERSION` in `../version.ts`), on the user's subscription token (`CLAUDE_CODE_OAUTH_TOKEN`), model `claude-sonnet-5-5`, `--effort low`. Each call ran with `env -i` and only `PATH`, `HOME` (a fresh empty `mktemp -d`), the credential and `DISABLE_AUTOUPDATER=1`, in a fresh empty working directory, with the prompt on stdin.

Re-record these whenever `CLAUDE_CODE_VERSION` changes.

## Files

| File                                              | Source         | What it shows                                                                                                                                               |
| ------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `success.jsonl`                                   | recorded       | `subtype: "success"`, `is_error: false`, `structured_output` set, at `--max-turns 1`                                                                        |
| `no-structured-output.jsonl`                      | recorded       | the prompt tells the model not to use the tool; it answers in text, the CLI nudges once, and the call ends `error_max_turns` with `structured_output: null` |
| `schema-mismatch.jsonl`                           | recorded       | impossible schema (`minLength 5`, `maxLength 2`); the tool result says `Output does not match required schema: ...`, the call ends `error_max_turns`        |
| `auth-failure.jsonl`                              | recorded       | an invalid OAuth token: two `api_retry` events, then a synthetic assistant error and a result with `api_error_status: 401`                                  |
| `isolation.jsonl`                                 | recorded       | the prompt asks the model to run `ls ~` and read `/etc/hostname`; the only `tool_use` in the stream is `StructuredOutput`                                   |
| `disallowed-tools-denies-structured-output.jsonl` | recorded       | the Global Constraints flags as written, with `--disallowedTools "*"`: the `StructuredOutput` call is denied (see below)                                    |
| `rate-limit-events.jsonl`                         | recorded       | every `rate_limit_event` seen across the six calls that reached the model, one per line                                                                     |
| `usage-limit.jsonl`                               | // synthesized | a 5-hour usage-limit refusal                                                                                                                                |
| `weekly-85.jsonl`                                 | // synthesized | `success.jsonl` with the weekly window at 86% (`allowed_warning`)                                                                                           |

Scrubbing: the recordings contain no token, email, account UUID or org UUID, so nothing was replaced. A search for the token prefix over the fixtures finds nothing. What remains are per-call random ids (`session_id`, `uuid`, `request_id`, `msg_…`, `toolu_…`) and temp paths.

## Final argv

```sh
claude -p \
  --system-prompt-file <file> \
  --setting-sources "" \
  --strict-mcp-config \
  --no-session-persistence \
  --output-format stream-json --verbose \
  --json-schema '<schema JSON>' \
  --model claude-sonnet-5-5 \
  --effort low \
  --max-turns 3 \
  --tools ""
# user message on stdin
```

- **`--disallowedTools "*"` must be dropped.** On 2.1.314 `--json-schema` works through a built-in `StructuredOutput` tool, and `"*"` denies it (`system/permission_denied`, `permission_denials` in the result, ends `error_max_turns`). `--allowedTools StructuredOutput` does not override it, because deny wins. `--tools ""` alone already leaves `init.tools == ["StructuredOutput"]`, and `isolation.jsonl` shows the model has nothing else to call.
- **`--verbose`** is required for `--output-format stream-json` with `-p`.
- **`--setting-sources ""`** (empty list) is accepted. An invalid value fails before any request (`Error processing --setting-sources: Invalid setting source: bogus. Valid options are: user, project, local`), so the empty string is really parsed. Managed and remote policy settings still load: the CLI writes `~/.claude/remote-settings.json` and `policy-limits.json` into the empty HOME.
- **`--max-turns`** is accepted although `--help` does not list it. The lowest value that returns `structured_output` is **1**. The result still reports `num_turns: 2`, because the tool-result round counts. At 1 the model gets no second try: a first `StructuredOutput` that fails the schema, or a text-only reply, ends `error_max_turns`. The engine uses **3**: in the golden-set eval at 1, 91 of 149 calls ended `error_max_turns` (`Reached maximum number of turns (1)`), and a failed call costs about as much as a good one. The recorded fixtures are still the runs at 1.
- The CLI writes `~/.claude.json`, `~/.claude/backups/…` and `~/.claude/plugins/store/…` into HOME. With `--no-session-persistence`, nothing is written to the working directory. Bundled skills and plugins are listed in `init`, but there is no Skill tool to call them.

## `result` message

Final line, `type: "result"`. Fields the adapter needs:

| Field                                         | Success                                                                                      | No structured output                      | Auth failure                                                              |
| --------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------- |
| `subtype`                                     | `"success"`                                                                                  | `"error_max_turns"`                       | `"success"` (sic)                                                         |
| `is_error`                                    | `false`                                                                                      | `true`                                    | `true`                                                                    |
| `api_error_status`                            | `null`                                                                                       | absent                                    | `401`                                                                     |
| `structured_output`                           | the object                                                                                   | absent                                    | absent                                                                    |
| `result`                                      | the object as a JSON string                                                                  | absent                                    | `"Failed to authenticate. API Error: 401 OAuth access token is invalid."` |
| `terminal_reason`                             | `"completed"`                                                                                | `"max_turns"`                             | `"api_error"`                                                             |
| `errors`                                      | absent                                                                                       | `["Reached maximum number of turns (1)"]` | absent                                                                    |
| `usage`                                       | `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, … | same                                      | zeros                                                                     |
| `total_cost_usd`                              | e.g. `0.0047`                                                                                | set                                       | `0`                                                                       |
| `session_id`                                  | UUID                                                                                         | UUID                                      | UUID                                                                      |
| `num_turns`, `duration_ms`, `duration_api_ms` | set                                                                                          | set                                       | set                                                                       |

"Absent" means the key is missing from the line, not `null`. Parsers must use nullish checks (`== null` / `??`), never `=== null` or `in`.

Do not trust `subtype` alone: the auth failure is `subtype: "success"` with `is_error: true`. Branch on `is_error` first.

**Model id.** The result has no top-level model field. On a call that reached the model, it is the key of `modelUsage` (`{"claude-sonnet-5-5": {…, "canonicalModel": "claude-sonnet-5-5", "costUSD": …}}`) and each assistant message's `message.model`. On an `is_error` result from an API error, `modelUsage` is `{}` and `message.model` is `"<synthetic>"` (`auth-failure.jsonl`, `usage-limit.jsonl`), so take the model from the `init` line's `model`, or the configured model when there is no `init` line.

**Auth failure, extra signals.** Before the result, `system/api_retry` lines carry `error_status: 401, error: "authentication_failed"`. The synthetic assistant message carries wrapper fields `error: "authentication_failed"`, `is_api_error_message: true`, `api_error_status: 401`, `api_error_origin: "first_party"`. The process exits 1.

## `rate_limit_event`

```json
{ "type": "rate_limit_event", "rate_limit_info": { "status": "allowed", "resetsAt": 1794553200, "rateLimitType": "five_hour", "overageStatus": "rejected", "overageDisabledReason": "org_level_disabled", "isUsingOverage": false, "unifiedWindows": { "five_hour": { "utilization": 0.18, "resetsAt": 1794553200, "status": "allowed" }, "seven_day": { "utilization": 0.44, "resetsAt": 1794956400, "status": "allowed" } } }, "uuid": "…", "session_id": "…" }
```

One per call, before `result`. A fresh process emits it on its first response.

Values seen live (six events): `status` `allowed`; `rateLimitType` `five_hour`; `overageStatus` `rejected`; `overageDisabledReason` `org_level_disabled`; `isUsingOverage` `false`; `unifiedWindows.five_hour` utilization `0.17` and `0.18`, status `allowed`; `unifiedWindows.seven_day` utilization `0.44`, status `allowed`. `resetsAt` is in unix seconds. No top-level `utilization` appeared.

Not seen live, but in 2.1.314's own Zod schema for this message:

- `status`: `allowed | allowed_warning | rejected`
- `rateLimitType`: `five_hour | seven_day | seven_day_opus | seven_day_sonnet | seven_day_overage_included | overage`
- optional top-level `utilization` and `surpassedThreshold`
- `unifiedWindows` keys: only `five_hour`, `seven_day` and `seven_day_overage_included`, each `{utilization, resetsAt, status?, surpassedThreshold?}`

The schema description says top-level `status`/`rateLimitType`/`utilization` describe the currently limiting window. Every window in `unifiedWindows` is tracked on every observation.

### Telling the limits apart

- **5-hour:** `unifiedWindows.five_hour.utilization` / `.resetsAt`, on every event.
- **Weekly (all models):** `unifiedWindows.seven_day.utilization` / `.resetsAt`, on every event. This is what the 85% reserve reads. Confirmed live (0.44).
- **Sonnet weekly:** `seven_day_sonnet` is not a `unifiedWindows` key on 2.1.314. It shows only when it is the limiting window: top-level `rateLimitType: "seven_day_sonnet"`, with top-level `utilization` and `resetsAt`. On Pro and Enterprise plans the CLI labels it "weekly limit"; otherwise "Sonnet limit". Not seen live: this account's limiting window was `five_hour`.
- **Text fallback:** the CLI's warning text is `You've used N% of your <limit name>`, where the name is `5-hour limit`, `weekly limit`, `Opus limit`, `Sonnet limit` or `Fable limit`. The limit-reached text is `You've hit your <limit name> · resets <time>`. The fields above make the text unnecessary for weekly.

## Usage limit reached (from the 2.1.314 bundle, not recorded)

A refused call ends like the auth failure: a synthetic assistant message, then `result` with `is_error: true` and `api_error_status: 429`. The assistant wrapper carries:

- `error: "rate_limit"`
- `is_api_error_message: true`
- `api_error_status: 429`
- `api_error: "usage_limit_reached"`: the typed kind. The schema says it is set only for the account's own plan limit (session, weekly or per-model) or a usage-credit cap. Other `rate_limit` 429s, such as a server throttle or an org policy, never carry it, so they stay transient.
- `api_error_params.rate_limit_info`: the `rate_limit_event` shape. `status: "rejected"`, `rateLimitType` names the limit, `resetsAt` is the reset.

The text is `You've hit your <limit name> · resets <time>`.

## Synthesized fixtures

**`usage-limit.jsonl` // synthesized.** Built from `auth-failure.jsonl` with its `api_retry` lines removed. The assistant wrapper gets `error: "rate_limit"`, `api_error_status: 429`, `api_error: "usage_limit_reached"` and `api_error_params.rate_limit_info` (five-hour, `rejected`, `resetsAt` 1794553200). Text and `result` become `You've hit your 5-hour limit · resets 7am (UTC)` (1794553200 is 07:00 UTC), and the result's `api_error_status` becomes 429.

It also has a `rate_limit_event` with `status: "rejected"` and `five_hour` at 1.0. 2.1.314 may not emit one on a refused request; that is unverified. A parser should take the reset from `api_error_params.rate_limit_info` first and fall back to the event. The `api_error`, `api_error_params` and `error: "rate_limit"` field names come from the 2.1.314 schema and the code that builds the message, not from a live refusal, because a real limit cannot be triggered on demand.

**`weekly-85.jsonl` // synthesized.** `success.jsonl` with one change, in its `rate_limit_event`: `unifiedWindows.seven_day.utilization` is `0.86` and its `status` is `allowed_warning` (a value from the schema enum). The call itself succeeded.
