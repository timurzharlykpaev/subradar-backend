import { IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * PATCH /workspace/:id used to read `body.name` straight off the
 * request without a DTO, which meant any non-string payload reached
 * the service and a multi-MB string crashed the audit logger
 * downstream. Same length contract as CreateWorkspaceDto so a rename
 * can't produce values that fail at insert time.
 */
export class RenameWorkspaceDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;
}
