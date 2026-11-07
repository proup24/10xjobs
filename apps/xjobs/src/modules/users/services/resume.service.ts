import { Inject, Injectable, Logger } from '@nestjs/common';
import { StorageService } from 'src/modules/storage';
import { ProfilesService } from './profiles.service';

/** Injection token for the name of the bucket that holds resumes. */
export const RESUMES_BUCKET = Symbol('RESUMES_BUCKET');

/**
 * Resume files are written by the web app; the engine only removes them
 * when a profile or a user goes.
 */
@Injectable()
export class ResumeService {
  private readonly logger = new Logger(ResumeService.name);

  constructor(
    private readonly profiles: ProfilesService,
    private readonly storage: StorageService,
    @Inject(RESUMES_BUCKET) private readonly bucket: string,
  ) {}

  /** Removes every file under `prefix/`; a failure is logged and only leaves orphans. */
  private async discardFolder(prefix: string): Promise<void> {
    try {
      await this.storage.deletePrefix(this.bucket, prefix);
    } catch (error) {
      this.logger.warn(
        `Could not remove ${this.bucket}/${prefix}/: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Deletes a profile, then its whole storage folder; the files are only orphans if that fails. */
  async deleteProfile(userId: string, profileId: string): Promise<void> {
    const profile = await this.profiles.getOrThrow(userId, profileId);
    await this.profiles.delete(userId, profile.id);
    await this.discardFolder(`${userId}/${profile.id}`);
  }

  /**
   * Drops every file under the user's folder, including folders whose profile
   * row is already gone; called before the user is deleted.
   */
  async removeAllFor(userId: string): Promise<void> {
    await this.discardFolder(userId);
  }
}
