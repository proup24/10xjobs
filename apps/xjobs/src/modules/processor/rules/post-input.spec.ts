import { describe, expect, it } from 'vitest';
import { postDetailSchema } from '../../ingest/normalize/record';
import type { JobForProcessing } from '../models/types';
import { inputHash } from './input';
import { buildPostInput } from './post-input';
import {
  plainOriginal,
  postDetail,
  secondShare,
  shareWithEmail,
} from './post-input.testing';

function job(sources: JobForProcessing['postSources']): JobForProcessing {
  return {
    id: 'j1',
    closed: false,
    title: null,
    descriptionText: null,
    kind: 'post',
    postSources: sources,
  };
}

describe('post input fixtures', () => {
  it('parse with postDetailSchema', () => {
    for (const f of [plainOriginal, shareWithEmail, secondShare])
      expect(postDetailSchema.safeParse(f).success).toBe(true);
  });
});

describe('buildPostInput', () => {
  it('renders a plain original as one section with its links', () => {
    const { input, links } = buildPostInput(job([plainOriginal]));
    expect(input.title).toBeNull();
    expect(input.jobId).toBe('j1');
    expect(input.description).toBe(
      [
        'Original post by Dana Recruiter (Talent at Acme, person), posted 2026-11-10:',
        plainOriginal.text,
        '',
        'Links in the post:',
        'https://www.linkedin.com/jobs/view/4111111111',
        'https://boards.greenhouse.io/acme/jobs/1',
      ].join('\n'),
    );
    expect(input.description).not.toContain('Shared by');
    expect(input.truncated).toBe(false);
    expect(links).toEqual({
      emails: [],
      linkedinJobIds: ['4111111111'],
      urls: ['https://boards.greenhouse.io/acme/jobs/1'],
    });
  });

  it("renders a share's added text and lists its email", () => {
    const { input, links } = buildPostInput(job([shareWithEmail]));
    expect(input.description).toContain(
      'Original post by Dana Recruiter (Talent at Acme, person), posted 2026-11-10:\nAcme is hiring',
    );
    expect(input.description).toContain(
      'Shared by Sam Sharer (Engineering Manager) with this added text:\nDM me or email jobs@acme.com',
    );
    expect(input.description).toContain('Links in the post:\njobs@acme.com');
    expect(links.emails).toEqual(['jobs@acme.com']);
  });

  it('renders a shared original once and de-duplicates emails', () => {
    const { input, links } = buildPostInput(job([secondShare, shareWithEmail]));
    expect(input.description.match(/Original post by/g)).toHaveLength(1);
    expect(input.description.match(/Shared by/g)).toHaveLength(2);
    expect(links.emails).toEqual(['jobs@acme.com']);
  });

  it('gives the same input hash for sources in another order', () => {
    const a = buildPostInput(job([shareWithEmail, secondShare])).input;
    const b = buildPostInput(job([secondShare, shareWithEmail])).input;
    expect(a.description).toBe(b.description);
    expect(inputHash(a)).toBe(inputHash(b));
  });

  it('notes a truncated original and sets truncated', () => {
    const { input } = buildPostInput(
      job([postDetail({ id: 'cut', truncated: true })]),
    );
    expect(input.description).toContain(
      'Acme is hiring a Senior Backend Engineer. Remote in Europe.\nNote: this text was cut at "see more".',
    );
    expect(input.truncated).toBe(true);
  });

  it('cuts an over-cap original and keeps the full links block', () => {
    const long = Array.from({ length: 40 }, () => 'a'.repeat(998)).join('\n\n');
    const { input } = buildPostInput(job([{ ...plainOriginal, text: long }]));
    expect(input.truncated).toBe(true);
    expect(Buffer.byteLength(input.description)).toBeLessThanOrEqual(30_000);
    expect(input.description).toContain(
      'a\nNote: this text was cut for length.\n\nLinks in the post:',
    );
    expect(
      input.description.endsWith(
        [
          'Links in the post:',
          'https://www.linkedin.com/jobs/view/4111111111',
          'https://boards.greenhouse.io/acme/jobs/1',
        ].join('\n'),
      ),
    ).toBe(true);
  });

  it("cuts the original first so a share's added text survives the cap", () => {
    const long = 'b'.repeat(40_000);
    const share = {
      ...shareWithEmail,
      original: { ...shareWithEmail.original!, text: long },
    };
    const { input, links } = buildPostInput(job([share]));
    expect(input.truncated).toBe(true);
    expect(Buffer.byteLength(input.description)).toBeLessThanOrEqual(30_000);
    expect(input.description).toContain(
      'Shared by Sam Sharer (Engineering Manager) with this added text:\nDM me or email jobs@acme.com',
    );
    expect(
      input.description.endsWith('Links in the post:\njobs@acme.com'),
    ).toBe(true);
    expect(links.emails).toEqual(['jobs@acme.com']);
  });

  it('renders the same links block with and without the cap', () => {
    const block = (d: string) => d.slice(d.indexOf('\n\nLinks in the post:'));
    const short = buildPostInput(job([shareWithEmail, secondShare])).input;
    const longOriginal = {
      ...shareWithEmail.original!,
      text: 'c'.repeat(40_000),
    };
    const long = buildPostInput(
      job([
        { ...shareWithEmail, original: longOriginal },
        { ...secondShare, original: longOriginal },
      ]),
    ).input;
    expect(short.truncated).toBe(false);
    expect(long.truncated).toBe(true);
    expect(block(long.description)).toBe(block(short.description));
  });

  it('cuts the last share next when the added texts alone are over the cap', () => {
    const { input } = buildPostInput(
      job([shareWithEmail, { ...secondShare, text: 'd'.repeat(40_000) }]),
    );
    expect(input.truncated).toBe(true);
    expect(Buffer.byteLength(input.description)).toBeLessThanOrEqual(30_000);
    expect(input.description).toContain(
      'Original post by Dana Recruiter (Talent at Acme, person), posted 2026-11-10:\nNote: this text was cut for length.',
    );
    expect(input.description).toContain('DM me or email jobs@acme.com');
    expect(input.description).toContain(
      'd\nNote: this text was cut for length.\n\nLinks in the post:\njobs@acme.com',
    );
  });

  it('renders the lowest-id source original when sources disagree', () => {
    const other = postDetail({
      id: 'zzz',
      text: 'Something else entirely.',
      links: {
        emails: ['x@y.com'],
        linkedinJobIds: [],
        atsPostings: [],
        other: [],
      },
    });
    const { input, links } = buildPostInput(job([other, plainOriginal]));
    expect(input.description).toContain('Acme is hiring');
    expect(input.description).not.toContain('Something else');
    expect(links.emails).toEqual([]);
  });
});
