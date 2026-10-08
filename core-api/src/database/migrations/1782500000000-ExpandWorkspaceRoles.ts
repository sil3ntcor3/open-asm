import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExpandWorkspaceRoles1782500000000
  implements MigrationInterface
{
  name = 'ExpandWorkspaceRoles1782500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."workspace_members_role_enum" RENAME TO "workspace_members_role_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."workspace_members_role_enum" AS ENUM('viewer', 'analyst', 'operator', 'security_admin', 'owner')`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspace_members" ALTER COLUMN "role" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspace_members" ALTER COLUMN "role" TYPE "public"."workspace_members_role_enum" USING (CASE WHEN "role"::text = 'member' THEN 'analyst' ELSE "role"::text END)::"public"."workspace_members_role_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspace_members" ALTER COLUMN "role" SET DEFAULT 'analyst'`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."workspace_members_role_enum_old"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."workspace_members_role_enum" RENAME TO "workspace_members_role_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."workspace_members_role_enum" AS ENUM('owner', 'member')`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspace_members" ALTER COLUMN "role" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspace_members" ALTER COLUMN "role" TYPE "public"."workspace_members_role_enum" USING (CASE WHEN "role"::text = 'owner' THEN 'owner' ELSE 'member' END)::"public"."workspace_members_role_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspace_members" ALTER COLUMN "role" SET DEFAULT 'owner'`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."workspace_members_role_enum_old"`,
    );
  }
}
