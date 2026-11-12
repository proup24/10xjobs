import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet } from 'jose';
import { getStorageConfig, type EnvironmentVariables } from 'src/config';
import {
  USER_TOKEN_ISSUER,
  USER_TOKEN_KEYS,
  UserTokenVerifier,
} from './services';

type Config = ConfigService<EnvironmentVariables, true>;

/** `createRemoteJWKSet` is lazy, so boot never fetches the keys. */
@Global()
@Module({
  providers: [
    {
      provide: USER_TOKEN_KEYS,
      inject: [ConfigService],
      useFactory: (config: Config) =>
        createRemoteJWKSet(
          new URL(
            `${getStorageConfig(config).supabaseUrl}/auth/v1/.well-known/jwks.json`,
          ),
        ),
    },
    {
      provide: USER_TOKEN_ISSUER,
      inject: [ConfigService],
      useFactory: (config: Config) =>
        `${getStorageConfig(config).supabaseUrl}/auth/v1`,
    },
    UserTokenVerifier,
  ],
  exports: [UserTokenVerifier],
})
export class AuthModule {}
