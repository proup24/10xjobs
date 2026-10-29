import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses, ApiSuccessResponse } from 'src/common/decorators';
import type { WorkspaceRow } from 'src/database';
import { CreateWorkspaceDto } from '../dto/create-workspace.dto';
import { UpdateWorkspaceDto } from '../dto/update-workspace.dto';
import { WorkspaceResponseDto } from '../dto/workspace.response.dto';
import { WorkspacesService } from '../services/workspaces.service';

@ApiTags('workspaces')
@ApiErrorResponses(HttpStatus.UNAUTHORIZED, HttpStatus.INTERNAL_SERVER_ERROR)
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @ApiSuccessResponse(WorkspaceResponseDto, { status: HttpStatus.CREATED })
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT)
  @Post()
  create(@Body() body: CreateWorkspaceDto): Promise<WorkspaceRow> {
    return this.workspaces.create(body);
  }

  @ApiSuccessResponse(WorkspaceResponseDto, { isArray: true })
  @Get()
  list(): Promise<WorkspaceRow[]> {
    return this.workspaces.list();
  }

  @ApiSuccessResponse(WorkspaceResponseDto)
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  @Get(':workspaceId')
  get(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
  ): Promise<WorkspaceRow> {
    return this.workspaces.getOrThrow(workspaceId);
  }

  @ApiSuccessResponse(WorkspaceResponseDto)
  @ApiErrorResponses(
    HttpStatus.BAD_REQUEST,
    HttpStatus.NOT_FOUND,
    HttpStatus.CONFLICT,
  )
  @Patch(':workspaceId')
  update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body() body: UpdateWorkspaceDto,
  ): Promise<WorkspaceRow> {
    return this.workspaces.update(workspaceId, body);
  }
}
