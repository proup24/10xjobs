import { Logger } from '@nestjs/common';
import type { SqlMiddleware } from '@prisma/orm-postgres/family-runtime';

const statementSql = Symbol('query-logger.sql');

export interface QueryLoggerOptions {
  /** Statements slower than this are logged as warnings. */
  slowQueryMs: number;
  /** Log every statement at debug level. */
  logQueries: boolean;
}

/**
 * @description Prisma 8 middleware that routes statement timings through the
 * Nest logger: every query at debug level when enabled, slow ones as warnings.
 */
export function queryLogger(
  { slowQueryMs, logQueries }: QueryLoggerOptions,
  logger = new Logger('Database'),
): SqlMiddleware {
  return {
    name: 'query-logger',
    familyId: 'sql',
    async beforeEncode(plan, ctx) {
      ctx.state(statementSql)['sql'] = plan.sql;
    },
    async activityEnded(_activity, result, ctx) {
      if (result.kind !== 'statement') return;
      const sql = ctx.state(statementSql)['sql'];
      const summary = `${result.latencyMs}ms [${result.outcome}] ${sql}`;
      if (result.latencyMs > slowQueryMs) {
        logger.warn(`Slow query (> ${slowQueryMs}ms): ${summary}`);
      } else if (logQueries) {
        logger.debug(summary);
      }
    },
  };
}
