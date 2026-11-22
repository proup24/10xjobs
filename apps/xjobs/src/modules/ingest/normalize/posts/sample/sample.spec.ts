import { mapLinkedinPost } from '../../mappers/linkedin-post.mapper';
import { DROP_RULES, type RuleInput } from '../rules';
import sample from './sample.json';

/**
 * The gate for drop rules: 150 real posts, labelled. A rule ships only if it
 * drops no post labelled `hiring` or `unsure` (`unsure` counts as hiring).
 */
type Label = 'hiring' | 'not_hiring' | 'unsure';
type Entry = {
  rawItemId: string;
  payload: Record<string, unknown>;
  label: Label;
  note?: string;
};
const entries = sample as Entry[];

// Records what the real mapper hands the rules, so each rule is judged on
// exactly what production sees (a share's original, never the sharer).
const seen = vi.hoisted(() => ({ input: null as RuleInput | null }));
vi.mock('../rules', async (importOriginal) => {
  const real = await importOriginal<typeof import('../rules')>();
  return {
    ...real,
    firstDrop: (input: RuleInput) => {
      seen.input = input;
      return real.firstDrop(input);
    },
  };
});

const ctx = { scrapedAt: new Date('2026-11-21T00:00:00.000Z') };

/** The rule input for each entry, or null when the mapper never reaches the rules. */
const inputs = entries.map((e) => {
  seen.input = null;
  mapLinkedinPost(e.payload, ctx);
  return seen.input as RuleInput | null;
});

describe('the labelled post sample', () => {
  it('holds 150 posts with unique ids and known labels', () => {
    expect(entries).toHaveLength(150);
    expect(new Set(entries.map((e) => e.rawItemId)).size).toBe(150);
    for (const e of entries)
      expect(['hiring', 'not_hiring', 'unsure']).toContain(e.label);
  });

  it('reaches the rules for every post', () => {
    const missed = entries
      .map((e, i) => (inputs[i] ? null : `#${i} ${e.rawItemId}`))
      .filter((m) => m !== null);
    expect(missed).toEqual([]);
  });

  describe.each(DROP_RULES.map((r) => [r.name, r] as const))(
    'rule %s',
    (name, rule) => {
      const drops = entries.flatMap((e, i) => {
        const input = inputs[i];
        const match = input ? rule.match(input) : null;
        return match === null ? [] : [{ i, e, match }];
      });
      const notHiring = drops.filter((d) => d.e.label === 'not_hiring');

      it(`drops no hiring or unsure post (drops ${notHiring.length} not_hiring)`, () => {
        console.info(
          `rule ${name}: drops ${notHiring.length} not_hiring post(s): ` +
            notHiring.map((d) => `#${d.i}`).join(' '),
        );
        const wrong = drops
          .filter((d) => d.e.label !== 'not_hiring')
          .map(
            (d) =>
              `#${d.i} ${d.e.rawItemId} (${d.e.label}) ${name}: "${d.match.slice(0, 80)}"`,
          );
        expect(wrong).toEqual([]);
      });
    },
  );
});
