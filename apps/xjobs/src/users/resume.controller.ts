import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { ProfileView } from './profiles.service';
import {
  MAX_RESUME_BYTES,
  ResumeService,
  type UploadedPdf,
} from './resume.service';

@ApiTags('profiles')
@Controller('workspaces/:workspaceId/users/:userId/profile/resume')
export class ResumeController {
  constructor(private readonly resume: ResumeService) {}

  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  // Multer's size-limit error becomes a 413 in Nest's FileInterceptor.
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_RESUME_BYTES, files: 1 } }),
  )
  upload(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @UploadedFile() file: UploadedPdf | undefined,
  ): Promise<ProfileView> {
    return this.resume.save(workspaceId, userId, file);
  }

  @Get()
  async download(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<StreamableFile> {
    const { filename, data } = await this.resume.get(workspaceId, userId);
    return new StreamableFile(data, {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
      length: data.length,
    });
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    return this.resume.delete(workspaceId, userId);
  }
}
