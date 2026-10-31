import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getStorageConfig, type EnvironmentVariables } from 'src/config';
import { QuerySearchModule } from 'src/modules/queries';
import { StorageModule } from 'src/modules/storage';
import { ContactsController } from './controllers/contacts.controller';
import {
  ContactsRepository,
  PrismaContactsRepository,
} from './repositories/contacts.repository';
import { ContactsService } from './services/contacts.service';
import { ProfilesController } from './controllers/profiles.controller';
import {
  PrismaProfilesRepository,
  ProfilesRepository,
} from './repositories/profiles.repository';
import { ProfilesService } from './services/profiles.service';
import { ResumeController } from './controllers/resume.controller';
import { RESUMES_BUCKET, ResumeService } from './services/resume.service';
import { UsersController } from './controllers/users.controller';
import {
  PrismaUsersRepository,
  UsersRepository,
} from './repositories/users.repository';
import { UsersService } from './services/users.service';

@Module({
  imports: [StorageModule, QuerySearchModule],
  controllers: [
    UsersController,
    ContactsController,
    ProfilesController,
    ResumeController,
  ],
  providers: [
    UsersService,
    { provide: UsersRepository, useClass: PrismaUsersRepository },
    ContactsService,
    { provide: ContactsRepository, useClass: PrismaContactsRepository },
    ProfilesService,
    { provide: ProfilesRepository, useClass: PrismaProfilesRepository },
    ResumeService,
    {
      provide: RESUMES_BUCKET,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        getStorageConfig(config).resumesBucket,
    },
  ],
})
export class UsersModule {}
