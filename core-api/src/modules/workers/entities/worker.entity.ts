import { BaseEntity } from '@/common/entities/base.entity';
import { WorkerScope, WorkerType } from '@/common/enums/enum';
import { InternalNetwork } from '@/modules/internal-networks/entities/internal-network.entity';
import { NetworkInterface } from '@/modules/internal-networks/entities/network-interface.entity';
import { Tool } from '@/modules/tools/entities/tools.entity';
import { Workspace } from '@/modules/workspaces/entities/workspace.entity';
import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';

export interface WorkerToolStatus {
  installedVersion?: string;
  state: 'ready' | 'pending' | 'updating' | 'succeeded' | 'failed';
  requestId?: string;
  targetVersion?: string;
  rollbackVersion?: string;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  error?: string;
}

@Entity('workers')
@Index('IDX_workers_token', ['token'])
@Index('IDX_workers_workspaceId', ['workspace'])
@Index('IDX_workers_toolId', ['tool'])
@Index('IDX_workers_internalNetworkId', ['internalNetwork'])
export class WorkerInstance extends BaseEntity {
  @ApiProperty()
  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  lastSeenAt: Date;

  @ApiProperty()
  @Column({ nullable: true })
  token: string;

  @ApiProperty({ required: false })
  @Column({ nullable: true })
  name: string;

  @ApiProperty({ required: false })
  @Column({ nullable: true })
  os: string;

  @ApiProperty({ required: false })
  @Column({ nullable: true })
  ipAddress: string;

  @ApiProperty()
  currentJobsCount?: number;

  @ApiProperty()
  @Column({ type: 'enum', enum: WorkerType, default: WorkerType.BUILT_IN })
  type: WorkerType;

  @ApiProperty()
  @Column({ type: 'enum', enum: WorkerScope, default: WorkerScope.WORKSPACE })
  scope: WorkerScope;

  @Column({ type: 'uuid', nullable: true })
  workspaceId: string;

  @ManyToOne(() => Workspace, (workspace) => workspace.workers, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'workspaceId' })
  workspace: Workspace;

  @Column({ type: 'uuid', nullable: true })
  toolId: string;

  @ApiProperty({ type: () => Tool })
  @ManyToOne(() => Tool, (tool) => tool.workers)
  @JoinColumn({ name: 'toolId' })
  tool: Tool;

  @ApiProperty()
  @IsUUID()
  @Column({ type: 'uuid', nullable: true })
  internalNetworkId?: string;

  @ManyToOne(
    () => InternalNetwork,
    (internalNetwork) => internalNetwork.workers,
    { nullable: true, onDelete: 'CASCADE' },
  )
  @JoinColumn({ name: 'internalNetworkId' })
  internalNetwork?: InternalNetwork;

  /**
   * Active tools on this worker.oin
   * For BUILT_IN workers: returns all built-in tools (array).
   * For PROVIDER workers: returns the current tool (array with single element).
   */
  @ApiProperty({ isArray: true, type: () => Tool })
  tools?: Tool[];

  @OneToMany(() => NetworkInterface, (ni) => ni.worker)
  networkInterfaces: NetworkInterface[];

  @ApiProperty({ required: false })
  @Column({ nullable: true, default: false })
  enabledAgentMode: boolean;

  /**
   * Desired max concurrent jobs for this worker instance.
   * Null means the worker uses its own local configuration
   * (WORKER_MAX_CONCURRENCY). Delivered to the worker on its
   * next control poll; shrinking takes effect as running jobs finish.
   */
  @ApiProperty({ required: false, nullable: true, type: Number })
  @Column({ type: 'int', nullable: true })
  maxConcurrency?: number | null;

  /**
   * When true the worker stops being handed new jobs (getNextJob
   * returns nothing and the worker suspends polling). Running jobs
   * are not affected.
   */
  @ApiProperty({ required: false })
  @Column({ default: false })
  isPaused: boolean;

  @ApiProperty({ required: false })
  isOnline?: boolean;

  @ApiProperty({ required: false, nullable: true, type: String })
  @Column({ type: 'varchar', length: 64, nullable: true })
  nucleiEngineVersion?: string | null;

  @ApiProperty({ required: false, nullable: true, type: String })
  @Column({ type: 'varchar', length: 64, nullable: true })
  nucleiTemplateVersion?: string | null;

  @ApiProperty({ required: false, nullable: true, type: String })
  @Column({ type: 'varchar', length: 128, nullable: true })
  nucleiTemplateSource?: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    type: String,
    enum: ['ready', 'refreshing', 'stale', 'error'],
  })
  @Column({ type: 'varchar', length: 16, nullable: true })
  nucleiTemplateStatus?: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    type: String,
    format: 'date-time',
  })
  @Column({ type: 'timestamptz', nullable: true })
  nucleiTemplateLastAttemptAt?: Date | null;

  @ApiProperty({
    required: false,
    nullable: true,
    type: String,
    format: 'date-time',
  })
  @Column({ type: 'timestamptz', nullable: true })
  nucleiTemplateLastSuccessAt?: Date | null;

  @ApiProperty({
    required: false,
    nullable: true,
    type: String,
    format: 'date-time',
  })
  @Column({ type: 'timestamptz', nullable: true })
  nucleiTemplateValidatedAt?: Date | null;

  @ApiProperty({ required: false, nullable: true, type: String })
  @Column({ type: 'varchar', length: 2048, nullable: true })
  nucleiTemplateLastError?: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    type: String,
    format: 'date-time',
  })
  @Column({ type: 'timestamptz', nullable: true })
  scannerStatusUpdatedAt?: Date | null;

  @ApiProperty({ required: false, type: Object })
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  toolStatuses: Record<string, WorkerToolStatus>;
}
