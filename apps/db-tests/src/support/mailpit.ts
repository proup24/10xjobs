import { assertLocal } from './stack-env.js';

const MAILPIT = 'http://127.0.0.1:54324';

export type SignInEmail = {
  subject: string;
  code: string;
  tokenHash: string;
  type: 'invite' | 'email';
};

type Summary = { ID: string; Created: string; Subject: string };

async function messagesTo(email: string, after?: Date): Promise<Summary[]> {
  assertLocal(MAILPIT);
  const query = encodeURIComponent(`to:"${email}"`);
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${query}`);
  if (!res.ok) throw new Error(`Mailpit search failed: ${res.status}`);
  const body = (await res.json()) as { messages?: Summary[] };
  return (body.messages ?? []).filter(
    (m) => !after || new Date(m.Created) > after,
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polls Mailpit for the newest email to an address and parses the code and link out of it. */
export async function latestEmailTo(
  email: string,
  opts: { after?: Date; timeoutMs?: number } = {},
): Promise<SignInEmail> {
  const deadline = Date.now() + (opts.timeoutMs ?? 10_000);
  do {
    const [latest] = await messagesTo(email, opts.after); // newest first
    if (latest) return parse(await fetchMessage(latest.ID), latest.Subject);
    await sleep(250);
  } while (Date.now() < deadline);
  throw new Error(`No email to ${email} arrived within the timeout`);
}

/** Waits, then asserts that no email to the address arrived after `after`. */
export async function expectNoEmailTo(
  email: string,
  opts: { after?: Date; waitMs?: number } = {},
): Promise<void> {
  await sleep(opts.waitMs ?? 3_000);
  const found = await messagesTo(email, opts.after);
  if (found.length > 0)
    throw new Error(
      `Expected no email to ${email}, found: ${found.map((m) => m.Subject).join(', ')}`,
    );
}

async function fetchMessage(id: string): Promise<string> {
  const res = await fetch(`${MAILPIT}/api/v1/message/${id}`);
  if (!res.ok) throw new Error(`Mailpit message fetch failed: ${res.status}`);
  const body = (await res.json()) as { HTML?: string };
  return body.HTML ?? '';
}

function parse(html: string, subject: string): SignInEmail {
  const decoded = html.replaceAll('&amp;', '&');
  const code = /(?<!\d)(\d{6})(?!\d)/.exec(
    decoded.replace(/<a [^>]*>/g, ''),
  )?.[1];
  const link = /href="([^"]*\/auth\/confirm\?[^"]*)"/.exec(decoded)?.[1];
  const params = link ? new URL(link).searchParams : undefined;
  const type = params?.get('type');
  if (!code) throw new Error(`No 6-digit code in email "${subject}"`);
  if (type !== 'invite' && type !== 'email')
    throw new Error(`No invite or email link in email "${subject}"`);
  return { subject, code, tokenHash: params?.get('token_hash') ?? '', type };
}
