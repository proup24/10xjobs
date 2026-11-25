import { createHmac, randomUUID } from 'node:crypto';
import axios from 'axios';
import { createDatabaseClient, type DatabaseClient } from '@xjobs/database';
import { isLocalUrl } from '@xjobs/database/env';
import {
  admin,
  createAuthUser,
  deleteAuthUser,
  setEligibility,
} from '../support/auth-users';
import { createDraftProfile } from '../support/profiles';

const url = process.env.DATABASE_URL;

/** The documented signature: v1= and the hex HMAC-SHA256 of `${timestamp}.${rawBody}`. */
const signature = (secret: string, ts: number, body: Buffer) =>
  `v1=${createHmac('sha256', secret).update(`${ts}.`).update(body).digest('hex')}`;

const call = (
  webhookId: string,
  secret: string,
  body: unknown,
  opts: { key?: boolean } = {},
) => {
  const raw = Buffer.from(JSON.stringify(body));
  const ts = Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-10xjobs-Webhook': webhookId,
    'X-10xjobs-Timestamp': String(ts),
    'X-10xjobs-Signature': signature(secret, ts, raw),
  };
  if (opts.key !== false)
    headers['X-Engine-Key'] = process.env.ENGINE_API_KEY ?? '';
  // fetch, not axios: the headers sent must be exactly the ones named here.
  return fetch(`${axios.defaults.baseURL}/api/webhooks/callback`, {
    method: 'POST',
    headers,
    body: raw,
  });
};

describe.skipIf(!url || !isLocalUrl(url))('POST /api/webhooks/callback', () => {
  let db: DatabaseClient;
  let user: { id: string };
  let webhookId: string;
  let jobId: string;
  let secret: string;

  beforeAll(async () => {
    db = createDatabaseClient({
      url: url as string,
      connectionTimeoutMs: 5000,
      idleTimeoutMs: 1000,
      slowQueryMs: 60_000,
      logQueries: false,
    });
    user = await createAuthUser('webhook-callback');
    await setEligibility(user.id);
    const profileId = await createDraftProfile(user.id);
    const sb = admin();

    jobId = randomUUID();
    const job = await sb.from('normalized_jobs').insert({
      id: jobId,
      jobKey: randomUUID(),
      kind: 'job',
      status: 'active',
      title: 'Backend Engineer',
      companyName: 'Acme',
      descriptionText: 'We build things.',
      postingUrl: `https://example.com/${randomUUID()}`,
      closed: false,
      fieldSources: {},
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      processingStatus: 'processed',
      processingRequestedAt: new Date().toISOString(),
      normalizerVersion: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    if (job.error) throw new Error(`job insert: ${job.error.message}`);

    const extractionId = randomUUID();
    const ex = await sb.from('job_extractions').insert({
      id: extractionId,
      jobId,
      inputHash: randomUUID(),
      schemaVersion: 1,
      promptHash: 'p',
      decisionModel: 'd',
      extractionModel: 'e',
      data: {},
      needsReview: false,
      worldwide: false,
      regionCodes: [],
      countryCodes: [],
      cityIds: [],
      techTags: [],
      mainStackTags: [],
      requiredTags: [],
      niceTags: [],
      costUsd: '0',
      createdAt: new Date().toISOString(),
    });
    if (ex.error) throw new Error(`extraction insert: ${ex.error.message}`);

    const m = await sb.from('job_matches').insert({
      id: randomUUID(),
      userId: user.id,
      profileId,
      jobId,
      extractionId,
      matcherVersion: 1,
      outcome: 'qualified',
      unverified: false,
      stackScore: 0.5,
      checks: [],
      decidedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    if (m.error) throw new Error(`match insert: ${m.error.message}`);

    webhookId = randomUUID();
    const w = await sb.from('webhooks').insert({
      id: webhookId,
      userId: user.id,
      url: 'https://hook.example.com/x',
      enabled: true,
    });
    if (w.error) throw new Error(`webhook insert: ${w.error.message}`);
    const read = await sb
      .from('webhooks')
      .select('secret')
      .eq('id', webhookId)
      .single();
    if (read.error) throw new Error(`webhook read: ${read.error.message}`);
    secret = read.data.secret as string;
  });

  afterAll(async () => {
    // Deleting the user cascades its webhook, matches and decisions.
    if (user) await deleteAuthUser(user.id);
    if (jobId) {
      const sb = admin();
      await sb.from('job_extractions').delete().eq('jobId', jobId);
      await sb.from('normalized_jobs').delete().eq('id', jobId);
    }
    await db?.close();
  });

  it('answers a signed ping with ok', async () => {
    const res = await call(webhookId, secret, { version: 1, type: 'ping' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ version: 1, result: 'ok' });
  });

  it('saves a signed applied feedback as a webhook decision', async () => {
    const res = await call(webhookId, secret, {
      version: 1,
      type: 'feedback',
      jobId,
      status: 'applied',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ result: 'saved', jobId });
    const { data, error } = await admin()
      .from('job_decisions')
      .select('status, source')
      .eq('userId', user.id)
      .eq('jobId', jobId)
      .single();
    expect(error).toBeNull();
    expect(data).toEqual({ status: 'applied', source: 'webhook' });
  });

  it('401s the same call without the engine key', async () => {
    const res = await call(
      webhookId,
      secret,
      { version: 1, type: 'ping' },
      { key: false },
    );
    expect(res.status).toBe(401);
  });
});
