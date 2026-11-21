import { engineClient } from '@/lib/engine/server';

/**
 * Whether the engine counts the signed-in user as an admin (`ADMIN_USERS`). Never
 * throws: an engine that is down or refuses means not an admin.
 */
export async function isAdmin(): Promise<boolean> {
  try {
    const result = await (await engineClient()).adminMe();
    return result.kind === 'ok' && result.data.admin;
  } catch {
    return false;
  }
}
