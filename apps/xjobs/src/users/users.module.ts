import { Module } from '@nestjs/common';
import { WorkspacesModule } from 'src/workspaces';
import { UsersController } from './users.controller';
import { PrismaUsersRepository, UsersRepository } from './users.repository';
import { UsersService } from './users.service';

@Module({
  imports: [WorkspacesModule],
  controllers: [UsersController],
  providers: [
    UsersService,
    { provide: UsersRepository, useClass: PrismaUsersRepository },
  ],
})
export class UsersModule {}
