import { Module } from '@nestjs/common';
import { QuerySearchModule } from 'src/modules/queries';
import {
  PrismaProfilesRepository,
  ProfilesRepository,
} from './repositories/profiles.repository';
import { PostSearchAccess } from './services/post-search-access';
import { ProfileSearchSync } from './services/profile-search-sync';

/**
 * The search sync and what it needs, with no HTTP parts (no controller, no
 * guard), so the worker process can import it without the users module.
 */
@Module({
  imports: [QuerySearchModule],
  providers: [
    PostSearchAccess,
    ProfileSearchSync,
    { provide: ProfilesRepository, useClass: PrismaProfilesRepository },
  ],
  exports: [ProfileSearchSync, ProfilesRepository, PostSearchAccess],
})
export class ProfileSearchModule {}
