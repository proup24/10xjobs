/**
 * @description Where the client and the query logger write. A Nest `Logger`
 * satisfies it, so the engine passes its own; scripts get the console.
 */
export interface DatabaseLogger {
  log(message: unknown): void;
  warn(message: unknown): void;
  error(message: unknown): void;
  debug(message: unknown): void;
}

/** A console-backed logger that prefixes every line with `[context]`. */
export function consoleLogger(context = 'Database'): DatabaseLogger {
  const prefix = `[${context}]`;
  return {
    log: (message) => console.log(prefix, message),
    warn: (message) => console.warn(prefix, message),
    error: (message) => console.error(prefix, message),
    debug: (message) => console.debug(prefix, message),
  };
}
