import { describe, expect, it, vi } from 'vitest';
import { REPORT_FIELDS, saveReport } from './report';

const JOB = '22222222-2222-4222-8222-222222222222';

type Rpc = { data: unknown; error: unknown };

/** A client whose match_details read returns `rpc` and whose fact_reports insert returns `insert`. */
function client(rpc: Rpc, insert: { error: unknown } = { error: null }) {
  const calls = { rpc: vi.fn(), insert: vi.fn(), tables: [] as string[] };
  const supabase = {
    rpc: async (name: string, args: unknown) => {
      calls.rpc(name, args);
      return rpc;
    },
    from: (table: string) => {
      calls.tables.push(table);
      return {
        insert: async (row: unknown) => {
          calls.insert(row);
          return insert;
        },
      };
    },
  } as never;
  return { supabase, calls };
}

const row = {
  jobId: JOB,
  facts: {
    seniority: {
      code: 'senior',
      label: 'Senior',
      source: 'description',
      quote: 'We want a senior engineer',
    },
    contractType: null,
  },
  conflicts: [
    { field: 'seniority', listingValue: 'mid', descriptionValue: 'senior' },
    { field: 'salary', listingValue: { min: 1 } },
  ],
};

describe('saveReport', () => {
  it('saveReport inserts the processor and LinkedIn values from the row', async () => {
    const { supabase, calls } = client({ data: [row], error: null });
    const result = await saveReport(supabase, 'user-1', {
      jobId: JOB,
      field: 'seniority',
      proposedValue: 'Mid-level',
      note: 'The post says mid',
      processorValue: 'forged',
    });
    expect(result).toEqual({ status: 'saved' });
    expect(calls.insert).toHaveBeenCalledWith({
      userId: 'user-1',
      jobId: JOB,
      field: 'seniority',
      processorValue: row.facts.seniority,
      quote: 'We want a senior engineer',
      listingValue: 'mid',
      extractionId: null,
      proposedValue: 'Mid-level',
      note: 'The post says mid',
    });
  });

  it('stores nulls for a fact with no value, quote or conflict', async () => {
    const { supabase, calls } = client({ data: [row], error: null });
    await saveReport(supabase, 'user-1', {
      jobId: JOB,
      field: 'contractType',
      proposedValue: 'Contractor',
    });
    expect(calls.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        processorValue: null,
        quote: null,
        listingValue: null,
        note: null,
      }),
    );
  });

  it('saveReport refuses an empty proposed value', async () => {
    const { supabase, calls } = client({ data: [row], error: null });
    const result = await saveReport(supabase, 'user-1', {
      jobId: JOB,
      field: 'seniority',
      proposedValue: '   ',
    });
    expect(result.status).toBe('invalid');
    expect(calls.insert).not.toHaveBeenCalled();
    expect(calls.rpc).not.toHaveBeenCalled();
  });

  it('refuses a field that is not reportable', async () => {
    const { supabase } = client({ data: [row], error: null });
    const result = await saveReport(supabase, 'user-1', {
      jobId: JOB,
      field: 'title',
      proposedValue: 'x',
    });
    expect(result.status).toBe('invalid');
    expect(REPORT_FIELDS).toContain('techStack');
  });

  it('is invalid when the user has no match row on the job', async () => {
    const { supabase, calls } = client({ data: [], error: null });
    const result = await saveReport(supabase, 'user-1', {
      jobId: JOB,
      field: 'seniority',
      proposedValue: 'Mid',
    });
    expect(result).toEqual({
      status: 'invalid',
      errors: { _form: 'This job is no longer in your matches.' },
    });
    expect(calls.insert).not.toHaveBeenCalled();
  });

  it('logs the code only and fails on a read error', async () => {
    const log = vi.fn();
    const { supabase } = client({
      data: null,
      error: { code: 'XX000', message: 'secret detail' },
    });
    const result = await saveReport(
      supabase,
      'user-1',
      { jobId: JOB, field: 'seniority', proposedValue: 'Mid' },
      { log },
    );
    expect(result).toEqual({ status: 'failed' });
    expect(log.mock.calls.join()).not.toContain('secret detail');
  });

  it('fails on an insert error', async () => {
    const { supabase } = client(
      { data: [row], error: null },
      { error: { code: '42501', message: 'rls' } },
    );
    const result = await saveReport(supabase, 'user-1', {
      jobId: JOB,
      field: 'seniority',
      proposedValue: 'Mid',
    });
    expect(result).toEqual({ status: 'failed' });
  });
});
