import { ProviderUnavailableError } from '../errors';

/**
 * The only environment a `claude -p` child receives. Everything else in the
 * engine's environment (database, Supabase, Apify, Redis) stays out of it.
 * `home` is the empty per-call directory the child uses as its HOME.
 */
export function claudeEnv(
  source: NodeJS.ProcessEnv,
  home: string,
): Record<string, string> {
  const oauth = nonEmpty(source.CLAUDE_CODE_OAUTH_TOKEN);
  const apiKey = nonEmpty(source.ANTHROPIC_API_KEY);
  if (!oauth && !apiKey) {
    throw new ProviderUnavailableError('no Claude credential');
  }

  const env: Record<string, string> = {
    PATH: source.PATH ?? '',
    HOME: home,
    DISABLE_AUTOUPDATER: '1',
  };
  if (oauth) env.CLAUDE_CODE_OAUTH_TOKEN = oauth;
  if (apiKey) env.ANTHROPIC_API_KEY = apiKey;
  return env;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value ? value : undefined;
}
