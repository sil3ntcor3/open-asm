import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddJobsIndexes1782200000000 implements MigrationInterface {
  name = 'AddJobsIndexes1782200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // These indexes are declared on the Job entity but were never created in
    // the database. Without them, getNextJob performs a full sequential scan +
    // sort + FOR UPDATE SKIP LOCKED on every worker poll, causing statement
    // timeouts and severe API slowness as the jobs table grows.
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
  }
}
