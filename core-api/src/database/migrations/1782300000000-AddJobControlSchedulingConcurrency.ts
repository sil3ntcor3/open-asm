import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddJobControlSchedulingConcurrency1782300000000
  implements MigrationInterface
{
  name = 'AddJobControlSchedulingConcurrency1782300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Job control: new "paused" job status.
    // ALTER TYPE ... ADD VALUE cannot run inside a transaction block on
    // older Postgres; IF NOT EXISTS makes it idempotent for synced DBs.
    await queryRunner.query(
      `ALTER TYPE "public"."jobs_status_enum" ADD VALUE IF NOT EXISTS 'paused'`,
    );

    // 2. Runtime worker control: desired concurrency + worker-level pause.
    await queryRunner.query(
      `ALTER TABLE "workers" ADD COLUMN IF NOT EXISTS "maxConcurrency" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "workers" ADD COLUMN IF NOT EXISTS "isPaused" boolean NOT NULL DEFAULT false`,
    );

    // 3. Scheduling windows: per-target execution window.
    await queryRunner.query(
      `ALTER TABLE "targets" ADD COLUMN IF NOT EXISTS "scanWindowStart" time`,
    );
    await queryRunner.query(
      `ALTER TABLE "targets" ADD COLUMN IF NOT EXISTS "scanWindowEnd" time`,
    );
    await queryRunner.query(
      `ALTER TABLE "targets" ADD COLUMN IF NOT EXISTS "scanWindowTimezone" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "targets" ADD COLUMN IF NOT EXISTS "scanWindowDays" integer[]`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "targets" DROP COLUMN IF EXISTS "scanWindowDays"`,
    );
    await queryRunner.query(
      `ALTER TABLE "targets" DROP COLUMN IF EXISTS "scanWindowTimezone"`,
    );
    await queryRunner.query(
      `ALTER TABLE "targets" DROP COLUMN IF EXISTS "scanWindowEnd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "targets" DROP COLUMN IF EXISTS "scanWindowStart"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workers" DROP COLUMN IF EXISTS "isPaused"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workers" DROP COLUMN IF EXISTS "maxConcurrency"`,
    );
    // Postgres cannot remove a value from an enum type; jobs in 'paused'
    // state must be resumed/cancelled before a downgrade anyway, so the
    // enum value is intentionally left in place.
  }
}
