import { Module } from '@nestjs/common';
import {
  QuerySearchModule,
  SEARCH_SWITCHES,
  SEARCH_SWITCHES_TOKEN,
} from 'src/modules/queries';
import {
  PrismaProfilesRepository,
  ProfilesRepository,
} from './repositories/profiles.repository';
import { ProfileSearchSync } from './services/profile-search-sync';

/**
 * The search sync and what it needs, with no HTTP parts (no controller, no
 * guard), so the worker process can import it without the users module.
 */
@Module({
  imports: [QuerySearchModule],
  providers: [
    { provide: SEARCH_SWITCHES_TOKEN, useValue: SEARCH_SWITCHES },
    ProfileSearchSync,
    { provide: ProfilesRepository, useClass: PrismaProfilesRepository },
  ],
  exports: [ProfileSearchSync, ProfilesRepository, SEARCH_SWITCHES_TOKEN],
})
export class ProfileSearchModule {}
