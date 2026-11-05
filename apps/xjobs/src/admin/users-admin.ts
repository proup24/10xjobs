import { findAuthUserByEmail, type AdminAuth } from '@xjobs/database/auth';

export type { AdminAuth };
export type CommandResult = { ok: boolean; message: string };

const BAN_FOREVER = '876000h'; // 100 years
const ALREADY_SIGNED_UP = (email: string): CommandResult => ({
  ok: true,
  message: `${email} has already signed up; nothing changed.`,
});

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export async function inviteUser(
  auth: AdminAuth,
  raw: string,
): Promise<CommandResult> {
  const email = normalizeEmail(raw);
  const existing = await findAuthUserByEmail(auth, email);
  if (existing?.email_confirmed_at) return ALREADY_SIGNED_UP(email);

  const { error } = await auth.inviteUserByEmail(email);
  if (error) {
    if (error.code === 'email_exists') return ALREADY_SIGNED_UP(email);
    return {
      ok: false,
      message: `Could not invite ${email}: ${error.message}`,
    };
  }
  return {
    ok: true,
    message: existing ? `Re-sent the invite to ${email}.` : `Invited ${email}.`,
  };
}

async function setBan(
  auth: AdminAuth,
  raw: string,
  banDuration: string,
  done: (email: string) => string,
): Promise<CommandResult> {
  const email = normalizeEmail(raw);
  const user = await findAuthUserByEmail(auth, email);
  if (!user) return { ok: false, message: `No user with email ${email}.` };
  const { error } = await auth.updateUserById(user.id, {
    ban_duration: banDuration,
  });
  if (error) {
    return {
      ok: false,
      message: `Could not update ${email}: ${error.message}`,
    };
  }
  return { ok: true, message: done(email) };
}

export function blockUser(auth: AdminAuth, email: string) {
  return setBan(
    auth,
    email,
    BAN_FOREVER,
    (e) => `Blocked ${e}. Their data is kept.`,
  );
}

export function unblockUser(auth: AdminAuth, email: string) {
  return setBan(auth, email, 'none', (e) => `Unblocked ${e}.`);
}

function statusOf(user: {
  email_confirmed_at?: string;
  banned_until?: string;
}): 'pending' | 'active' | 'blocked' {
  if (user.banned_until && new Date(user.banned_until) > new Date()) {
    return 'blocked';
  }
  if (!user.email_confirmed_at) return 'pending';
  return 'active';
}

export async function listAuthUsers(auth: AdminAuth): Promise<CommandResult> {
  const lines: string[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await auth.listUsers({ page, perPage: 1000 });
    if (error) {
      return { ok: false, message: `Could not list users: ${error.message}` };
    }
    for (const u of data.users) {
      lines.push(
        `${u.email ?? u.id}  ${statusOf(u)}  ${u.last_sign_in_at ?? 'never'}`,
      );
    }
    if (data.users.length < 1000) break;
  }
  return { ok: true, message: lines.join('\n') };
}
