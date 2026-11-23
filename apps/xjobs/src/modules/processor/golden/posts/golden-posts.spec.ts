import { JUNK_REASONS, NOT_HIRING_REASONS } from '@xjobs/database/enums';
import { postDetailSchema } from '../../../ingest/normalize/record';
import sample from '../../../ingest/normalize/posts/sample/sample.json';
import { loadPostGolden } from './golden-posts';

const cases = loadPostGolden();

describe('the post golden set', () => {
  it('holds the 150 sample posts, in sample order', () => {
    expect(cases).toHaveLength(150);
    expect(cases.map((c) => c.rawItemId)).toEqual(
      sample.map((s) => s.rawItemId),
    );
  });

  it('rules the owner examples #11, #13 and #32 junk, reviewed', () => {
    for (const [i, reason] of [
      [11, 'no_clear_employer'],
      [13, 'messaging_group'],
      [32, 'many_roles_across_companies'],
    ] as const)
      expect(cases[i].verdict).toMatchObject({
        value: 'junk',
        reason,
        reviewed: true,
      });
  });

  it('never calls an owner-noted not-hiring post hiring', () => {
    for (const i of [16, 63, 81, 86, 106]) {
      expect(cases[i].verdict.value).not.toBe('hiring');
      expect(cases[i].verdict.reviewed).toBe(true);
    }
  });

  it('keeps every other sample verdict, or narrows a sample hiring to junk, with a reason that belongs to it', () => {
    cases.forEach((c, i) => {
      if (c.verdict.reviewed) return;
      // The pre-label applies the owner's junk signs, which slice 02's sample had no label for.
      expect(c.verdict.value).toBeOneOf(
        sample[i].label === 'hiring' ? ['hiring', 'junk'] : ['not_hiring'],
      );
      if (c.verdict.value === 'hiring') expect(c.verdict.reason).toBe('hiring');
      else
        expect(
          c.verdict.value === 'junk' ? JUNK_REASONS : NOT_HIRING_REASONS,
        ).toContain(c.verdict.reason);
    });
  });

  it('parses every case source with postDetailSchema', () => {
    for (const c of cases) {
      expect(c.sources.length).toBeGreaterThan(0);
      for (const s of c.sources)
        expect(() => postDetailSchema.parse(s)).not.toThrow();
    }
  });
});
