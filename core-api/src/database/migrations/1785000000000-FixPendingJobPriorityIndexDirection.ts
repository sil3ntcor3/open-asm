import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixPendingJobPriorityIndexDirection1785000000000
  implements MigrationInterface
{
  name = 'FixPendingJobPriorityIndexDirection1785000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Realigns the dispatch index with the corrected getNextJob sort.
    //
    // JobPriority is CRITICAL=0 .. BACKGROUND=4 — urgency rises as the value
    // falls — so getNextJob now orders by `priority ASC, createdAt ASC` rather
    // than the inverted `priority DESC`. AddJobsIndexes1782200000000 built this
    // partial index as ("priority" DESC, "createdAt" ASC) to match the old sort;
    // a mixed-direction index cannot serve an all-ascending ORDER BY, so leaving
    // it would push every worker poll back to a full sort of the pending set.
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_jobs_pending_priority_createdAt"`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_jobs_pending_priority_createdAt" ON "jobs" ("priority" ASC, "createdAt" ASC) WHERE "status" = 'pending'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_jobs_pending_priority_createdAt"`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_jobs_pending_priority_createdAt" ON "jobs" ("priority" DESC, "createdAt" ASC) WHERE "status" = 'pending'`,
    );
  }
}
