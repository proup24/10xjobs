import { Injectable } from '@nestjs/common';
import { DatabaseService, type ProfileSkillRow } from 'src/database';
import type {
  ProfileInput,
  ProfileWithSkills,
  ResumeMeta,
  SkillInput,
} from '../types';

/** Injection token and contract for profile persistence, scoped by workspace. */
export abstract class ProfilesRepository {
  abstract findByUser(
    workspaceId: string,
    userId: string,
  ): Promise<ProfileWithSkills | null>;
  /** Creates or replaces the user's profile and its whole tech stack, atomically. */
  abstract upsert(
    workspaceId: string,
    userId: string,
    data: ProfileInput,
    skills: SkillInput[],
  ): Promise<ProfileWithSkills>;
  abstract setResume(
    workspaceId: string,
    profileId: string,
    meta: ResumeMeta | null,
  ): Promise<void>;
}

@Injectable()
export class PrismaProfilesRepository extends ProfilesRepository {
  constructor(private readonly database: DatabaseService) {
    super();
  }

  async findByUser(
    workspaceId: string,
    userId: string,
  ): Promise<ProfileWithSkills | null> {
    const orm = this.database.db.orm.public;
    const profile = await orm.Profile.where({ workspaceId, userId }).first();
    if (!profile) return null;
    const techStack = await orm.ProfileSkill.where({
      workspaceId,
      profileId: profile.id,
    }).all();
    return { ...profile, techStack };
  }

  upsert(
    workspaceId: string,
    userId: string,
    data: ProfileInput,
    skills: SkillInput[],
  ): Promise<ProfileWithSkills> {
    return this.database.db.transaction(async (tx) => {
      const orm = tx.orm.public;
      const existing = await orm.Profile.where({ workspaceId, userId }).first();
      const profile = existing
        ? await orm.Profile.where({ workspaceId, id: existing.id }).update(data)
        : await orm.Profile.create({ ...data, workspaceId, userId });
      if (!profile) throw new Error(`Profile for user ${userId} vanished`);
      await orm.ProfileSkill.where({
        workspaceId,
        profileId: profile.id,
      }).deleteAll();
      const techStack: ProfileSkillRow[] = [];
      for (const skill of skills) {
        techStack.push(
          await orm.ProfileSkill.create({
            ...skill,
            workspaceId,
            profileId: profile.id,
          }),
        );
      }
      return { ...profile, techStack };
    });
  }

  async setResume(
    workspaceId: string,
    profileId: string,
    meta: ResumeMeta | null,
  ): Promise<void> {
    await this.database.db.orm.public.Profile.where({
      workspaceId,
      id: profileId,
    }).update({
      resumeKey: meta?.key ?? null,
      resumeFilename: meta?.filename ?? null,
      resumeSizeBytes: meta?.sizeBytes ?? null,
      resumeSha256: meta?.sha256 ?? null,
      resumeUploadedAt: meta?.uploadedAt ?? null,
    });
  }
}
