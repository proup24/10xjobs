import { describe, expect, it, vi } from 'vitest';
import { saveRescue, undoRescue } from './rescue';

const JOB = '22222222-2222-4222-8222-222222222222';

function client(result: { data?: unknown; error: unknown }) {
  const rpc = vi.fn(async () => result);
  return { supabase: { rpc } as never, rpc };
}
const deps = { log: vi.fn() };

describe('saveRescue', () => {
  it('calls post_rescue with the job and the trimmed note', async () => {
    const { supabase, rpc } = client({ data: JOB, error: null });
    const result = await saveRescue(supabase, { jobId: JOB, note: ' fits ' });
    expect(result).toEqual({ status: 'saved' });
    expect(rpc).toHaveBeenCalledWith('post_rescue', {
      p_job_id: JOB,
      p_note: 'fits',
    });
  });

  it('sends no note when there is none', async () => {
    const { supabase, rpc } = client({ data: JOB, error: null });
    await saveRescue(supabase, { jobId: JOB, note: '  ' });
    expect(rpc).toHaveBeenCalledWith('post_rescue', {
      p_job_id: JOB,
      p_note: undefined,
    });
  });

  it('maps not rescuable to a form message', async () => {
    const { supabase } = client({
      error: { code: 'P0001', message: 'not rescuable' },
    });
    expect(await saveRescue(supabase, { jobId: JOB }, deps)).toEqual({
      status: 'invalid',
      errors: { _form: 'This post can no longer be rescued.' },
    });
  });

  it('refuses a bad id without calling the database', async () => {
    const { supabase, rpc } = client({ error: null });
    const result = await saveRescue(supabase, { jobId: 'nope' });
    expect(result.status).toBe('invalid');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('fails on another error', async () => {
    const { supabase } = client({ error: { code: '57014', message: 'boom' } });
    expect(await saveRescue(supabase, { jobId: JOB }, deps)).toEqual({
      status: 'failed',
    });
  });
});

describe('undoRescue', () => {
  it('calls post_rescue_undo with the job only', async () => {
    const { supabase, rpc } = client({ error: null });
    expect(await undoRescue(supabase, JOB)).toEqual({ status: 'saved' });
    expect(rpc).toHaveBeenCalledWith('post_rescue_undo', { p_job_id: JOB });
  });

  it('maps decided to a form message', async () => {
    const { supabase } = client({
      error: { code: 'P0001', message: 'decided' },
    });
    expect(await undoRescue(supabase, JOB, deps)).toEqual({
      status: 'invalid',
      errors: { _form: 'Undo the decision first.' },
    });
  });

  it('fails on a bad id', async () => {
    const { supabase } = client({ error: null });
    expect(await undoRescue(supabase, 'x')).toEqual({ status: 'failed' });
  });
});
