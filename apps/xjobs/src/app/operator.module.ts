import { Module, type Type } from '@nestjs/common';
import { booleanFlag } from '@xjobs/database/env';
import { MatcherController } from 'src/modules/matcher/controllers/matcher.controller';
import { MatcherModule } from 'src/modules/matcher';
import { ProcessorController } from 'src/modules/processor/controllers/processor.controller';
import { ProcessorModule } from 'src/modules/processor';
import { QuerySearchController } from 'src/modules/queries/controllers/query-search.controller';
import { QuerySearchModule } from 'src/modules/queries';

/**
 * The testing and inspection routes for processor, matcher and query search.
 * They need only the engine key, no user token, so they exist only on a local
 * engine (`XJOBS_OPERATOR_ENDPOINTS=1`; validation refuses it in production).
 */
@Module({
  imports: [ProcessorModule, MatcherModule, QuerySearchModule],
  controllers: [ProcessorController, MatcherController, QuerySearchController],
})
export class OperatorModule {}

/** `[OperatorModule]` when the flag is on, else nothing. */
export function operatorImports(env: NodeJS.ProcessEnv): Type[] {
  const flag = booleanFlag.safeParse(env['XJOBS_OPERATOR_ENDPOINTS']);
  return flag.success && flag.data ? [OperatorModule] : [];
}
