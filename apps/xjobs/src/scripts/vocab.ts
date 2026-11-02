/**
 * Reviews the terms the processor proposed. A proposed term is never offered
 * to a model or matched until it is approved.
 *
 *   pnpm --filter @xjobs/xjobs db:vocab -- techTags list
 *   ... techTags approve <code> | reject <code> | alias <code> --to <approved code>
 *   ... cities list | approve <id> | reject <id>
 *
 * Opens the client directly, like `renormalize-jobs.ts`.
 */
import { Logger } from '@nestjs/common';
import { loadDatabaseEnvironment, toDatabaseConfig } from 'src/config';
import { createDatabaseClient } from 'src/database/connection.source';
import { PrismaVocabRepository } from 'src/modules/processor/repositories/vocab.repository';
import type { DatabaseService } from 'src/database';
import { parseVocabArgs } from './processor-args';

async function main(): Promise<void> {
  const logger = new Logger('Vocab');
  const command = parseVocabArgs(process.argv.slice(2));
  const done = (changed: boolean, message: string, code: string) => {
    if (changed) logger.log(message);
    else {
      logger.error(`not found or not proposed: ${code}`);
      process.exitCode = 1;
    }
  };
  const db = createDatabaseClient(
    toDatabaseConfig(loadDatabaseEnvironment()),
    logger,
  );
  try {
    const vocab = new PrismaVocabRepository({ db } as DatabaseService);
    if (command.list === 'cities') {
      if (command.action === 'list') {
        for (const c of await vocab.listProposedCities())
          console.log(`${c.id}\t${c.name}, ${c.countryCode}\t${c.occurrences}`);
      } else if (command.action === 'approve') {
        done(
          await vocab.approveCity(command.code),
          `Approved city ${command.code}`,
          command.code,
        );
      } else if (command.action === 'reject') {
        done(
          await vocab.rejectCity(command.code),
          `Rejected city ${command.code}`,
          command.code,
        );
      }
      return;
    }
    const list = command.list;
    if (command.action === 'list') {
      for (const t of await vocab.listProposed(list))
        console.log(
          `${t.code}\t${t.label}\t${t.occurrences}\t${t.aliases.join(', ')}`,
        );
    } else if (command.action === 'approve') {
      done(
        await vocab.approve(list, command.code),
        `Approved ${list}/${command.code}`,
        command.code,
      );
    } else if (command.action === 'reject') {
      done(
        await vocab.reject(list, command.code),
        `Rejected ${list}/${command.code}`,
        command.code,
      );
    } else if (command.action === 'alias') {
      await vocab.alias(list, command.code, command.to);
      logger.log(`Aliased ${list}/${command.code} to ${command.to}`);
    }
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  Logger.error(
    error instanceof Error ? error.message : String(error),
    undefined,
    'Vocab',
  );
  process.exit(1);
});
