// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const webRoot = join(import.meta.dirname, '..');
const forbidden = /service_?role|supabase_secret|sb_secret_|secret_key/i;
const thisFile = join(import.meta.dirname, 'no-service-role.spec.ts');
const skippedDirs = new Set(['node_modules', '.next']);
const scannedExtensions = /\.(ts|mts|cts|tsx|js|mjs|cjs|json)$/;
const binary = /\.(ico|png|jpe?g|gif|webp|avif|woff2?|ttf|otf|eot|pdf|zip)$/i;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (skippedDirs.has(name)) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return binary.test(name) ? [] : [path];
  });
}

const publicDir = join(webRoot, 'public');
const topLevel = readdirSync(webRoot, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .filter((name) => scannedExtensions.test(name) || name.startsWith('.env'))
  .map((name) => join(webRoot, name));

const files = [
  ...walk(join(webRoot, 'src')),
  ...(existsSync(publicDir) ? walk(publicDir) : []),
  ...topLevel,
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
