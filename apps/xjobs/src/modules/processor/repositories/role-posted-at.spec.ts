import { roleJobPostedAt } from './role-posted-at';

const parent = new Date('2026-11-25T00:00:00.000Z');
const at = (iso: string) => new Date(iso);

describe('roleJobPostedAt', () => {
  it("takes a share's original date", () => {
    const s = {
      sources: [
        {
          postedAt: '2026-11-20T10:00:00.000Z',
          original: { postedAt: '2026-10-01T09:00:00.000Z' },
        },
      ],
    };
    expect(roleJobPostedAt(s, parent)).toEqual(at('2026-10-01T09:00:00.000Z'));
  });

  it('takes the earliest of several sources', () => {
    const s = {
      sources: [
        { postedAt: '2026-11-10T00:00:00.000Z' },
        { postedAt: '2026-11-02T00:00:00.000Z' },
        { postedAt: '2026-11-15T00:00:00.000Z' },
      ],
    };
    expect(roleJobPostedAt(s, parent)).toEqual(at('2026-11-02T00:00:00.000Z'));
  });

  it("does not let a share's original hide an older plain source", () => {
    const s = {
      sources: [
        {
          postedAt: '2026-11-20T00:00:00.000Z',
          original: { postedAt: '2026-11-05T00:00:00.000Z' },
        },
        { postedAt: '2026-10-15T00:00:00.000Z' },
      ],
    };
    expect(roleJobPostedAt(s, parent)).toEqual(at('2026-10-15T00:00:00.000Z'));
  });

  it("uses the source's own date when its original has none", () => {
    const s = {
      sources: [
        { postedAt: '2026-11-20T00:00:00.000Z', original: { postedAt: null } },
        { postedAt: '2026-11-22T00:00:00.000Z', original: null },
      ],
    };
    expect(roleJobPostedAt(s, parent)).toEqual(at('2026-11-20T00:00:00.000Z'));
  });

  it('ignores invalid and non-string dates', () => {
    const s = {
      sources: [
        { postedAt: 'not a date', original: { postedAt: 5 } },
        { postedAt: null },
        42,
        { postedAt: '2026-11-18T00:00:00.000Z' },
      ],
    };
    expect(roleJobPostedAt(s, parent)).toEqual(at('2026-11-18T00:00:00.000Z'));
  });

  it.each([null, undefined, {}, { sources: [] }, { sources: 'x' }, 'x'])(
    'falls back to the parent date for %j',
    (s) => {
      expect(roleJobPostedAt(s, parent)).toBe(parent);
    },
  );

  it('falls back to a null parent date', () => {
    expect(roleJobPostedAt({ sources: [] }, null)).toBeNull();
  });
});
