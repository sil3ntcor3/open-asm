import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Persists the httpx output the probe already requests but throws away.
 *
 * The httpx invocation has always passed `-cdn`, `-cname` and `-ip`, but
 * http_responses had no columns for the answers, so TypeORM silently dropped
 * them on insert. That left the pipeline unable to tell a real listening service
 * from a CDN/WAF edge absorbing every connection — the distinction that decides
 * whether a discovered port is an exposure or a phantom.
 *
 *   cdn / cdn_name / cdn_type  cdncheck classification ("cloudflare" / "waf")
 *   cname                      DNS chain, the second edge-fronting signal
 *   host_ip                    the address that actually answered, which ties a
 *                              hostname-anchored probe back to a scanned IP
 *   aaaa                       IPv6 addresses, previously discarded alongside `a`
 *
 * The partial index supports "show me everything behind an edge" without
 * penalising the common cdn IS NULL case.
 */
export class AddHttpResponseEdgeColumns1785100000000
  implements MigrationInterface
{
  name = 'AddHttpResponseEdgeColumns1785100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "http_responses" ADD "aaaa" character varying array`,
    );
    await queryRunner.query(
      `ALTER TABLE "http_responses" ADD "host_ip" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "http_responses" ADD "cname" character varying array`,
    );
    await queryRunner.query(
      `ALTER TABLE "http_responses" ADD "cdn" boolean`,
    );
    await queryRunner.query(
      `ALTER TABLE "http_responses" ADD "cdn_name" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "http_responses" ADD "cdn_type" character varying`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_http_responses_cdn" ON "http_responses" ("cdn") WHERE "cdn" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_http_responses_host_ip" ON "http_responses" ("host_ip") WHERE "host_ip" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_http_responses_host_ip"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_http_responses_cdn"`);
    await queryRunner.query(
      `ALTER TABLE "http_responses" DROP COLUMN "cdn_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "http_responses" DROP COLUMN "cdn_name"`,
    );
    await queryRunner.query(`ALTER TABLE "http_responses" DROP COLUMN "cdn"`);
    await queryRunner.query(`ALTER TABLE "http_responses" DROP COLUMN "cname"`);
    await queryRunner.query(
      `ALTER TABLE "http_responses" DROP COLUMN "host_ip"`,
    );
    await queryRunner.query(`ALTER TABLE "http_responses" DROP COLUMN "aaaa"`);
  }
}
