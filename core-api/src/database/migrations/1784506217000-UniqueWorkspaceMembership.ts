import { MigrationInterface, QueryRunner } from 'typeorm';

export class UniqueWorkspaceMembership1784506217000 implements MigrationInterface {
  name = 'UniqueWorkspaceMembership1784506217000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_wm_workspace_user"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_wm_workspace_user" ON "workspace_members" ("workspaceId", "userId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_wm_workspace_user"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_wm_workspace_user" ON "workspace_members" ("workspaceId", "userId")`,
    );
  }
}
