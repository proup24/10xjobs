import './environment';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';

import * as Sentry from '@sentry/node';

import { AppModule } from 'src/app';
import { getAppConfig, getSystemDomain } from 'src/config';
import { setupSwagger } from 'src/swagger';
import type { EnvironmentVariables } from 'src/config';
import { EnvironmentType } from 'src/common/enums';
import { getHostName } from 'src/utils';
import { CorseConfig } from './cors';
import { traceIdMiddleware } from 'src/common/middleware';

const APP_CONFIG = {
  name: 'MAIN FILE',
  message: (port: number, nodeEnv: EnvironmentType) =>
    `10xJobs HAS STARTED AND IT IS LISTENING ON PORT :${port} IN SERVER : ${getHostName()} IN THE MODE OF : ${nodeEnv}`,
  prefix: 'api',
};
/**
 * @function log
 * @description
 * @param logger
 * @param port
 * @param nodeEnv
 */
function log(logger: Logger, port: number, nodeEnv: EnvironmentType) {
  logger.log(APP_CONFIG.message(port, nodeEnv));
}
/**
 * @function configure
 * @description
 * @param app
 * @param dsn
 * @param nodeEnv
 */
function configure(
  app: NestExpressApplication,
  dsn: string | undefined,
  nodeEnv: EnvironmentType,
  domain: string,
) {
  if (dsn) Sentry.init({ dsn, environment: nodeEnv });
  const validatorPipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const corsConfig = {
    origin: [CorseConfig(domain)],
    credentials: true,
    exposedHeaders: ['X-Trace-Id'],
  };

  // First, so every response and log line can carry the request's trace id.
  app.use(traceIdMiddleware);
  app.useGlobalPipes(validatorPipe);
  app.use(cookieParser());
  app.disable('x-powered-by');

  if (nodeEnv === EnvironmentType.development) {
    corsConfig.origin.push(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/);
  }
  app.enableCors(corsConfig);

  if (nodeEnv === EnvironmentType.development) setupSwagger(app);
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  app.setGlobalPrefix(APP_CONFIG.prefix);
  app.enableShutdownHooks();

  const logger = new Logger(APP_CONFIG.name);
  const configService =
    app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
  const { host, port, nodeEnv, sentryDsn } = getAppConfig(configService);
  const domain = getSystemDomain(configService);

  configure(app, sentryDsn, nodeEnv, domain);
  await app.listen(port, host);
  if (process.env.NX_READY_SIGNAL_SOCKET) {
    try {
      const load = new Function('s', 'return import(s)') as (
        s: string,
      ) => Promise<{ emitReadySignal(server: unknown): boolean }>;
      (await load('@nx/js/ready-signal')).emitReadySignal(app.getHttpServer());
    } catch {
      // Nx is optional outside the development workspace.
    }
  }
  log(logger, port, nodeEnv);
}

void bootstrap().catch(async (error: unknown) => {
  Logger.error(error, undefined, 'Bootstrap');
  Sentry.captureException(error);
  await Sentry.flush(2000);
  process.exit(1);
});
