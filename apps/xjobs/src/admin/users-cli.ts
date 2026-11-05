import { createClient } from '@supabase/supabase-js';
import type { AdminAuth } from '@xjobs/database/auth';
import {
  blockUser,
  inviteUser,
  listAuthUsers,
  signInLink,
  unblockUser,
  type CommandResult,
} from './users-admin';

const USAGE =
  'Usage: pnpm users <invite|block|unblock|link> <email> | pnpm users list';
const MISSING_ENV =
  'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (locally: eval "$(scripts/supabase-env.sh)").';

export type UsersCliDeps = {
  createAuth?: (url: string, key: string) => AdminAuth;
  print?: (line: string) => void;
};

function defaultCreateAuth(url: string, key: string): AdminAuth {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).auth.admin;
}

export async function runUsersCli(
  argv: string[],
  env: NodeJS.ProcessEnv,
  deps: UsersCliDeps = {},
): Promise<number> {
  const print = deps.print ?? ((line: string) => console.log(line));
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    print(MISSING_ENV);
    return 1;
  }
  print(`Using ${new URL(SUPABASE_URL).hostname}`);

  const [command, email, ...rest] = argv;
  const auth = (deps.createAuth ?? defaultCreateAuth)(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
  );

  let run: Promise<CommandResult>;
  if (command === 'list' && email === undefined) run = listAuthUsers(auth);
  else if (email && rest.length === 0 && command === 'invite')
    run = inviteUser(auth, email);
  else if (email && rest.length === 0 && command === 'block')
    run = blockUser(auth, email);
  else if (email && rest.length === 0 && command === 'unblock')
    run = unblockUser(auth, email);
  else if (email && rest.length === 0 && command === 'link')
    run = signInLink(auth, email, env.WEB_URL ?? 'http://localhost:3001');
  else {
    print(USAGE);
    return 1;
  }

  try {
    const result = await run;
    if (result.message) print(result.message);
    return result.ok ? 0 : 1;
  } catch (error) {
    print(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (require.main === module) {
  void runUsersCli(process.argv.slice(2), process.env).then((code) => {
    process.exitCode = code;
  });
}
