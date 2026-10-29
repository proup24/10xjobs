import { Module } from '@nestjs/common';
import { WorkspacesModule } from 'src/workspaces';
import { ContactsController } from './contacts.controller';
import {
  ContactsRepository,
  PrismaContactsRepository,
} from './contacts.repository';
import { ContactsService } from './contacts.service';
import { ProfilesController } from './profiles.controller';
import {
  PrismaProfilesRepository,
  ProfilesRepository,
} from './profiles.repository';
import { ProfilesService } from './profiles.service';
import { UsersController } from './users.controller';
import { PrismaUsersRepository, UsersRepository } from './users.repository';
import { UsersService } from './users.service';

@Module({
  imports: [WorkspacesModule],
  controllers: [UsersController, ContactsController, ProfilesController],
  providers: [
    UsersService,
    { provide: UsersRepository, useClass: PrismaUsersRepository },
    ContactsService,
    { provide: ContactsRepository, useClass: PrismaContactsRepository },
    ProfilesService,
    { provide: ProfilesRepository, useClass: PrismaProfilesRepository },
  ],
})
export class UsersModule {}
