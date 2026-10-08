import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAssetDnsResolutionStatusAndJobTerminalDetails1784800000000
  implements MigrationInterface
{
  name = 'AddAssetDnsResolutionStatusAndJobTerminalDetails1784800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "public"."assets_dnsresolutionstatus_enum"
      AS ENUM('unknown', 'resolved', 'unresolved')
    `);
    await queryRunner.query(`
      ALTER TABLE "assets"
      ADD "dnsResolutionStatus" "public"."assets_dnsresolutionstatus_enum"
      NOT NULL DEFAULT 'unknown'
    `);
    await queryRunner.query(`
      UPDATE "assets"
      SET "dnsResolutionStatus" = CASE
        WHEN "dnsRecords" IS NULL THEN 'unknown'::"public"."assets_dnsresolutionstatus_enum"
        WHEN CASE
          WHEN jsonb_typeof("dnsRecords"::jsonb -> 'A') = 'array'
          THEN jsonb_array_length("dnsRecords"::jsonb -> 'A')
          ELSE 0
        END > 0 OR CASE
          WHEN jsonb_typeof("dnsRecords"::jsonb -> 'AAAA') = 'array'
          THEN jsonb_array_length("dnsRecords"::jsonb -> 'AAAA')
          ELSE 0
        END > 0 THEN 'resolved'::"public"."assets_dnsresolutionstatus_enum"
        ELSE 'unresolved'::"public"."assets_dnsresolutionstatus_enum"
      END
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_assets_targetId_isEnabled_dnsResolutionStatus"
      ON "assets" ("targetId", "isEnabled", "dnsResolutionStatus")
    `);
    await queryRunner.query(`
      ALTER TABLE "job_error_log"
      ALTER COLUMN "logMessage" TYPE text,
      ALTER COLUMN "payload" TYPE text
    `);
    await queryRunner.query(`
      UPDATE "jobs"
      SET "completedAt" = "updatedAt"
      WHERE status IN ('failed', 'cancelled')
        AND "completedAt" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "job_error_log"
      ALTER COLUMN "logMessage" TYPE character varying USING LEFT("logMessage", 255),
      ALTER COLUMN "payload" TYPE character varying USING LEFT("payload", 255)
    `);
    await queryRunner.query(`
      DROP INDEX "public"."IDX_assets_targetId_isEnabled_dnsResolutionStatus"
    `);
    await queryRunner.query(
      `ALTER TABLE "assets" DROP COLUMN "dnsResolutionStatus"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."assets_dnsresolutionstatus_enum"`,
    );
  }
}
