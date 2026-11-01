/**
 * One-off spike for the processor module. Sends one OpenRouter Decisions API
 * call and one Opus structured-output call, and writes the response bodies
 * (never headers or the key) as fixtures that later tests replay:
 *
 *   pnpm --filter @xjobs/xjobs processor:spike
 *
 * Needs only `OPENROUTER_API_KEY`. A non-2xx response is still written, with
 * its status, so a failed run says what the API rejected.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadEnvironmentFiles } from 'src/config/environment.loader';

const FIXTURES_DIR = resolve(
  process.cwd(),
  process.cwd().endsWith('apps/xjobs') ? '' : 'apps/xjobs',
  'src/modules/processor/models/fixtures',
);

const POSTING = [
  'Senior Backend Engineer at Acme (remote, EU).',
  'You will build NestJS and PostgreSQL services for our payments platform.',
  '5+ years of experience with TypeScript required. Open to candidates in',
  'Germany, France and Spain.',
].join(' ');

const decisionBody = {
  model: 'typesafe/jev-1.14',
  state: POSTING,
  questions: {
    seniority: {
      type: 'choice',
      instructions: 'What seniority level is this role?',
      criteria: {
        junior: 'Entry level, under 2 years of experience.',
        mid: 'Around 2 to 5 years of experience.',
        senior: 'Senior, 5+ years or leading work.',
        unstated: 'The posting does not say.',
      },
    },
    isSoftwareEngineeringRole: {
      type: 'noul',
      instructions: 'Is this a software engineering role?',
      criteria: {
        true: 'The role mainly writes or designs software.',
        false: 'The role is not mainly software engineering.',
      },
    },
  },
};

const extractionBody = {
  model: 'anthropic/claude-opus-5.5',
  messages: [
    {
      role: 'user',
      content: `List the places this candidate may work from.\n\n${POSTING}`,
    },
  ],
  response_format: {
    type: 'json_schema',
    json_schema: {
      name: 'probe',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['locations'],
        properties: {
          locations: {
            type: 'array',
            items: {
              oneOf: [
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['kind', 'code'],
                  properties: {
                    kind: { type: 'string', enum: ['country'] },
                    code: { type: 'string' },
                  },
                },
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['kind'],
                  properties: { kind: { type: 'string', enum: ['worldwide'] } },
                },
              ],
            },
          },
        },
      },
    },
  },
  provider: { require_parameters: true },
};

async function call(
  apiKey: string,
  url: string,
  body: unknown,
  file: string,
): Promise<boolean> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { unparsedBody: text };
  }
  const out = response.ok ? parsed : { status: response.status, body: parsed };
  const path = resolve(FIXTURES_DIR, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`${url} -> ${response.status}, wrote ${path}`);
  return response.ok;
}

async function main(): Promise<void> {
  loadEnvironmentFiles();
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');
  const decision = await call(
    apiKey,
    'https://openrouter.ai/api/alpha/decisions',
    decisionBody,
    'decision-ok.json',
  );
  const extraction = await call(
    apiKey,
    'https://openrouter.ai/api/v1/chat/completions',
    extractionBody,
    'extraction-ok.json',
  );
  if (!decision || !extraction) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
