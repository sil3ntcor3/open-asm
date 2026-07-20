import { forwardRef, Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKeysModule } from '../apikeys/apikeys.module';
import { WorkspaceTarget } from '../targets/entities/workspace-target.entity';
import { WorkflowsModule } from '../workflows/workflows.module';
import { WorkspaceMembers } from './entities/workspace-members.entity';
import { Workspace } from './entities/workspace.entity';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';
import { WorkspacePolicyService } from '@/common/authorization/workspace-policy.service';
import { WorkspacePolicyGuard } from '@/common/authorization/workspace-policy.guard';
import { User } from '../auth/entities/user.entity';
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Workspace,
      WorkspaceMembers,
      WorkspaceTarget,
      User,
    ]),
    ApiKeysModule,
    forwardRef(() => WorkflowsModule),
  ],
  controllers: [WorkspacesController],
  providers: [WorkspacesService, WorkspacePolicyService, WorkspacePolicyGuard],
  exports: [WorkspacesService, WorkspacePolicyService, WorkspacePolicyGuard],
})
export class WorkspacesModule {}
