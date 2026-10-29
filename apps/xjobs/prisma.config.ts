import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';
import { loadDatabaseEnvironment } from './src/config';

const env = loadDatabaseEnvironment();

export default definePrismaConfig({
  orm: ormConfig({
    contract: './src/database/contract.prisma',
    migrations: { dir: 'src/database/migrations' },
    db: {
      connection: env.DIRECT_DATABASE_URL ?? env.DATABASE_URL,
    },
  }),
});
