import { Module } from '@nestjs/common';
import { AdminAccess } from './admin-access';
import { AdminGuard } from './admin.guard';

@Module({
  providers: [AdminAccess, AdminGuard],
  exports: [AdminAccess, AdminGuard],
})
export class AdminModule {}
