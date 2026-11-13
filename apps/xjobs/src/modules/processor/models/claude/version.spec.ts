import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLAUDE_CODE_VERSION } from './version.js';

describe('CLAUDE_CODE_VERSION', () => {
  it('is installed exactly by the engine Dockerfile', () => {
    const dockerfile = readFileSync(
      join(__dirname, '../../../../../Dockerfile'),
      'utf8',
    );
    expect(dockerfile).toContain(
      `npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}\n`,
    );
    expect(dockerfile).toMatch(/^ENV DISABLE_AUTOUPDATER=1$/m);
  });
});
