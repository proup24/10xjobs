import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from 'src/config';
import { DatabaseModule } from 'src/database';
import { UsersModule } from 'src/modules/users';
import { WorkspacesModule } from 'src/modules/workspaces';
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
    UsersModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
