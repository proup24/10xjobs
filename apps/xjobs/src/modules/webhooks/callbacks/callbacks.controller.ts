import {
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Req,
  Res,
  UnauthorizedException,
  type RawBodyRequest,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { WEBHOOK_CONFIG } from '../config/webhooks.config';
import { CallbacksRepository } from './callbacks.repository';
import { parseCallbackBody } from './body';
import { CallbackThrottle } from './throttle';
import { verifyCallback } from './verify';

/**
 * A user's webhook receiver calls back here, signed with the webhook secret. Behind the
 * engine key like every route; the signature is the user's authentication. Answers its
 * own JSON (no envelope) by writing the response directly.
 */
@ApiExcludeController()
@Controller('webhooks/callback')
export class CallbacksController {
  private readonly logger = new Logger(CallbacksController.name);

  constructor(
    private readonly callbacks: CallbacksRepository,
    private readonly throttle: CallbackThrottle,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async callback(
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response,
  ): Promise<void> {
    const header = (name: string): string | undefined => {
      const value = req.headers[name];
      return Array.isArray(value) ? value[0] : value;
    };
    const webhookId = header('x-10xjobs-webhook');
    const received = header('x-10xjobs-signature');
    // Mounted raw (see callbackRawBody) the bytes are in req.body; rawBody covers other setups.
    const rawBody =
      req.rawBody ?? (Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));
    const now = new Date();

    const webhook = webhookId
      ? await this.callbacks.findWebhook(webhookId)
      : null;
    if (
      !webhook ||
      !received ||
      !verifyCallback({
        secret: webhook.secret,
        timestamp: header('x-10xjobs-timestamp'),
        received,
        rawBody,
        nowSeconds: now.getTime() / 1000,
        toleranceSeconds: WEBHOOK_CONFIG.callbackToleranceSeconds,
      })
    )
      throw new UnauthorizedException();

    if (!this.throttle.allow(webhook.id, now.getTime()))
      throw new HttpException(
        'Too many callbacks',
        HttpStatus.TOO_MANY_REQUESTS,
      );

    const outcome = await this.callbacks.record(
      webhook,
      received,
      parseCallbackBody(rawBody),
      now,
    );
    if (outcome === 'replay') throw new UnauthorizedException();

    this.logger.log(
      `webhook callback webhook=${webhook.id} result=${outcome.result}`,
    );
    res.status(HttpStatus.OK).json({ version: 1, ...outcome });
  }
}
