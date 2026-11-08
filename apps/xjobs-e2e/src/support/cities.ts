import { randomUUID } from 'node:crypto';
import { admin } from './auth-users';

/** Inserts an approved city in Morocco through the service role and returns its id. */
export async function createApprovedCity(name: string): Promise<string> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const { error } = await admin().from('cities').insert({
    id,
    name,
    nameKey: name.toLowerCase(),
    countryCode: 'MA',
    aliases: [],
    status: 'approved',
    firstSeenAt: now,
    approvedAt: now,
  });
  if (error) throw new Error(`Could not insert city ${name}: ${error.message}`);
  return id;
}

export async function deleteCity(id: string): Promise<void> {
  const { error } = await admin().from('cities').delete().eq('id', id);
  if (error) throw new Error(`Could not delete city ${id}: ${error.message}`);
}
