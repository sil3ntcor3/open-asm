import { BaseEntity } from '@/common/entities/base.entity';
import { User } from '@/modules/auth/entities/user.entity';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { WorkspaceAccessRole } from './workspace-access-role.entity';
import { Workspace } from './workspace.entity';

@Entity('workspace_members')
@Index('IDX_wm_workspace_user', ['workspace', 'user'], { unique: true })
@Index('IDX_wm_userId', ['user'])
export class WorkspaceMembers extends BaseEntity {
  @ManyToOne(() => Workspace, (workspace) => workspace.workspaceMembers, {
    cascade: true,
    onDelete: 'CASCADE',
  })
  workspace: Workspace;

  @ManyToOne(() => User, (user) => user.workspaceMembers, {
    cascade: true,
    onDelete: 'CASCADE',
  })
  user: User;

  @Column({ type: 'uuid' })
  roleId: string;

  @ManyToOne(() => WorkspaceAccessRole, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'roleId' })
  accessRole: WorkspaceAccessRole;
}
