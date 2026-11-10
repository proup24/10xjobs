// The modules validate the environment when they are imported.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgresql://u:p@127.0.0.1:1/db';
  process.env.SUPABASE_URL ??= 'http://127.0.0.1:1';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'service-key';
  process.env.ENGINE_API_KEY ??= 'test-engine-key-0123456789-0123456789';
});

import { MODULE_METADATA } from '@nestjs/common/constants';
import { MatcherController } from 'src/modules/matcher/controllers/matcher.controller';
import { ProcessorController } from 'src/modules/processor/controllers/processor.controller';
import { QuerySearchController } from 'src/modules/queries/controllers/query-search.controller';
import { AppModule } from './app.module';
import { OperatorModule, operatorImports } from './operator.module';

describe('operatorImports', () => {
  it.each([undefined, '0', 'false'])('is empty for %s', (value) => {
    expect(operatorImports({ XJOBS_OPERATOR_ENDPOINTS: value })).toEqual([]);
  });

  it.each(['1', 'true'])('is the operator module for %s', (value) => {
    expect(operatorImports({ XJOBS_OPERATOR_ENDPOINTS: value })).toEqual([
      OperatorModule,
    ]);
  });
});

describe('OperatorModule', () => {
  it('serves exactly the processor, matcher and query search controllers', () => {
    const controllers: unknown[] = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      OperatorModule,
    );
    expect([...controllers].sort()).toEqual(
      [ProcessorController, MatcherController, QuerySearchController].sort(),
    );
  });

  it('is the only module that serves them', () => {
    const imports: unknown[] =
      Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) ?? [];
    for (const module of imports) {
      if (module === OperatorModule) continue;
      const controllers: unknown[] =
        Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, module as object) ??
        [];
      expect(controllers).not.toContain(ProcessorController);
      expect(controllers).not.toContain(MatcherController);
      expect(controllers).not.toContain(QuerySearchController);
    }
  });
});
