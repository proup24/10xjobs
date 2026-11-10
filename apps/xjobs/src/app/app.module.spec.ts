// Both modules validate the environment when they are imported.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgresql://u:p@127.0.0.1:1/db';
  process.env.SUPABASE_URL ??= 'http://127.0.0.1:1';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'service-key';
  process.env.ENGINE_API_KEY ??= 'test-engine-key-0123456789-0123456789';
  delete process.env.WORKER_ROLE;
  delete process.env.WORKER_CHANNEL;
});

import { MODULE_METADATA } from '@nestjs/common/constants';
import { WorkerModule } from 'src/infrastructure/worker/worker.module';
import { ProcessorModule } from 'src/modules/processor';
import { OperatorModule } from './operator.module';
import { AppModule } from './app.module';

describe('AppModule', () => {
  const imports: unknown[] =
    Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) ?? [];

  it('does not host the workers: they run in the worker process', () => {
    expect(imports).not.toContain(WorkerModule);
  });

  it('imports no operator module directly: the flag decides', () => {
    expect(imports).not.toContain(ProcessorModule);
    expect(imports).not.toContain(OperatorModule);
  });
});
