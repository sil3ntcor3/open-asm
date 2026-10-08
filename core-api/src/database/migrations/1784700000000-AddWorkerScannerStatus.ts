import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWorkerScannerStatus1784700000000 implements MigrationInterface {
  name = 'AddWorkerScannerStatus1784700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "workers"
      ADD COLUMN "nucleiEngineVersion" character varying(64),
      ADD COLUMN "nucleiTemplateVersion" character varying(64),
      ADD COLUMN "nucleiTemplateSource" character varying(128),
      ADD COLUMN "nucleiTemplateStatus" character varying(16),
      ADD COLUMN "nucleiTemplateLastAttemptAt" TIMESTAMP WITH TIME ZONE,
      ADD COLUMN "nucleiTemplateLastSuccessAt" TIMESTAMP WITH TIME ZONE,
      ADD COLUMN "nucleiTemplateValidatedAt" TIMESTAMP WITH TIME ZONE,
      ADD COLUMN "nucleiTemplateLastError" character varying(2048),
      ADD COLUMN "scannerStatusUpdatedAt" TIMESTAMP WITH TIME ZONE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "workers"
      DROP COLUMN "scannerStatusUpdatedAt",
      DROP COLUMN "nucleiTemplateLastError",
      DROP COLUMN "nucleiTemplateValidatedAt",
      DROP COLUMN "nucleiTemplateLastSuccessAt",
      DROP COLUMN "nucleiTemplateLastAttemptAt",
      DROP COLUMN "nucleiTemplateStatus",
      DROP COLUMN "nucleiTemplateSource",
      DROP COLUMN "nucleiTemplateVersion",
      DROP COLUMN "nucleiEngineVersion"
    `);
  }
}
