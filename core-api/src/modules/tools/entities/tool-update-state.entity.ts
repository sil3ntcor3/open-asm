import { BaseEntity } from '@/common/entities/base.entity';
import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { Tool } from './tools.entity';

export interface ToolReleaseArtifact {
  name: string;
  url: string;
  sha256: string;
}

@Entity('tool_update_states')
@Unique('UQ_tool_update_states_tool_component', ['toolId', 'component'])
export class ToolUpdateState extends BaseEntity {
  @ApiProperty()
  @Column({ type: 'uuid' })
  toolId: string;

  @ManyToOne(() => Tool, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'toolId' })
  tool?: Tool;

  @ApiProperty()
  @Column({ type: 'varchar', length: 64 })
  component: string;

  @ApiProperty()
  @Column({ type: 'varchar', length: 96 })
  displayName: string;

  @ApiProperty()
  @Column({ type: 'varchar', length: 128 })
  sourceRepository: string;

  @ApiProperty({ required: false, nullable: true, type: String })
  @Column({ type: 'varchar', length: 64, nullable: true })
  latestVersion?: string | null;

  @ApiProperty({ required: false, nullable: true, type: String })
  @Column({ type: 'varchar', length: 512, nullable: true })
  releaseUrl?: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    type: String,
    format: 'date-time',
  })
  @Column({ type: 'timestamptz', nullable: true })
  releasePublishedAt?: Date | null;

  @ApiProperty({
    required: false,
    nullable: true,
    type: String,
    format: 'date-time',
  })
  @Column({ type: 'timestamptz', nullable: true })
  lastCheckedAt?: Date | null;

  @ApiProperty({ required: false, nullable: true, type: String })
  @Column({ type: 'varchar', length: 1024, nullable: true })
  checkError?: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  artifacts: ToolReleaseArtifact[];

  @ApiProperty({
    required: false,
    nullable: true,
    type: String,
    format: 'uuid',
  })
  @Column({ type: 'uuid', nullable: true })
  requestId?: string | null;

  @ApiProperty({ required: false, nullable: true, type: String })
  @Column({ type: 'varchar', length: 64, nullable: true })
  requestedVersion?: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    type: String,
    format: 'date-time',
  })
  @Column({ type: 'timestamptz', nullable: true })
  requestedAt?: Date | null;

  @ApiProperty({ required: false, nullable: true, type: String })
  @Column({ type: 'varchar', length: 128, nullable: true })
  requestedBy?: string | null;
}
