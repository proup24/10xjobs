import { Module } from '@nestjs/common';
import { QuerySearchModule } from 'src/modules/queries';
import { ProfilesController } from './controllers/profiles.controller';
import { ProfileSearchModule } from './profile-search.module';
import { ProfilesService } from './services/profiles.service';
import {
  PrismaUsersRepository,
  UsersRepository,
} from './repositories/users.repository';
import { UsersService } from './services/users.service';

@Module({
  // ProfilesService injects QuerySearchService itself; ProfileSearchModule does not re-export it.
  imports: [ProfileSearchModule, QuerySearchModule],
  controllers: [ProfilesController],
  providers: [
    UsersService,
    { provide: UsersRepository, useClass: PrismaUsersRepository },
    ProfilesService,
  ],
})
export class UsersModule {}
