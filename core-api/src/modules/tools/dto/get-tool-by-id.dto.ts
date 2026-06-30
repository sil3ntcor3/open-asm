import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class GetToolByIdDto {
  @ApiProperty({
    description: 'The ID of the tool',
  })
  @IsUUID() // Accept UUID v4 and v7; rejects malformed ids (e.g. "undefined") with a 400 instead of a 500
  id: string;
}
