import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddJobsIndexes1782200000000 implements MigrationInterface {
  name = 'AddJobsIndexes1782200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Performance fix for getNextJob (worker job polling).
    //
    // The existing "IDX_jobs_status_priority_createdAt" index is all-ascending,
    // but getNextJob orders by `priority DESC, createdAt ASC` (mixed direction).
    // Postgres cannot use an all-ascending index to satisfy a mixed-direction
    // ORDER BY, so it sorts the entire pending-job set on every poll, exceeding
    // statement_timeout under load. This partial index matches the query's
    // filter and sort direction exactly, allowing an ordered index scan with no
    // sort node, scoped to only pending rows.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_jobs_pending_priority_createdAt" ON "jobs" ("priority" DESC, "createdAt" ASC) WHERE "status" = 'pending'`,
    );

    // The indexes below are declared on the Job entity. They exist on databases
    // that were previously synchronized, but are created here (IF NOT EXISTS) so
    // fresh, migration-only databases get them too.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_jobs_status_priority_createdAt" ON "jobs" ("status", "priority", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_jobs_asset_status" ON "jobs" ("assetId", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_jobs_tool" ON "jobs" ("toolId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_jobs_workerId_status" ON "jobs" ("workerId", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_jobs_jobHistoryId" ON "jobs" ("jobHistoryId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_jobs_assetServiceId" ON "jobs" ("assetServiceId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_jobs_category_status" ON "jobs" ("category", "status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_jobs_category_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_jobs_assetServiceId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_jobs_jobHistoryId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_jobs_workerId_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_jobs_tool"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_jobs_asset_status"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_jobs_status_priority_createdAt"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_jobs_pending_priority_createdAt"`,
    );
  }
}
