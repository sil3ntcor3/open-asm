import { BaseEntity } from '@/common/entities/base.entity';
import { JobHistory } from '@/modules/jobs-registry/entities/job-history.entity';
import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { AssetService } from './asset-services.entity';

class TlsInfo {
  @ApiProperty()
  @IsString()
  host: string;
  @ApiProperty()
  port: string;
  @ApiProperty()
  probe_status: boolean;
  @ApiProperty()
  tls_version: string;
  @ApiProperty()
  cipher: string;
  @ApiProperty()
  not_before: string;
  @ApiProperty()
  not_after: string;
  @ApiProperty()
  subject_dn: string;
  @ApiProperty()
  subject_cn: string;
  @ApiProperty()
  subject_an: string[];
  @ApiProperty()
  serial: string;
  @ApiProperty()
  issuer_dn: string;
  @ApiProperty()
  issuer_cn: string;
  @ApiProperty()
  issuer_org: string[];
  @ApiProperty()
  fingerprint_hash: {
    md5: string;
    sha1: string;
    sha256: string;
  };
  @ApiProperty()
  wildcard_certificate: boolean;
  @ApiProperty()
  tls_connection: string;
  @ApiProperty()
  sni: string;
}

// Interface cho Header information
interface HeaderInfo {
  [key: string]: string;
}

class KnowledgebaseInfo {
  @ApiProperty()
  PageType: string;
  @ApiProperty()
  pHash: number;
}

@Entity('http_responses')
@Index('IDX_http_jobHistoryId', ['jobHistory'])
@Index('IDX_http_host', ['host'])
export class HttpResponse extends BaseEntity {
  @ApiProperty()
  @Column({ type: 'timestamp with time zone', nullable: true })
  timestamp?: Date;

  @ApiProperty()
  @Column({ type: 'jsonb', nullable: true })
  tls: TlsInfo;

  @ApiProperty()
  @Column({ type: 'varchar', nullable: true })
  port?: string;

  @ApiProperty()
  @Column({ type: 'varchar', nullable: true })
  url?: string;

  @ApiProperty()
  @Column({ type: 'varchar', nullable: true })
  input: string;

  @ApiProperty()
  @Column({ type: 'text', nullable: true })
  title: string;

  @ApiProperty()
  @Column({ type: 'varchar', nullable: true })
  scheme: string;

  @ApiProperty()
  @Column({ type: 'varchar', nullable: true })
  webserver: string;

  @ApiProperty()
  @Column({ type: 'text', nullable: true })
  body: string;

  @ApiProperty()
  @Column({ type: 'varchar', nullable: true })
  content_type: string;

  @ApiProperty()
  @Column({ type: 'varchar', nullable: true })
  method: string;

  @ApiProperty()
  @Column({ type: 'varchar', nullable: true })
  host: string;

  @ApiProperty()
  @Column({ type: 'varchar', nullable: true })
  path: string;

  @ApiProperty()
  @Column({ type: 'varchar', nullable: true })
  favicon: string;

  @ApiProperty()
  @Column({ type: 'varchar', nullable: true })
  favicon_md5: string;

  @ApiProperty()
  @Column({ type: 'varchar', nullable: true })
  favicon_url: string;

  @ApiProperty()
  @Column({ type: 'jsonb', nullable: true })
  header: HeaderInfo;

  @ApiProperty()
  @Column({ type: 'text', nullable: true })
  raw_header: string;

  @ApiProperty()
  @Column({ type: 'text', nullable: true })
  request: string;

  @ApiProperty()
  @Column({ type: 'varchar', nullable: true })
  time: string;

  @ApiProperty()
  @Column({ array: true, type: 'varchar', nullable: true })
  a: string[];

  @ApiProperty()
  @Column({ array: true, type: 'varchar', nullable: true })
  aaaa: string[];

  /**
   * Resolved address httpx actually connected to. The `a` array lists every
   * address the name resolves to; this is the one that answered, so it is the
   * key that ties a hostname-anchored probe back to the IP whose ports were
   * scanned.
   */
  @ApiProperty()
  @Column({ type: 'varchar', nullable: true })
  host_ip: string;

  @ApiProperty()
  @Column({ array: true, type: 'varchar', nullable: true })
  cname: string[];

  /**
   * CDN/WAF classification from httpx's `-cdn` probe (cdncheck). This is the
   * signal that distinguishes "the port answered because a service is listening"
   * from "the port answered because an edge absorbs every connection" — the
   * difference between a real exposure and a phantom one. cdn_type is the more
   * useful of the pair: it separates `cdn` from `waf`.
   *
   * Coverage is range-based, so it is a positive signal only: cdn=null means
   * "not in cdncheck's ranges", NOT "not fronted".
   */
  @ApiProperty()
  @Column({ type: 'boolean', nullable: true })
  cdn: boolean;

  @ApiProperty()
  @Column({ type: 'varchar', nullable: true })
  cdn_name: string;

  @ApiProperty()
  @Column({ type: 'varchar', nullable: true })
  cdn_type: string;

  @ApiProperty()
  @Index({ fulltext: true }) // For GIN index on array
  @Column({ array: true, type: 'varchar', nullable: true })
  tech: string[];

  @ApiProperty()
  @Column({ type: 'integer', nullable: true })
  words: number;

  @ApiProperty()
  @Column({ type: 'integer', nullable: true })
  lines: number;

  @ApiProperty()
  @Column({ type: 'integer', nullable: true })
  status_code: number;

  @ApiProperty()
  @Column({ type: 'integer', nullable: true })
  content_length: number;

  @ApiProperty()
  @Column({ type: 'boolean', default: false })
  failed: boolean;

  @ApiProperty()
  @Column({ type: 'jsonb', nullable: true })
  knowledgebase: KnowledgebaseInfo;

  @ApiProperty()
  @Column({ array: true, type: 'varchar', nullable: true })
  resolvers: string[];

  @ApiProperty()
  @Column({ array: true, type: 'varchar', nullable: true })
  chain_status_codes: string[];

  @ApiProperty()
  @Index(['assetServiceId', 'createdAt'])
  @Column({ type: 'varchar', nullable: true })
  assetServiceId: string;

  @ManyToOne(() => AssetService, (assetService) => assetService.httpResponses, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'assetServiceId' })
  assetService: AssetService;

  @ApiProperty()
  @Column({ type: 'varchar', nullable: true })
  jobHistoryId: string;

  @ManyToOne(() => JobHistory, (jobHistory) => jobHistory.httpResponses, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'jobHistoryId' })
  jobHistory: JobHistory;
}
