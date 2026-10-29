import { Module } from '@nestjs/common';
import { WorkspacesController } from './controllers/workspaces.controller';
import {
  PrismaWorkspacesRepository,
  WorkspacesRepository,
} from './repositories/workspaces.repository';
import { WorkspacesService } from './services/workspaces.service';

@Module({
  controllers: [WorkspacesController],
  providers: [
    WorkspacesService,
    { provide: WorkspacesRepository, useClass: PrismaWorkspacesRepository },
  ],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}
