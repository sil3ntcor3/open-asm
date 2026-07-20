import { WorkspaceAction } from '@/common/authorization/workspace-action.enum';
import { BaseEntity } from '@/common/entities/base.entity';
import { WorkspaceRole } from '@/common/enums/enum';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
} from 'typeorm';

@Entity('workspace_roles')
@Index('IDX_workspace_roles_workspace', ['workspaceId'])
export class WorkspaceAccessRole extends BaseEntity {
  @Column({ type: 'text', nullable: true })
  key: WorkspaceRole | null;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ type: 'boolean', default: false })
  protected: boolean;

  @Column({ type: 'uuid', nullable: true })
  workspaceId: string | null;

  @OneToMany(
    () => WorkspaceRolePermission,
    (permissionEntry) => permissionEntry.role,
    { cascade: true },
  )
  permissionEntries: WorkspaceRolePermission[];
}

@Entity('workspace_role_permissions')
@Index('IDX_workspace_role_permissions_action', ['action'])
export class WorkspaceRolePermission {
  @PrimaryColumn({ type: 'uuid' })
  roleId: string;

  @PrimaryColumn({ type: 'text' })
  action: WorkspaceAction;

  @ManyToOne(
    () => WorkspaceAccessRole,
    (role) => role.permissionEntries,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({ name: 'roleId' })
  role: WorkspaceAccessRole;
}
