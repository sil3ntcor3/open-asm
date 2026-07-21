import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the columns populated by the nmap service-discovery step
 * (ToolCategory.SERVICE_DISCOVERY) to asset_services:
 *   - service: nmap protocol label (http, ssl/http, ftp, smtp, imap, ...)
 *   - product: identified software (e.g. "Apache httpd")
 *   - scheme:  http/https, set ONLY for web services — the reliable, port-agnostic
 *              signal used to gate screenshot creation.
 * A partial index on scheme supports the "web services only" screenshot query.
 */
export class AddAssetServiceDiscoveryColumns1784900000000
  implements MigrationInterface
{
  name = 'AddAssetServiceDiscoveryColumns1784900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The nmap step introduces ToolCategory.SERVICE_DISCOVERY. tools.category and
    // jobs.category are Postgres enum columns, so the new value must be added to
    // both enum types or seeding the nmap tool (and creating nmap jobs) fails.
    // ADD VALUE IF NOT EXISTS is idempotent and, on PostgreSQL 12+, is allowed
    // inside the migration transaction as long as the value is not *used* in the
    // same transaction (this migration only adds it).
    await queryRunner.query(
      `ALTER TYPE "tools_category_enum" ADD VALUE IF NOT EXISTS 'service_discovery'`,
    );
    await queryRunner.query(
      `ALTER TYPE "jobs_category_enum" ADD VALUE IF NOT EXISTS 'service_discovery'`,
    );

    await queryRunner.query(
      `ALTER TABLE "asset_services" ADD "service" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "asset_services" ADD "product" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "asset_services" ADD "scheme" character varying`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_asset_services_scheme" ON "asset_services" ("scheme") WHERE "scheme" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_asset_services_scheme"`);
    await queryRunner.query(
      `ALTER TABLE "asset_services" DROP COLUMN "scheme"`,
    );
    await queryRunner.query(
      `ALTER TABLE "asset_services" DROP COLUMN "product"`,
    );
    await queryRunner.query(
      `ALTER TABLE "asset_services" DROP COLUMN "service"`,
    );
  }
}
