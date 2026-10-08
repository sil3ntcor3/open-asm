import type { MigrationInterface, QueryRunner } from 'typeorm';

type ProtectedRoleSeed = {
  id: string;
  key: string;
  name: string;
  description: string;
  permissions: string[];
};

const allActions = [
  'workspace.read',
  'workspace.manage',
  'secret.manage',
  'target.create',
  'target.manage',
  'scan.execute',
  'finding.triage',
  'report.manage',
  'agent.use',
  'agent.manage',
  'member.manage',
  'role.manage',
  'worker.read',
  'worker.manage',
  'tool.manage',
  'template.manage',
];

const protectedRoles: ProtectedRoleSeed[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    key: 'viewer',
    name: 'Viewer',
    description: 'Read-only access to workspace data and worker status.',
    permissions: ['workspace.read', 'worker.read'],
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    key: 'analyst',
    name: 'Analyst',
    description: 'Creates targets, triages findings, and produces reports.',
    permissions: [
      'workspace.read',
      'target.create',
      'finding.triage',
      'report.manage',
      'agent.use',
      'worker.read',
    ],
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    key: 'operator',
    name: 'Operator',
    description: 'Manages targets and operates approved discovery jobs.',
    permissions: [
      'workspace.read',
      'target.create',
      'target.manage',
      'scan.execute',
      'finding.triage',
      'report.manage',
      'agent.use',
      'worker.read',
    ],
  },
  {
    id: '00000000-0000-4000-8000-000000000004',
    key: 'security_admin',
    name: 'Security Administrator',
    description: 'Controls scans, workers, tools, templates, and secrets.',
    permissions: [
      'workspace.read',
      'secret.manage',
      'scan.execute',
      'finding.triage',
      'report.manage',
      'agent.use',
      'agent.manage',
      'worker.read',
      'worker.manage',
      'tool.manage',
      'template.manage',
    ],
  },
  {
    id: '00000000-0000-4000-8000-000000000005',
    key: 'owner',
    name: 'Owner',
    description: 'Has every permission within the workspace.',
    permissions: allActions,
  },
];

export class RelationalWorkspaceRoles1784600000000
  implements MigrationInterface
{
  name = 'RelationalWorkspaceRoles1784600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "workspace_roles" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "key" text,
        "name" text NOT NULL,
        "description" text NOT NULL DEFAULT '',
        "protected" boolean NOT NULL DEFAULT false,
        "workspaceId" uuid,
        CONSTRAINT "PK_workspace_roles" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_workspace_roles_scope" CHECK (
          ("protected" = true AND "workspaceId" IS NULL AND "key" IS NOT NULL)
          OR
          ("protected" = false AND "workspaceId" IS NOT NULL AND "key" IS NULL)
        ),
        CONSTRAINT "FK_workspace_roles_workspace" FOREIGN KEY ("workspaceId")
          REFERENCES "workspaces"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_workspace_roles_protected_key" ON "workspace_roles" ("key") WHERE "protected" = true`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_workspace_roles_custom_name" ON "workspace_roles" ("workspaceId", lower("name")) WHERE "protected" = false`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_workspace_roles_workspace" ON "workspace_roles" ("workspaceId")`,
    );
    await queryRunner.query(`
      CREATE TABLE "workspace_role_permissions" (
        "roleId" uuid NOT NULL,
        "action" text NOT NULL,
        CONSTRAINT "PK_workspace_role_permissions" PRIMARY KEY ("roleId", "action"),
        CONSTRAINT "FK_workspace_role_permissions_role" FOREIGN KEY ("roleId")
          REFERENCES "workspace_roles"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_workspace_role_permissions_action" ON "workspace_role_permissions" ("action")`,
    );

    for (const role of protectedRoles) {
      await queryRunner.query(
        `INSERT INTO "workspace_roles" ("id", "key", "name", "description", "protected") VALUES ($1, $2, $3, $4, true)`,
        [role.id, role.key, role.name, role.description],
      );
      for (const action of role.permissions) {
        await queryRunner.query(
          `INSERT INTO "workspace_role_permissions" ("roleId", "action") VALUES ($1, $2)`,
          [role.id, action],
        );
      }
    }

    await queryRunner.query(
      `ALTER TABLE "workspace_members" ADD "roleId" uuid`,
    );
    await queryRunner.query(`
      UPDATE "workspace_members" AS membership
      SET "roleId" = role."id"
      FROM "workspace_roles" AS role
      WHERE role."key" = membership."role"::text AND role."protected" = true
    `);
    await queryRunner.query(
      `ALTER TABLE "workspace_members" ALTER COLUMN "roleId" SET NOT NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE "workspace_members"
      ADD CONSTRAINT "FK_workspace_members_role" FOREIGN KEY ("roleId")
      REFERENCES "workspace_roles"("id") ON DELETE RESTRICT
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_workspace_members_role" ON "workspace_members" ("roleId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspace_members" DROP COLUMN "role"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."workspace_members_role_enum"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."workspace_members_role_enum" AS ENUM('viewer', 'analyst', 'operator', 'security_admin', 'owner')`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspace_members" ADD "role" "public"."workspace_members_role_enum"`,
    );
    await queryRunner.query(`
      UPDATE "workspace_members" AS membership
      SET "role" = COALESCE(role."key", 'analyst')::"public"."workspace_members_role_enum"
      FROM "workspace_roles" AS role
      WHERE role."id" = membership."roleId"
    `);
    await queryRunner.query(
      `ALTER TABLE "workspace_members" ALTER COLUMN "role" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspace_members" ALTER COLUMN "role" SET DEFAULT 'analyst'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_workspace_members_role"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspace_members" DROP CONSTRAINT "FK_workspace_members_role"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspace_members" DROP COLUMN "roleId"`,
    );
    await queryRunner.query(
      `DROP TABLE "workspace_role_permissions"`,
    );
    await queryRunner.query(`DROP TABLE "workspace_roles"`);
  }
}
