import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveRemoteExecutionColumns1782600000000
  implements MigrationInterface
{
  name = 'RemoveRemoteExecutionColumns1782600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "agent_conversations" DROP COLUMN IF EXISTS "workerId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_message_tool_calls" DROP COLUMN IF EXISTS "workerId"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "agent_conversations" ADD COLUMN "workerId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_message_tool_calls" ADD COLUMN "workerId" uuid`,
    );
  }
}
