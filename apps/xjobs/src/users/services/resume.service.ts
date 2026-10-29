import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProfilesRepository } from '../repositories/profiles.repository';
import {
  ProfilesService,
  toProfileView,
  type ProfileView,
} from './profiles.service';
import { ResumeStorage } from '../repositories/resume-storage';

/** The parts of a multer upload the resume flow reads. */
export type UploadedPdf = {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
};

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;
const PDF_MAGIC = Buffer.from('%PDF-');

/** Keeps a filename safe to echo back in a Content-Disposition header. */
function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[^\w.\- ]/g, '_').slice(0, 200).trim();
  return cleaned || 'resume.pdf';
}

@Injectable()
export class ResumeService {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly repository: ProfilesRepository,
    private readonly storage: ResumeStorage,
  ) {}

  async view(workspaceId: string, userId: string): Promise<ProfileView> {
    return this.profiles.get(workspaceId, userId);
  }

  /** Stores the new PDF, then points the profile at it, then drops the old file. */
  async save(
    workspaceId: string,
    userId: string,
    file: UploadedPdf | undefined,
  ): Promise<ProfileView> {
    if (!file) throw new BadRequestException('A PDF file is required');
    if (
      file.mimetype !== 'application/pdf' ||
      !file.buffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)
    ) {
      throw new BadRequestException('The resume must be a PDF file');
    }
    const profile = await this.profiles.getOrThrow(workspaceId, userId);
    const previousKey = profile.resumeKey;
    const key = `${workspaceId}/${profile.id}/${randomUUID()}.pdf`;
    await this.storage.put(key, file.buffer);
    const meta = {
      key,
      filename: safeFilename(file.originalname),
      sizeBytes: file.buffer.length,
      sha256: createHash('sha256').update(file.buffer).digest('hex'),
      uploadedAt: new Date(),
    };
    try {
      await this.repository.setResume(workspaceId, profile.id, meta);
    } catch (error) {
      await this.storage.delete(key);
      throw error;
    }
    if (previousKey) await this.storage.delete(previousKey);
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
    workspaceId: string,
    userId: string,
  ): Promise<{ filename: string; data: Buffer }> {
    const profile = await this.profiles.getOrThrow(workspaceId, userId);
    if (!profile.resumeKey) throw new NotFoundException('No resume uploaded');
    return {
      filename: profile.resumeFilename ?? 'resume.pdf',
      data: await this.storage.get(profile.resumeKey),
    };
  }

  async delete(workspaceId: string, userId: string): Promise<void> {
    const profile = await this.profiles.getOrThrow(workspaceId, userId);
    if (!profile.resumeKey) throw new NotFoundException('No resume uploaded');
    await this.repository.setResume(workspaceId, profile.id, null);
    await this.storage.delete(profile.resumeKey);
  }

  /** Drops a user's resume file, if any; called before the user is deleted. */
  async removeFor(workspaceId: string, userId: string): Promise<void> {
    const profile = await this.repository.findByUser(workspaceId, userId);
    if (profile?.resumeKey) await this.storage.delete(profile.resumeKey);
  }
}
