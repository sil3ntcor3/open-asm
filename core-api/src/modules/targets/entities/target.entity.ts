import { BaseEntity } from '@/common/entities/base.entity';
import { CronSchedule, JobStatus } from '@/common/enums/enum';
import { Asset } from '@/modules/assets/entities/assets.entity';
import { InternalNetwork } from '@/modules/internal-networks/entities/internal-network.entity';
import { Logger } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { WorkspaceTarget } from './workspace-target.entity';

/**
 * Enum representing the type of target
 */
export enum TargetType {
  DOMAIN = 'DOMAIN',
  CIDR = 'CIDR',
  IP = 'IP',
}

@Entity('targets')
@Index('IDX_targets_value', ['value'])
@Index('IDX_targets_internalNetworkId', ['internalNetwork'])
@Index('IDX_targets_scanSchedule_jobId', ['scanSchedule', 'jobId'])
export class Target extends BaseEntity {
  @ApiProperty({
    example: 'example.com',
    description: 'The target value (domain, IP address, or CIDR notation)',
  })
  @IsString()
  @Transform(({ value }: { value: string }) => {
    try {
      // Check if it's a CIDR notation (e.g., 192.168.1.0/24)
      const cidrRegex = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
      if (cidrRegex.test(value)) {
        return value; // Return CIDR as-is
      }

      // Check if it's an IP address (e.g., 192.168.1.1)
      const ipRegex = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
      if (ipRegex.test(value)) {
        return value; // Return IP as-is
      }

      // Otherwise, treat as domain and extract hostname
      const hasProtocol = /^https?:\/\//.test(value);
      const url = new URL(hasProtocol ? value : `http://${value}`);
      return url.hostname;
    } catch (error) {
      Logger.error(error);
      return value;
    }
  })
  @Column({ type: 'varchar' })
  value: string;

  @ApiProperty({
    enum: TargetType,
    enumName: 'TargetType',
    description: 'The type of target (DOMAIN, CIDR, or IP)',
    example: TargetType.DOMAIN,
  })
  @IsEnum(TargetType)
  @Column({
    type: 'enum',
    enum: TargetType,
    default: TargetType.DOMAIN,
  })
  type: TargetType;

  @ApiProperty()
  @Column({
    type: 'timestamp',
    nullable: true,
    default: () => 'CURRENT_TIMESTAMP',
  })
  lastDiscoveredAt: Date;

  @Column({ default: 0 })
  reScanCount: number;

  @OneToMany(() => WorkspaceTarget, (workspaceTarget) => workspaceTarget.target)
  workspaceTargets: WorkspaceTarget[];

  @OneToMany(() => Asset, (asset) => asset.target)
  assets: Asset[];

  @ApiProperty()
  totalAssetServices: number;

  @ApiProperty({ enum: JobStatus, enumName: 'JobStatus' })
  status: JobStatus;

  @ApiProperty({ enum: CronSchedule, enumName: 'CronSchedule' })
  @IsOptional()
  @IsEnum(CronSchedule)
  @Column({
    type: 'enum',
    enum: CronSchedule,
    default: CronSchedule.DISABLED,
    nullable: true,
  })
  scanSchedule: CronSchedule;

  /**
   * Execution window during which jobs for this target may be dispatched
   * to workers (e.g. scan only 22:00–06:00 local time). Both start and end
   * must be set for the window to apply; when null, jobs dispatch at any
   * time. Windows crossing midnight (start > end) are supported. Jobs
   * created outside the window stay PENDING until it opens; jobs already
   * running when the window closes are allowed to finish.
   */
  @ApiProperty({ required: false, nullable: true, example: '22:00' })
  @Column({ type: 'time', nullable: true })
  scanWindowStart?: string | null;

  @ApiProperty({ required: false, nullable: true, example: '06:00' })
  @Column({ type: 'time', nullable: true })
  scanWindowEnd?: string | null;

  /** IANA timezone the window is evaluated in (defaults to UTC). */
  @ApiProperty({ required: false, nullable: true, example: 'America/Chicago' })
  @Column({ type: 'varchar', nullable: true })
  scanWindowTimezone?: string | null;

  /**
   * ISO days of week (1 = Monday … 7 = Sunday) the window applies to.
   * Null or empty means every day.
   */
  @ApiProperty({ required: false, nullable: true, type: [Number], example: [6, 7] })
  @Column({ type: 'int', array: true, nullable: true })
  scanWindowDays?: number[] | null;

  @Column({ nullable: true })
  jobId: string;

  @Column({ type: 'uuid', nullable: true })
  internalNetworkId: string;

  @ManyToOne(
    () => InternalNetwork,
    (internalNetwork) => internalNetwork.targets,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({ name: 'internalNetworkId' })
  internalNetwork: InternalNetwork;
}
