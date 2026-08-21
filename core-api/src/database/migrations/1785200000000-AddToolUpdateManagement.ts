import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddToolUpdateManagement1785200000000 implements MigrationInterface {
  name = 'AddToolUpdateManagement1785200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "workers"
      ADD COLUMN "toolStatuses" jsonb NOT NULL DEFAULT '{}'::jsonb
    `);
    await queryRunner.query(`
      CREATE TABLE "tool_update_states" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "toolId" uuid NOT NULL,
        "component" character varying(64) NOT NULL,
        "displayName" character varying(96) NOT NULL,
        "sourceRepository" character varying(128) NOT NULL,
        "latestVersion" character varying(64),
        "releaseUrl" character varying(512),
        "releasePublishedAt" TIMESTAMP WITH TIME ZONE,
        "lastCheckedAt" TIMESTAMP WITH TIME ZONE,
        "checkError" character varying(1024),
        "artifacts" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "requestId" uuid,
        "requestedVersion" character varying(64),
        "requestedAt" TIMESTAMP WITH TIME ZONE,
        "requestedBy" character varying(128),
        CONSTRAINT "UQ_tool_update_states_tool_component" UNIQUE ("toolId", "component"),
        CONSTRAINT "PK_tool_update_states" PRIMARY KEY ("id"),
        CONSTRAINT "FK_tool_update_states_tool" FOREIGN KEY ("toolId") REFERENCES "tools"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "tool_update_states"`);
    await queryRunner.query(`ALTER TABLE "workers" DROP COLUMN "toolStatuses"`);
  }
}
