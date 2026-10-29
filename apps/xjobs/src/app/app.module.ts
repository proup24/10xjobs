import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from 'src/config';
import { DatabaseModule } from 'src/database';
import { WorkspacesModule } from 'src/workspaces';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // `src/environment.ts` already loaded the env files into process.env.
      ignoreEnvFile: true,
      validate: validateEnvironment,
    }),
    DatabaseModule,
    WorkspacesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
