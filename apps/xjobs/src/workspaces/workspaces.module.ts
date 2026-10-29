import { Module } from '@nestjs/common';
import { WorkspacesController } from './workspaces.controller';
import {
  PrismaWorkspacesRepository,
  WorkspacesRepository,
} from './workspaces.repository';
import { WorkspacesService } from './workspaces.service';

@Module({
  controllers: [WorkspacesController],
  providers: [
    WorkspacesService,
    { provide: WorkspacesRepository, useClass: PrismaWorkspacesRepository },
  ],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}
