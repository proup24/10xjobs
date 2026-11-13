/**
 * The exact Claude Code release the processor runs. The Dockerfile installs
 * this version, and startup refuses any other `claude --version`. The
 * fixtures in `./fixtures` were recorded on it.
 */
export const CLAUDE_CODE_VERSION = '2.1.314';
