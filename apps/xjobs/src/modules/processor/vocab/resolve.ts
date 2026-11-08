import { ExtractionInvalidError } from '../models/errors';
import type { ExtractionDocument, Term } from '../schema';
import type { ListName } from './lists';

export interface VocabSnapshot {
  /** Per list: lower-case code, label and each alias, mapped to the code. */
  approved: Record<ListName, Map<string, string>>;
}

export interface TermResolution {
  doc: ExtractionDocument;
  proposals: { list: ListName; text: string }[];
  cities: { name: string; countryCode: string }[];
}

/** The proposed code for a new term: lower-case, diacritics stripped, `_` between words. */
export function slugCode(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/#/g, 'sharp')
    .replace(/\+/g, 'plus')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function resolveTerms(
  input: ExtractionDocument,
  vocab: VocabSnapshot,
): TermResolution {
  const doc = structuredClone(input);
  const proposals: TermResolution['proposals'] = [];
  const cities: TermResolution['cities'] = [];
  const seenCities = new Set<string>();
  const proposedTerms = new Set<string>();

  const requireCode = (list: ListName, code: string, path: string): void => {
    if (vocab.approved[list].get(code.toLowerCase()) !== code) {
      throw new ExtractionInvalidError(
        path,
        `"${code}" is not an approved ${list} code`,
      );
    }
  };

  const resolveTerm = (term: Term, at: string): void => {
    const map = vocab.approved.techTags;
    if (term.code !== null && map.get(term.code.toLowerCase()) === term.code) {
      return;
    }
    const keys = [term.text, term.code].filter((k): k is string => k !== null);
    for (const key of keys) {
      const hit = map.get(key.trim().toLowerCase());
      if (hit !== undefined) {
        term.code = hit;
        return;
      }
    }
    term.code = null;
    doc.unmatched.push({ list: 'techTags', text: term.text, at });
    const proposed = term.text.trim().toLowerCase();
    if (!proposedTerms.has(proposed)) {
      proposedTerms.add(proposed);
      proposals.push({ list: 'techTags', text: term.text });
    }
  };

  const choice = (list: ListName, value: string | null, path: string): void => {
    if (value !== null) requireCode(list, value, path);
  };
  choice('seniorities', doc.seniority.value, 'seniority.value');
  choice('arrangements', doc.arrangement.value, 'arrangement.value');
  choice(
    'roleKinds',
    doc.position.value?.roleKind ?? null,
    'position.value.roleKind',
  );
  choice('contractTypes', doc.contractType.value, 'contractType.value');
  choice('engagements', doc.engagement.value, 'engagement.value');
  (doc.junkFlags.value ?? []).forEach((f, i) =>
    requireCode('junkFlags', f.code, `junkFlags.value.${i}.code`),
  );

  doc.openings.forEach((opening, i) => {
    opening.arrangements.forEach((a, j) =>
      requireCode('arrangements', a, `openings.${i}.arrangements.${j}`),
    );
    opening.places.forEach((place, j) => {
      const path = `openings.${i}.places.${j}`;
      if (place.kind === 'region')
        requireCode('regions', place.code, `${path}.code`);
      else if (place.kind === 'country')
        requireCode('countries', place.code, `${path}.code`);
      else if (place.kind === 'city') {
        if (place.countryCode === null) {
          doc.unmatched.push({ list: 'cities', text: place.name, at: path });
          return;
        }
        requireCode('countries', place.countryCode, `${path}.countryCode`);
        const id = `${place.name.toLowerCase()}|${place.countryCode}`;
        if (!seenCities.has(id)) {
          seenCities.add(id);
          cities.push({ name: place.name, countryCode: place.countryCode });
        }
      }
    });
  });

  (doc.techStack.value?.requirements ?? []).forEach((r, i) =>
    resolveTerm(r.technology, `techStack.requirements.${i}.technology`),
  );

  return { doc, proposals, cities };
}
