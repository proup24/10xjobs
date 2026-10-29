import { Injectable, NotFoundException } from '@nestjs/common';
import type { ProfileRow } from 'src/database';
import {
  ProfilesRepository,
  type ProfileInput,
  type ProfileWithSkills,
  type SkillInput,
} from './profiles.repository';
import { UsersService } from './users.service';

export type ProfileView = Omit<
  ProfileRow,
  | 'resumeKey'
  | 'resumeFilename'
  | 'resumeSizeBytes'
  | 'resumeSha256'
  | 'resumeUploadedAt'
> & {
  techStack: SkillInput[];
  resume: {
    filename: string;
    sizeBytes: number;
    sha256: string;
    uploadedAt: Date;
  } | null;
};

/** The API shape of a profile: no storage key, stack ordered by what the user wants most. */
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
      .map(({ technology, domain, mastery, preference }) => ({
        technology,
        domain,
        mastery,
        preference,
      }))
      .sort((a, b) => b.preference - a.preference || b.mastery - a.mastery),
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

@Injectable()
export class ProfilesService {
  constructor(
    private readonly users: UsersService,
    private readonly profiles: ProfilesRepository,
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
    data: ProfileInput & { techStack: SkillInput[] },
  ): Promise<ProfileView> {
    await this.users.getOrThrow(workspaceId, userId);
    const { techStack, ...fields } = data;
    const skills = techStack.map(({ technology, domain, mastery, preference }) => ({
      technology,
      domain,
      mastery,
      preference,
    }));
    return toProfileView(
      await this.profiles.upsert(
        workspaceId,
        userId,
        { ...fields, city: fields.city ?? null },
        skills,
      ),
    );
  }
}
