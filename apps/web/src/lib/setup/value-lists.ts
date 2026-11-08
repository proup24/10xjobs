import type { SupabaseClient } from '@supabase/supabase-js';
import { isSearchableTech, Seniority } from '@xjobs/database/enums';
import type { Database } from '@xjobs/database/types';
import type { PickerOption } from '@/components/ui/picker';
import { loadError } from './load';

/** The options every setup picker offers, read as the signed-in user (approved terms only). */

export type TechOption = PickerOption & { searchable: boolean };

export type ValueLists = {
  positions: PickerOption[];
  seniorities: PickerOption[];
  contractTypes: PickerOption[];
  engagements: PickerOption[];
  techs: TechOption[];
  languages: PickerOption[];
  currencies: PickerOption[];
  countries: PickerOption[];
  regions: PickerOption[];
  cities: PickerOption[];
};

/** PostgREST returns at most this many rows per request (`max_rows`). */
const PAGE = 1000;

/** Every row of a query, a page at a time; `read` must order by a unique key. */
async function readAll<T>(
  what: string,
  read: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await read(from, from + PAGE - 1);
    if (error) throw loadError(`${what} read`, error);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

type Term = { code: string; label: string; aliases: string[] };

const UNSTATED = 'unstated';
const GLOBAL = 'GLOBAL';

const option = (t: Term): PickerOption => ({
  value: t.code,
  label: t.label,
  keywords: t.aliases,
});

const byLabel = (a: PickerOption, b: PickerOption) =>
  a.label.localeCompare(b.label);

/** Seniorities in career order, as the `Seniority` enum lists them; unknown ones last. */
const SENIORITY_ORDER: readonly string[] = Object.values(Seniority);
const bySeniority = (a: PickerOption, b: PickerOption) => {
  const rank = (o: PickerOption) => {
    const i = SENIORITY_ORDER.indexOf(o.value);
    return i === -1 ? SENIORITY_ORDER.length : i;
  };
  return rank(a) - rank(b) || byLabel(a, b);
};

export async function loadValueLists(
  supabase: SupabaseClient<Database>,
): Promise<ValueLists> {
  const terms = (
    table:
      | 'seniorities'
      | 'contract_types'
      | 'engagements'
      | 'tech_tags'
      | 'countries'
      | 'regions',
  ) =>
    readAll<Term>(table, (from, to) =>
      supabase
        .from(table)
        .select('code, label, aliases')
        .eq('status', 'approved')
        .order('code')
        .range(from, to),
    );
  const iso = (table: 'iso_languages' | 'iso_currencies') =>
    readAll<{ code: string; label: string }>(table, (from, to) =>
      supabase.from(table).select('code, label').order('code').range(from, to),
    );

  const [
    roles,
    seniorities,
    contractTypes,
    engagements,
    techs,
    languages,
    currencies,
    countries,
    regions,
    cities,
  ] = await Promise.all([
    readAll<Term>('role_kinds', (from, to) =>
      supabase
        .from('role_kinds')
        .select('code, label, aliases')
        .eq('status', 'approved')
        .eq('isEngineering', true)
        .order('code')
        .range(from, to),
    ),
    terms('seniorities'),
    terms('contract_types'),
    terms('engagements'),
    terms('tech_tags'),
    iso('iso_languages'),
    iso('iso_currencies'),
    terms('countries'),
    terms('regions'),
    readAll('cities', (from, to) =>
      supabase
        .from('cities')
        .select('id, name, countryCode, aliases')
        .eq('status', 'approved')
        .order('id')
        .range(from, to),
    ),
  ]);

  const countryLabel = new Map(countries.map((c) => [c.code, c.label]));
  const known = (t: Term) => t.code !== UNSTATED;

  return {
    positions: roles.map(option).sort(byLabel),
    seniorities: seniorities.filter(known).map(option).sort(bySeniority),
    contractTypes: contractTypes.filter(known).map(option).sort(byLabel),
    engagements: engagements.filter(known).map(option).sort(byLabel),
    techs: techs
      .map((t) => ({ ...option(t), searchable: isSearchableTech(t.code) }))
      .sort(byLabel),
    languages: languages
      .map((l) => ({ value: l.code, label: l.label }))
      .sort(byLabel),
    currencies: currencies
      .map((c) => ({ value: c.code, label: c.label }))
      .sort(byLabel),
    countries: countries.map(option).sort(byLabel),
    regions: regions
      .filter((r) => r.code !== GLOBAL)
      .map(option)
      .sort(byLabel),
    cities: cities
      .map((c) => ({
        value: c.id,
        label: `${c.name}, ${countryLabel.get(c.countryCode) ?? c.countryCode}`,
        keywords: c.aliases,
      }))
      .sort(byLabel),
  };
}
