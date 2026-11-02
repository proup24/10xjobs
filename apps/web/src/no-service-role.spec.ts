import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const webRoot = join(import.meta.dirname, '..');
const forbidden =
  /SERVICE_ROLE|service_role|SUPABASE_SECRET|sb_secret_|SECRET_KEY/;
const thisFile = join(import.meta.dirname, 'no-service-role.spec.ts');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = [
  ...walk(join(webRoot, 'src')),
  ...readdirSync(webRoot)
    .filter((name) => /\.(ts|mjs|js|json)$/.test(name))
    .map((name) => join(webRoot, name)),
].filter((file) => file !== thisFile);

describe('web source', () => {
  it('scans a non-trivial set of files', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('web source never references the service-role key', () => {
    const offenders = files
      .filter((file) => forbidden.test(readFileSync(file, 'utf8')))
      .map((file) => relative(webRoot, file));
    expect(offenders).toEqual([]);
  });
});
