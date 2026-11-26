import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/database';
import { WEBHOOK_CONFIG } from '../config/webhooks.config';
import { CallbacksController } from './callbacks.controller';
import {
  CallbacksRepository,
  PrismaCallbacksRepository,
} from './callbacks.repository';
import { CallbackThrottle } from './throttle';

/** The API's signed callback route a user's webhook receiver calls. */
@Module({
  imports: [DatabaseModule],
  controllers: [CallbacksController],
  providers: [
    { provide: CallbacksRepository, useClass: PrismaCallbacksRepository },
    {
      provide: CallbackThrottle,
      useFactory: () => new CallbackThrottle(WEBHOOK_CONFIG.callbackPerMinute),
    },
  ],
})
export class CallbacksModule {}
