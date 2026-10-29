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
import {
  ApiBody,
  ApiConsumes,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponses, ApiSuccessResponse } from 'src/common/decorators';
import { ProfileResponseDto } from '../dto/profile.response.dto';
import { MAX_RESUME_BYTES, ResumeService } from '../services/resume.service';
import type { ProfileView, UploadedPdf } from '../types';

@ApiTags('profiles')
@ApiErrorResponses(HttpStatus.UNAUTHORIZED, HttpStatus.INTERNAL_SERVER_ERROR)
@Controller('workspaces/:workspaceId/users/:userId/profile/resume')
export class ResumeController {
  constructor(private readonly resume: ResumeService) {}

  @ApiSuccessResponse(ProfileResponseDto, { status: HttpStatus.CREATED })
  @ApiErrorResponses(
    HttpStatus.BAD_REQUEST,
    HttpStatus.NOT_FOUND,
    HttpStatus.PAYLOAD_TOO_LARGE,
  )
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
    FileInterceptor('file', {
      limits: { fileSize: MAX_RESUME_BYTES, files: 1 },
    }),
  )
  upload(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @UploadedFile() file: UploadedPdf | undefined,
  ): Promise<ProfileView> {
    return this.resume.save(workspaceId, userId, file);
  }

  @ApiOkResponse({
    description: 'The PDF itself, not an envelope',
    content: {
      'application/pdf': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
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

  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    return this.resume.delete(workspaceId, userId);
  }
}
