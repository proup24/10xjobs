import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';
import supabasePack from '@prisma/orm-extension-supabase/pack';
import { loadDatabaseEnvironment } from './src/env';

const env = loadDatabaseEnvironment();

export default definePrismaConfig({
  orm: ormConfig({
    contract: './src/contract/contract.prisma',
    extensions: [supabasePack],
    migrations: { dir: 'src/migrations' },
    db: {
      connection: env.DIRECT_DATABASE_URL ?? env.DATABASE_URL,
    },
  }),
});
