import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import {
  StorageObjectNotFoundError,
  StorageService,
} from 'src/modules/storage';
import { ProfilesRepository } from '../repositories/profiles.repository';
import {
  PROFILE_PUBLISHED,
  ProfilesService,
  toProfileView,
} from './profiles.service';
import type { ProfileView, UploadedPdf } from '../types';
import { safeFilename } from 'src/utils';

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;
const PDF_MAGIC = Buffer.from('%PDF-');


/** Injection token for the name of the bucket that holds resumes. */
export const RESUMES_BUCKET = Symbol('RESUMES_BUCKET');

@Injectable()
export class ResumeService implements OnModuleInit {
  private readonly logger = new Logger(ResumeService.name);

  constructor(
    private readonly profiles: ProfilesService,
    private readonly repository: ProfilesRepository,
    private readonly storage: StorageService,
    @Inject(RESUMES_BUCKET) private readonly bucket: string,
  ) {}

  /** Creates the private resumes bucket on first start. */
  async onModuleInit(): Promise<void> {
    await this.storage.ensureBucket(this.bucket);
  }

  /** Removes a file nobody points at any more; a failure only leaves an orphan. */
  private async discard(key: string): Promise<void> {
    try {
      await this.storage.delete(this.bucket, key);
    } catch (error) {
      this.logger.warn(
        `Could not remove ${this.bucket}/${key}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async view(userId: string, profileId: string): Promise<ProfileView> {
    return this.profiles.get(userId, profileId);
  }

  /** Stores the new PDF, then points the profile at it, then drops the old file. Drafts only. */
  async save(
    userId: string,
    profileId: string,
    file: UploadedPdf | undefined,
  ): Promise<ProfileView> {
    if (!file) throw new BadRequestException('A PDF file is required');
    if (
      file.mimetype !== 'application/pdf' ||
      !file.buffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)
    ) {
      throw new BadRequestException('The resume must be a PDF file');
    }
    const profile = await this.profiles.getDraftOrThrow(userId, profileId);
    const previousKey = profile.resumeKey;
    const key = `${userId}/${profile.id}/${randomUUID()}.pdf`;
    await this.storage.put(this.bucket, key, file.buffer, 'application/pdf');
    const meta = {
      key,
      filename: safeFilename(file.originalname),
      sizeBytes: file.buffer.length,
      sha256: createHash('sha256').update(file.buffer).digest('hex'),
      uploadedAt: new Date(),
    };
    let stored: boolean;
    try {
      stored = await this.repository.setResume(userId, profile.id, meta);
    } catch (error) {
      await this.discard(key);
      throw error;
    }
    if (!stored) {
      // Deleted or published mid-upload: drop the file, then report which.
      await this.discard(key);
      await this.profiles.getDraftOrThrow(userId, profileId);
      throw new ConflictException(PROFILE_PUBLISHED);
    }
    if (previousKey) await this.discard(previousKey);
    return toProfileView({
      ...profile,
      resumeKey: meta.key,
      resumeFilename: meta.filename,
      resumeSizeBytes: meta.sizeBytes,
      resumeSha256: meta.sha256,
      resumeUploadedAt: meta.uploadedAt,
    });
  }

  async get(
    userId: string,
    profileId: string,
  ): Promise<{ filename: string; data: Buffer }> {
    const profile = await this.profiles.getOrThrow(userId, profileId);
    if (!profile.resumeKey) throw new NotFoundException('No resume uploaded');
    try {
      return {
        filename: profile.resumeFilename ?? 'resume.pdf',
        data: await this.storage.get(this.bucket, profile.resumeKey),
      };
    } catch (error) {
      if (error instanceof StorageObjectNotFoundError) {
        throw new NotFoundException('No resume uploaded');
      }
      throw error;
    }
  }

  /** Drafts only: a published profile keeps the resume it was published with. */
  async delete(userId: string, profileId: string): Promise<void> {
    const profile = await this.profiles.getDraftOrThrow(userId, profileId);
    if (!profile.resumeKey) throw new NotFoundException('No resume uploaded');
    if (!(await this.repository.setResume(userId, profile.id, null))) {
      await this.profiles.getDraftOrThrow(userId, profileId);
      throw new ConflictException(PROFILE_PUBLISHED);
    }
    await this.discard(profile.resumeKey);
  }

  /** Deletes a profile, then its resume file; the file is only an orphan if that fails. */
  async deleteProfile(userId: string, profileId: string): Promise<void> {
    const profile = await this.profiles.getOrThrow(userId, profileId);
    await this.profiles.delete(userId, profile.id);
    if (profile.resumeKey) await this.discard(profile.resumeKey);
  }

  /** Drops the resume files of every profile a user owns; called before the user is deleted. */
  async removeAllFor(userId: string): Promise<void> {
    for (const profile of await this.repository.list(userId)) {
      if (profile.resumeKey) await this.discard(profile.resumeKey);
    }
  }
}
