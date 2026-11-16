import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseModule } from 'src/database';
import {
  PrismaWebhooksRepository,
  WebhooksRepository,
} from './repositories/webhooks.repository';
import {
  DeliveryService,
  WEBHOOK_SETTINGS,
  type WebhookSettings,
} from './services/delivery.service';

/** Sends the users' webhook deliveries: payload, signed POST, retries and hold-back. */
@Module({
  imports: [DatabaseModule],
  providers: [
    { provide: WebhooksRepository, useClass: PrismaWebhooksRepository },
    {
      provide: WEBHOOK_SETTINGS,
      inject: [ConfigService],
      useFactory: (
        config: ConfigService<{ WEB_APP_URL?: string }, true>,
      ): WebhookSettings => ({
        webAppUrl: config.get('WEB_APP_URL', { infer: true }) ?? null,
      }),
    },
    DeliveryService,
  ],
  exports: [DeliveryService, WebhooksRepository],
})
export class WebhooksModule {}
