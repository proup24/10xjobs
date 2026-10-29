import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import { getStorageConfig, type EnvironmentVariables } from 'src/config';
import { StorageService } from './storage.service';
import { SupabaseStorageService } from './supabase-storage.service';

@Module({
  providers: [
    {
      provide: StorageService,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => {
        const { supabaseUrl, serviceRoleKey } = getStorageConfig(config);
        // Server-side only: no session to persist or refresh.
        const client = createClient(supabaseUrl, serviceRoleKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        return new SupabaseStorageService(client.storage);
      },
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
