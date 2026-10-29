import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { WorkspaceRow } from 'src/database';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { WorkspacesService } from './workspaces.service';

@ApiTags('workspaces')
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Post()
  create(@Body() body: CreateWorkspaceDto): Promise<WorkspaceRow> {
    return this.workspaces.create(body);
  }

  @Get()
  list(): Promise<WorkspaceRow[]> {
    return this.workspaces.list();
  }

  @Get(':workspaceId')
  get(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
  ): Promise<WorkspaceRow> {
    return this.workspaces.getOrThrow(workspaceId);
  }

  @Patch(':workspaceId')
  update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body() body: UpdateWorkspaceDto,
  ): Promise<WorkspaceRow> {
    return this.workspaces.update(workspaceId, body);
  }
}
