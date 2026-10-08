import { BaseEntity } from '@/common/entities/base.entity';
import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { Job } from './job.entity';

@Entity()
@Index('IDX_job_error_logs_jobId', ['jobId'])
export class JobErrorLog extends BaseEntity {
  @ApiProperty()
  @Column({ type: 'text' })
  logMessage: string;
  @ApiProperty()
  @Column({ type: 'text' })
  payload: string;
  @ApiProperty()
  @Column({ nullable: true })
  jobId: string;
  @ManyToOne(() => Job, (job) => job.errorLogs, { onDelete: 'CASCADE' })
  job: Job;
}
