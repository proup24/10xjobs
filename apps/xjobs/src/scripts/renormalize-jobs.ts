/**
 * Rebuilds every normalized job from raw storage at the current normalizer
 * version, without sending anything to Process. Run once after a
 * `NORMALIZER_VERSION` bump, and once to backfill existing raw items:
 *
 *   pnpm db:renormalize
 */
import '../environment';
import { Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { validateEnvironment } from 'src/config';
import { DatabaseModule } from 'src/database';
import { RenormalizeService } from 'src/modules/ingest/services/renormalize.service';

// Only the database: a rebuild reads raw storage, never the batch files.
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      ignoreEnvFile: true,
      validate: validateEnvironment,
    }),
    DatabaseModule,
  ],
  providers: [RenormalizeService],
})
class RenormalizeModule {}

async function main(): Promise<void> {
  const logger = new Logger('Renormalize');
  const app = await NestFactory.createApplicationContext(RenormalizeModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const { items, invalid, jobs } = await app.get(RenormalizeService).run();
    logger.log(
      `Renormalized ${items} raw items into ${jobs} active jobs; ${invalid} items did not normalize`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  Logger.error(
    error instanceof Error ? error.message : String(error),
    undefined,
    'Renormalize',
  );
  process.exit(1);
});
