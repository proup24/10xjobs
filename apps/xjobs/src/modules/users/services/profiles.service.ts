import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Arrangement,
  Position,
  ProfileState,
  Region,
  Seniority,
  Technology,
} from 'src/common/enums';
import {
  QuerySearchService,
  type QuerySearchProfileInput,
} from 'src/modules/query-search';
import { ProfilesRepository } from '../repositories/profiles.repository';
import { UsersService } from './users.service';
import type {
  ProfileInput,
  ProfileView,
  ProfileWithSkills,
  PublishedProfileView,
  SkillInput,
} from '../types';

/** The API shape of a profile: no storage key, stack ordered by importance, then what the user wants most. */
export function toProfileView(profile: ProfileWithSkills): ProfileView {
  const {
    techStack,
    resumeKey,
    resumeFilename,
    resumeSizeBytes,
    resumeSha256,
    resumeUploadedAt,
    ...fields
  } = profile;
  return {
    ...fields,
    techStack: techStack
      .map(({ technology, domain, mastery, preference, importance }) => ({
        technology,
        domain,
        mastery,
        preference,
        importance,
      }))
      .sort(
        (a, b) =>
          b.importance - a.importance ||
          b.preference - a.preference ||
          b.mastery - a.mastery,
      ),
    resume:
      resumeKey && resumeFilename && resumeSha256 && resumeUploadedAt
        ? {
            filename: resumeFilename,
            sizeBytes: resumeSizeBytes ?? 0,
            sha256: resumeSha256,
            uploadedAt: resumeUploadedAt,
          }
        : null,
  };
}

/** What query search builders are generated from; importance 0 skills stay in so the builders can drop them. */
export function toQuerySearchInput(
  profile: ProfileWithSkills,
): QuerySearchProfileInput {
  // Rows carry plain string unions; the enums have the same values.
  return {
    positions: [...profile.positions] as Position[],
    regions: [...profile.regions] as Region[],
    arrangements: [...profile.arrangements] as Arrangement[],
    seniority: profile.seniority as Seniority,
    country: profile.country,
    city: profile.city,
    skills: profile.techStack.map(
      ({ technology, importance, preference, mastery }) => ({
        technology: technology as Technology,
        importance,
        preference,
        mastery,
      }),
    ),
  };
}

@Injectable()
export class ProfilesService {
  constructor(
    private readonly users: UsersService,
    private readonly profiles: ProfilesRepository,
    private readonly querySearch: QuerySearchService,
  ) {}

  async getOrThrow(
    workspaceId: string,
    userId: string,
  ): Promise<ProfileWithSkills> {
    await this.users.getOrThrow(workspaceId, userId);
    const profile = await this.profiles.findByUser(workspaceId, userId);
    if (!profile) throw new NotFoundException('Profile not found');
    return profile;
  }

  async get(workspaceId: string, userId: string): Promise<ProfileView> {
    return toProfileView(await this.getOrThrow(workspaceId, userId));
  }

  async upsert(
    workspaceId: string,
    userId: string,
    data: ProfileInput & {
      techStack: (Omit<SkillInput, 'importance'> & { importance?: number })[];
    },
  ): Promise<ProfileView> {
    await this.users.getOrThrow(workspaceId, userId);
    const { techStack, ...fields } = data;
    const skills = techStack.map(
      ({ technology, domain, mastery, preference, importance }) => ({
        technology,
        domain,
        mastery,
        preference,
        importance: importance ?? 5,
      }),
    );
    return toProfileView(
      await this.profiles.upsert(
        workspaceId,
        userId,
        { ...fields, city: fields.city ?? null },
        skills,
      ),
    );
  }

  /** Generates the query search builders first, so a failure leaves the profile a draft. */
  async publish(
    workspaceId: string,
    userId: string,
  ): Promise<PublishedProfileView> {
    const profile = await this.getOrThrow(workspaceId, userId);
    const querySearches = await this.querySearch.generate(
      workspaceId,
      toQuerySearchInput(profile),
    );
    const published = await this.profiles.setState(
      workspaceId,
      profile.id,
      ProfileState.published,
      new Date(),
    );
    return { ...toProfileView(published), querySearches };
  }

  /** Query search builders are kept; they are permanent. */
  async unpublish(workspaceId: string, userId: string): Promise<ProfileView> {
    const profile = await this.getOrThrow(workspaceId, userId);
    return toProfileView(
      await this.profiles.setState(
        workspaceId,
        profile.id,
        ProfileState.draft,
        null,
      ),
    );
  }
}
