/**
 * Reviews the terms the processor proposed. A proposed term is never offered
 * to a model or matched until it is approved.
 *
 *   pnpm --filter @xjobs/xjobs db:vocab -- techTags list
 *   ... techTags approve <code> | reject <code> | alias <code> --to <approved code>
 *   ... cities list | approve <id> | reject <id> | alias <id> --as "<spelling>"
 *
 * A city change marks stale the facts of the jobs in the city's country, so the
 * match sweep builds them again and re-decides the jobs whose places changed.
 *
 * Opens the client directly, like `renormalize-jobs.ts`.
 */
import { Logger } from '@nestjs/common';
import { loadDatabaseEnvironment, toDatabaseConfig } from 'src/config';
import { createDatabaseClient, type DatabaseService } from 'src/database';
import { PrismaFactsRepository } from 'src/modules/facts/repositories/facts.repository';
import { PrismaVocabRepository } from 'src/modules/processor/repositories/vocab.repository';
import { parseVocabArgs } from './processor-args';
import { changeCity } from './vocab-cities';

async function main(): Promise<void> {
  const logger = new Logger('Vocab');
  const command = parseVocabArgs(process.argv.slice(2));
  const done = (
    changed: boolean,
    message: string,
    code: string,
    failure = 'not found or not proposed',
  ) => {
    if (changed) logger.log(message);
    else {
      logger.error(`${failure}: ${code}`);
      process.exitCode = 1;
    }
  };
  const db = createDatabaseClient(
    toDatabaseConfig(loadDatabaseEnvironment()),
    logger,
  );
  try {
    const database = { db } as DatabaseService;
    const vocab = new PrismaVocabRepository(database);
    if (command.list === 'cities') {
      if (command.action === 'list') {
        for (const c of await vocab.listProposedCities())
          console.log(`${c.id}\t${c.name}, ${c.countryCode}\t${c.occurrences}`);
        return;
      }
      const { changed, staleFacts } = await changeCity(command, {
        vocab,
        facts: new PrismaFactsRepository(database),
        cityCountry: async (id) =>
          (await db.orm.public.City.where({ id }).first())?.countryCode ?? null,
      });
      const what =
        command.action === 'alias'
          ? `Aliased city ${command.code} as ${command.spelling}`
          : command.action === 'approve'
            ? `Approved city ${command.code}`
            : `Rejected city ${command.code}`;
      done(
        changed,
        `${what}; marked ${staleFacts} job facts stale`,
        command.code,
        command.action === 'alias'
          ? 'not found or not approved'
          : 'not found or not proposed',
      );
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
