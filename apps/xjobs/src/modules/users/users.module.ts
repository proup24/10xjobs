import { Module } from '@nestjs/common';
import { QuerySearchModule } from 'src/modules/queries';
import { ProfilesController } from './controllers/profiles.controller';
import {
  PrismaProfilesRepository,
  ProfilesRepository,
} from './repositories/profiles.repository';
import { PostSearchAccess } from './services/post-search-access';
import { ProfilesService } from './services/profiles.service';
import {
  PrismaUsersRepository,
  UsersRepository,
} from './repositories/users.repository';
import { UsersService } from './services/users.service';

@Module({
  imports: [QuerySearchModule],
  controllers: [ProfilesController],
  providers: [
    UsersService,
    { provide: UsersRepository, useClass: PrismaUsersRepository },
    PostSearchAccess,
    ProfilesService,
    { provide: ProfilesRepository, useClass: PrismaProfilesRepository },
  ],
})
export class UsersModule {}
