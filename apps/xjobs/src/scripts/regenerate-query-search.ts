/**
 * Moves every published profile to the query search builders of the current
 * recipe and retires the outdated ones. Run once after a recipe version bump:
 *
 *   pnpm db:regenerate
 */
import '../environment';
import { Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { validateEnvironment } from 'src/config';
import { DatabaseModule } from 'src/database';
import { UsersModule } from 'src/modules/users';
import { ProfilesService } from 'src/modules/users/services/profiles.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      ignoreEnvFile: true,
      validate: validateEnvironment,
    }),
    DatabaseModule,
    UsersModule,
  ],
})
class RegenerateModule {}

async function main(): Promise<void> {
  const logger = new Logger('Regenerate');
  const app = await NestFactory.createApplicationContext(RegenerateModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const { profiles, retired } = await app
      .get(ProfilesService)
      .regeneratePublished();
    logger.log(
      `Regenerated ${profiles} published profiles; retired ${retired} outdated builders`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  Logger.error(
    error instanceof Error ? error.message : String(error),
    undefined,
    'Regenerate',
  );
  process.exit(1);
});
