import { ApiProperty, OmitType } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { GetAssetsQueryDto } from './assets.dto';

export enum AssetExportFormat {
  CSV = 'csv',
  XLSX = 'xlsx',
}

export enum AssetExportView {
  HOST = 'host',
  IP = 'ip',
  PORT = 'port',
  SERVICE = 'service',
  STATUS_CODE = 'status-code',
  TECHNOLOGY = 'technology',
  TLS = 'tls',
}

export class ExportAssetsQueryDto extends OmitType(GetAssetsQueryDto, [
  'limit',
  'page',
] as const) {
  @ApiProperty({ enum: AssetExportFormat })
  @IsEnum(AssetExportFormat)
  format: AssetExportFormat;

  @ApiProperty({ enum: AssetExportView })
  @IsEnum(AssetExportView)
  view: AssetExportView;
}
