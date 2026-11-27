import { Logger } from '@nestjs/common';
import type { PayloadInput } from '../payload/build';
import {
  MemoryWebhooksRepository,
  type MemoryDelivery,
} from '../repositories/testing/memory-webhooks.repository';
import type { SendInput, SendResult } from '../sender/send';
import { DeliveryService } from './delivery.service';

const t0 = new Date('2026-11-16T10:00:00Z');
const USER = 'u1';
const WEBHOOK = 'w1';

function input(jobId = 'j1'): PayloadInput {
  return {
    profile: { id: 'p1', position: 'backend_engineer' },
    match: {
      id: `m-${jobId}`,
      checks: [],
      unverified: false,
      stackScore: 0.5,
      trigger: 'decision',
    },
    job: {
      id: jobId,
      kind: 'job',
      title: 'Backend Engineer',
      companyName: 'Acme',
      companyUrl: null,
      postingUrl: 'https://example.com/job',
      applyUrl: null,
      postedAt: null,
      firstSeenAt: t0,
      descriptionText: 'Text',
    },
    facts: null,
    post: null,
  };
}

/** A memory repo with one enabled webhook, a fake sender answering `status`, and a movable clock. */
function setup(status: number | null = 200) {
  const repo = new MemoryWebhooksRepository();
  repo.addWebhook({
    id: WEBHOOK,
    userId: USER,
    url: 'https://hooks.example.com/path/secret-token?key=abc',
    secret: 's3cret',
  });
  const clock = { now: new Date(t0) };
  const sent: SendInput[] = [];
  const reply = { status };
  const sender = vi.fn(async (i: SendInput): Promise<SendResult> => {
    sent.push(i);
    const s = reply.status;
    return s !== null && s >= 200 && s < 300
      ? { ok: true, status: s }
      : { ok: false, status: s, error: s === null ? 'timeout' : `http ${s}` };
  });
  const service = new DeliveryService(
    repo,
    { webAppUrl: 'https://app.example.com' },
    sender,
    () => new Date(clock.now),
  );
  let seq = 0;
  /** A pending match delivery, created `seq` ms after t0 so creation order is fixed. */
  const add = (over: Partial<MemoryDelivery> = {}): string => {
    seq += 1;
    const id = over.id ?? `d${seq}`;
    repo.addDelivery({
      id,
      userId: USER,
      webhookId: WEBHOOK,
      kind: 'match',
      createdAt: new Date(t0.getTime() - 1000 + seq),
      ...over,
    });
    if ((over.kind ?? 'match') === 'match') repo.inputs.set(id, input(id));
    return id;
  };
  const advance = (ms: number) => {
    clock.now = new Date(clock.now.getTime() + ms);
  };
  const deliver = async (id: string) => (await service.deliver(id)).result;
  const webhook = () => repo.webhooks.get(WEBHOOK)!;
  const row = (id: string) => repo.deliveries.get(id)!;
  return {
    repo,
    service,
    deliver,
    sender,
    sent,
    reply,
    add,
    advance,
    clock,
    webhook,
    row,
  };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('DeliveryService', () => {
  it('a 2xx marks delivered and resets failures', async () => {
    const s = setup(200);
    const id = s.add();
    s.webhook().consecutiveFailures = 3;
    expect(await s.deliver(id)).toBe('delivered');
    expect(s.row(id)).toMatchObject({
      status: 'delivered',
      attempts: 1,
      lastStatusCode: 200,
      deliveredAt: t0,
    });
    expect(s.webhook()).toMatchObject({
      consecutiveFailures: 0,
      lastSuccessAt: t0,
    });
    expect(s.sent[0]).toMatchObject({
      url: 'https://hooks.example.com/path/secret-token?key=abc',
      secret: 's3cret',
      deliveryId: id,
      event: 'match.qualified',
    });
  });

  it('a 503 schedules the next attempt after 60 000 ms, then 300 000 ms', async () => {
    const s = setup(503);
    const id = s.add();
    expect(await s.deliver(id)).toBe('retry');
    expect(s.row(id)).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastStatusCode: 503,
      lastError: 'http 503',
      nextAttemptAt: new Date(t0.getTime() + 60_000),
    });
    expect(s.webhook()).toMatchObject({
      consecutiveFailures: 1,
      lastFailureAt: t0,
    });

    // Not due yet: nothing is sent.
    s.advance(59_999);
    expect(await s.deliver(id)).toBe('gone');
    expect(s.sender).toHaveBeenCalledTimes(1);

    s.advance(1);
    const at = s.clock.now.getTime();
    expect(await s.deliver(id)).toBe('retry');
    expect(s.row(id).nextAttemptAt).toEqual(new Date(at + 300_000));
    expect(s.row(id).attempts).toBe(2);
  });

  it('the 7th failure marks failed', async () => {
    const s = setup(503);
    const id = s.add();
    const delays = [
      60_000, 300_000, 1_800_000, 7_200_000, 21_600_000, 43_200_000,
    ];
    for (const delay of delays) {
      expect(await s.deliver(id)).toBe('retry');
      s.advance(delay);
    }
    expect(await s.deliver(id)).toBe('failed');
    expect(s.row(id)).toMatchObject({ status: 'failed', attempts: 7 });
    expect(s.sender).toHaveBeenCalledTimes(7);
    s.advance(86_400_000);
    expect(await s.deliver(id)).toBe('gone');
    expect(s.sender).toHaveBeenCalledTimes(7);
  });

  it('the 10th consecutive failure disables the webhook with failing', async () => {
    const s = setup(503);
    s.webhook().consecutiveFailures = 8;
    const id = s.add();
    await s.deliver(id);
    expect(s.webhook()).toMatchObject({
      enabled: true,
      consecutiveFailures: 9,
    });
    s.advance(300_000);
    await s.deliver(id);
    expect(s.webhook()).toMatchObject({
      enabled: false,
      disabledReason: 'failing',
      consecutiveFailures: 10,
    });
  });

  it("a disabled webhook's row is skipped", async () => {
    const s = setup(200);
    const id = s.add();
    s.webhook().enabled = false;
    s.webhook().disabledReason = 'user';
    expect(await s.deliver(id)).toBe('skipped');
    expect(s.row(id).status).toBe('skipped');
    expect(s.sender).not.toHaveBeenCalled();
  });

  it('a match delivery whose match was deleted is skipped quietly', async () => {
    const s = setup(200);
    const id = s.add();
    s.repo.inputs.delete(id);
    expect(await s.deliver(id)).toBe('skipped');
    expect(s.row(id).status).toBe('skipped');
    expect(s.sender).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('a decision delivery whose match is no longer qualified is skipped with a reason', async () => {
    const s = setup(200);
    const id = s.add();
    s.repo.outcomes.set(id, 'rejected');
    expect(await s.deliver(id)).toBe('skipped');
    expect(s.row(id)).toMatchObject({
      status: 'skipped',
      lastError: 'match no longer qualified',
      payload: null,
    });
    expect(s.sender).not.toHaveBeenCalled();
  });

  it('a review delivery is sent whatever the match outcome', async () => {
    const s = setup(200);
    const id = s.add();
    const review = input(id);
    review.match.trigger = 'review';
    s.repo.inputs.set(id, review);
    s.repo.outcomes.set(id, 'review');
    expect(await s.deliver(id)).toBe('delivered');
  });

  it('A merges into B with no delivery for B: the stand-in sends B', async () => {
    const s = setup(200);
    const a = s.add({ profileId: 'p1', jobId: 'jA', matchId: null });
    s.repo.inputs.set(a, input('jB'));
    s.repo.roots.set('jA', 'jB');
    expect(await s.deliver(a)).toBe('delivered');
    expect(JSON.parse(s.sent[0].body)).toMatchObject({ job: { id: 'jB' } });
  });

  it("B has its own delivery, A merges into B: A's pending row is skipped and only B's is sent", async () => {
    const s = setup(200);
    const a = s.add({ profileId: 'p1', jobId: 'jA', matchId: null });
    s.repo.inputs.set(a, input('jB'));
    const b = s.add({ profileId: 'p1', jobId: 'jB', matchId: 'm-jB' });
    s.repo.inputs.set(b, input('jB'));
    s.repo.roots.set('jA', 'jB');
    expect(await s.deliver(a)).toBe('skipped');
    expect(s.row(a).lastError).toBe('match deleted');
    expect(await s.deliver(b)).toBe('delivered');
    expect(s.sent.map((x) => x.deliveryId)).toEqual([b]);
  });

  it('a delivery that no longer exists is gone', async () => {
    const s = setup(200);
    expect(await s.deliver('missing')).toBe('gone');
    expect(s.sender).not.toHaveBeenCalled();
  });

  it('hold-back: with failures > 0 only the oldest pending row is attempted; a burst of 10 pending during an outage disables only after 10 head attempts', async () => {
    const s = setup(503);
    const ids = Array.from({ length: 10 }, () => s.add());

    // The head fails once; every other row is held without a send.
    expect(await s.deliver(ids[0])).toBe('retry');
    for (const id of ids.slice(1)) expect(await s.deliver(id)).toBe('held');
    expect(s.sender).toHaveBeenCalledTimes(1);
    expect(s.row(ids[1]).attempts).toBe(0);

    // The sweep sees only the head while failing, then everything once the webhook is off.
    for (let tick = 0; tick < 40; tick++) {
      s.advance(43_200_000);
      for (const id of await s.repo.listDue(s.clock.now, 200))
        await s.deliver(id);
    }
    expect(s.sender).toHaveBeenCalledTimes(10);
    expect(s.webhook()).toMatchObject({
      enabled: false,
      disabledReason: 'failing',
      consecutiveFailures: 10,
    });
    expect(s.row(ids[0])).toMatchObject({ status: 'failed', attempts: 7 });
    expect(s.row(ids[1])).toMatchObject({ status: 'skipped', attempts: 3 });
    for (const id of ids.slice(2))
      expect(s.row(id)).toMatchObject({ status: 'skipped', attempts: 0 });
  });

  it('a 2xx after failures releases the rest oldest first', async () => {
    const s = setup(503);
    const [a, b, c] = [s.add(), s.add(), s.add()];
    await s.deliver(a);
    // A row scheduled later is pulled forward by the release.
    s.row(c).nextAttemptAt = new Date(t0.getTime() + 3_600_000);
    s.advance(60_000);
    expect(await s.repo.listDue(s.clock.now, 200)).toEqual([a]);

    s.reply.status = 204;
    expect(await s.deliver(a)).toBe('delivered');
    expect(s.row(c).nextAttemptAt).toEqual(s.clock.now);
    // One head per webhook: b, then c once b is done.
    expect(await s.repo.listDue(s.clock.now, 200)).toEqual([b]);
    expect(await s.repo.nextDue(WEBHOOK, s.clock.now)).toBe(b);
    expect(await s.deliver(b)).toBe('delivered');
    expect(await s.repo.nextDue(WEBHOOK, s.clock.now)).toBe(c);
    expect(await s.deliver(c)).toBe('delivered');
    expect(await s.repo.nextDue(WEBHOOK, s.clock.now)).toBeNull();
  });

  it('a URL change releases hold-back', async () => {
    const s = setup(503);
    const [a, b] = [s.add(), s.add()];
    await s.deliver(a);
    expect(await s.deliver(b)).toBe('held');

    // What webhook_save does on a new URL.
    s.webhook().url = 'https://new.example.com/hook';
    s.webhook().consecutiveFailures = 0;
    s.reply.status = 200;
    expect(await s.repo.listDue(s.clock.now, 200)).toEqual([b]);
    expect(await s.deliver(b)).toBe('delivered');
    expect(s.sent.at(-1)?.url).toBe('https://new.example.com/hook');
  });

  it('the payload is built once and retries send identical bytes', async () => {
    const s = setup(503);
    const id = s.add();
    const load = vi.spyOn(s.repo, 'loadPayloadInput');
    await s.deliver(id);
    s.advance(60_000);
    s.reply.status = 200;
    await s.deliver(id);
    expect(load).toHaveBeenCalledTimes(1);
    expect(s.sent).toHaveLength(2);
    expect(s.sent[1].body).toBe(s.sent[0].body);
    expect(JSON.parse(s.sent[0].body)).toMatchObject({
      event: 'match.qualified',
      deliveryId: id,
      job: { id },
      links: { match: `https://app.example.com/?job=${id}` },
    });
    expect(s.row(id).payload).toEqual(JSON.parse(s.sent[0].body));
  });

  it('a test row uses buildTestPayload', async () => {
    const s = setup(200);
    s.repo.samples.set(USER, input('sample-job'));
    const id = s.add({ kind: 'test' });
    expect(await s.deliver(id)).toBe('delivered');
    expect(s.sent[0].event).toBe('test');
    expect(JSON.parse(s.sent[0].body)).toMatchObject({
      event: 'test',
      deliveryId: id,
      job: { id: 'sample-job' },
    });
  });

  it('a test row is not held back by a failing webhook', async () => {
    const s = setup(503);
    const [a, b] = [s.add(), s.add()];
    await s.deliver(a);
    expect(await s.deliver(b)).toBe('held');
    const test = s.add({ kind: 'test' });
    expect(await s.repo.listDue(s.clock.now, 200)).toEqual([test]);
    expect(await s.repo.nextDue(WEBHOOK, s.clock.now)).toBe(test);
    s.reply.status = 200;
    expect(await s.deliver(test)).toBe('delivered');
    // The 2xx proves nothing about match order: the counter and the held rows stay.
    expect(s.webhook()).toMatchObject({ consecutiveFailures: 1 });
    expect(await s.deliver(b)).toBe('held');
    expect(s.row(a).nextAttemptAt).toEqual(new Date(t0.getTime() + 60_000));
  });

  it('a failing test leaves the failure counter alone', async () => {
    const s = setup(503);
    s.webhook().consecutiveFailures = 9;
    const test = s.add({ kind: 'test' });
    expect(await s.deliver(test)).toBe('retry');
    expect(s.webhook()).toMatchObject({
      enabled: true,
      consecutiveFailures: 9,
      lastFailureAt: null,
    });
    expect(s.row(test)).toMatchObject({ status: 'pending', attempts: 1 });
  });

  it('logs the host of a failed send, never the path, query or secret', async () => {
    const s = setup(503);
    const id = s.add();
    await s.deliver(id);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain('hooks.example.com');
    expect(message).not.toMatch(/secret-token|key=abc|s3cret|\/path/);
  });
  it('returns the webhook id after a send or a skip, so the next row can go', async () => {
    const s = setup(200);
    const [a, b] = [s.add(), s.add()];
    expect(await s.service.deliver(a)).toEqual({
      result: 'delivered',
      webhookId: WEBHOOK,
    });
    s.webhook().enabled = false;
    expect(await s.service.deliver(b)).toEqual({
      result: 'skipped',
      webhookId: WEBHOOK,
    });
    expect(await s.service.deliver('missing')).toEqual({
      result: 'gone',
      webhookId: null,
    });
  });

  it('busy and held return no webhook id', async () => {
    const s = setup(503);
    const [a, b] = [s.add(), s.add()];
    await s.deliver(a);
    expect(await s.service.deliver(b)).toEqual({
      result: 'held',
      webhookId: null,
    });
  });

  it('an engine error after the claim gives the attempt back and retries after 60 s', async () => {
    const s = setup(200);
    const id = s.add();
    vi.spyOn(s.repo, 'loadLabels').mockRejectedValueOnce(new Error('db down'));
    expect(await s.service.deliver(id)).toEqual({
      result: 'retry',
      webhookId: WEBHOOK,
    });
    expect(s.row(id)).toMatchObject({
      status: 'pending',
      attempts: 0,
      payload: null,
      nextAttemptAt: new Date(t0.getTime() + 60_000),
    });
    expect(s.webhook().consecutiveFailures).toBe(0);
    expect(s.sender).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain('hooks.example.com');
    expect(message).not.toMatch(/secret-token|key=abc|s3cret/);

    s.advance(60_000);
    expect(await s.deliver(id)).toBe('delivered');
    expect(s.row(id).attempts).toBe(1);
  });

  it('an error while giving the attempt back is swallowed too', async () => {
    const s = setup(200);
    const id = s.add();
    vi.spyOn(s.repo, 'savePayload').mockRejectedValueOnce(new Error('db down'));
    vi.spyOn(s.repo, 'release').mockRejectedValueOnce(new Error('db down'));
    expect((await s.service.deliver(id)).result).toBe('retry');
    // Left sending; recoverStuck returns it.
    expect(s.row(id).status).toBe('sending');
  });
});
