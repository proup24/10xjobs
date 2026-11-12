import { describe, expect, it } from 'vitest';
import { admin } from './support/admin.js';

describe('seeded cities', () => {
  it('has Fès approved with the alias Fez', async () => {
    const { data, error } = await admin()
      .from('cities')
      .select('name, aliases, status')
      .eq('countryCode', 'MA')
      .eq('name', 'Fès');
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.status).toBe('approved');
    expect(data?.[0]?.aliases).toEqual(expect.arrayContaining(['Fez', 'Fes']));
  });
});
