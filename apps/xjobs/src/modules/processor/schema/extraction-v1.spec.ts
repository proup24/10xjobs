import { describe, expect, it, vi } from 'vitest';
import { extractionDocumentV1Schema } from './extraction-v1';
import { fixtureDocumentV1 } from './fixture-v1.testing';

// The live lists change; the v1 schema reads rows written before they did.
vi.mock('../vocab/lists', () => ({ LIST_NAMES: ['renamedList'] }));

describe('extractionDocumentV1Schema', () => {
  it('reads the v1 list names, whatever the live lists are now', () => {
    const doc = fixtureDocumentV1();
    (doc.unmatched as unknown[]).push(
      { list: 'techTags', text: 'Elixir', at: 'techStack' },
      { list: 'cities', text: 'Gdańsk', at: 'openings' },
    );
    expect(extractionDocumentV1Schema.safeParse(doc).success).toBe(true);
  });

  it('rejects a list name v1 never had', () => {
    const doc = fixtureDocumentV1();
    (doc.unmatched as unknown[]).push({
      list: 'renamedList',
      text: 'x',
      at: 'a',
    });
    expect(extractionDocumentV1Schema.safeParse(doc).success).toBe(false);
  });
});
