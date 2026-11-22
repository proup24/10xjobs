#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/102e61ccb77605cd7b61d1362d8667349060173f0c1fdade6bec81e50f63117f/contract';
import startContract from '../../snapshots/102e61ccb77605cd7b61d1362d8667349060173f0c1fdade6bec81e50f63117f/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/ec52f11675023da7974608e4e29057d636681a978f6b43e77012fe5d69eda55d/contract';
import endContract from '../../snapshots/ec52f11675023da7974608e4e29057d636681a978f6b43e77012fe5d69eda55d/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropCheckConstraint({
        schema: 'public',
        table: 'normalized_jobs',
        constraint: 'normalized_jobs_kind_e26544db',
      }),
      this.addColumn({
        schema: 'public',
        table: 'job_extractions',
        column: col('docType', 'text', {
          notNull: true,
          default: lit('listing'),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'job_extractions',
        column: col('verdict', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'job_extractions',
        column: col('verdictConfidence', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'job_extractions',
        column: col('verdictReason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'normalized_jobs',
        column: col('parentJobId', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'normalized_jobs',
        column: col('roleKey', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'processing_attempts',
        column: col('docType', 'text', {
          notNull: true,
          default: lit('listing'),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'job_extractions',
        constraint: 'job_extractions_doc_type_d12c61c3',
        expression: sql`"docType" IN ('listing', 'post')`,
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'normalized_jobs',
        constraint: 'normalized_jobs_kind_59dafe6b',
        expression: sql`kind IN ('job', 'post', 'post_role')`,
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'normalized_jobs',
        constraint: 'normalized_jobs_post_role_parent_e01760a6',
        expression: sql`(kind = 'post_role') = ("parentJobId" IS NOT NULL)`,
      }),
      this.addUnique({
        schema: 'public',
        table: 'normalized_jobs',
        constraint: 'normalized_jobs_parentJobId_roleKey_key',
        columns: ['parentJobId', 'roleKey'],
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'processing_attempts',
        constraint: 'processing_attempts_doc_type_d12c61c3',
        expression: sql`"docType" IN ('listing', 'post')`,
      }),
      this.createIndex({
        schema: 'public',
        table: 'normalized_jobs',
        index: 'normalized_jobs_parentJobId_idx_f90efd5f',
        columns: ['parentJobId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'normalized_jobs',
        index: 'normalized_jobs_pending_posts_0135ba82',
        columns: ['firstSeenAt'],
        extras: { where: sql`kind = 'post' AND "processingStatus" = 'pending'` },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'normalized_jobs',
        foreignKey: {
          name: 'normalized_jobs_parentJobId_fkey',
          columns: ['parentJobId'],
          references: { schema: 'public', table: 'normalized_jobs', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
