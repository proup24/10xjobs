import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GOLDEN_CASES_DIR, loadGolden } from './golden';

const CASES_DIR = GOLDEN_CASES_DIR;
const files = readdirSync(CASES_DIR).filter((f) => f.endsWith('.json'));
const cases = loadGolden();
const text = JSON.stringify(cases);

describe('golden set', () => {
  it('parses every case file', () => {
    expect(files.length).toBeGreaterThanOrEqual(60);
    expect(cases).toHaveLength(files.length);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  });

  it('keeps only the LinkedIn text', () => {
    for (const c of cases) {
      expect(c.input.description).not.toContain('## Company page');
      expect(c.input.description).not.toContain('## LinkedIn post');
    }
  });

  it('has no private or third-party data', () => {
    for (const bad of ['Morocco', 'Souhail']) expect(text).not.toContain(bad);
    // career-hub's `criteria` field; the word itself appears in public postings
    expect(text).not.toContain('"criteria"');
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+(\.[\w-]+)+/);
    for (const key of ['roleMatch', 'contactPerson', 'contactEmail', 'covers'])
      expect(text).not.toContain(`"${key}"`);
    expect(text).not.toContain('"greenhouse"');
    // career-hub's `expected` held the owner's verdict; ours holds facts only
    for (const c of cases)
      expect(Object.keys(c.expected)).not.toContain('verdict');
    expect(text).not.toContain('checkIds');
  });

  it('carries no reviewed drafted values until a human reviews them', () => {
    for (const c of cases)
      for (const d of Object.values(c.drafted))
        expect(typeof d.reviewed).toBe('boolean');
  });
});
