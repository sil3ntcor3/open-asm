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
import {
  WorkspaceAccessRole,
  WorkspaceRolePermission,
} from './entities/workspace-access-role.entity';
import { WorkspaceRolesService } from './workspace-roles.service';
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Workspace,
      WorkspaceMembers,
      WorkspaceTarget,
      User,
      WorkspaceAccessRole,
      WorkspaceRolePermission,
    ]),
    ApiKeysModule,
    forwardRef(() => WorkflowsModule),
  ],
  controllers: [WorkspacesController],
  providers: [
    WorkspacesService,
    WorkspaceRolesService,
    WorkspacePolicyService,
    WorkspacePolicyGuard,
  ],
  exports: [
    WorkspacesService,
    WorkspaceRolesService,
    WorkspacePolicyService,
    WorkspacePolicyGuard,
  ],
})
export class WorkspacesModule {}
