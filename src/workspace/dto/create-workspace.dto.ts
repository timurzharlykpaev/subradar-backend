import { IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateWorkspaceDto {
  // Workspace name appears in the mobile header, member-detail sheets,
  // and audit log metadata. Hard-cap at 80 chars so a multi-MB payload
  // can't sneak past validation pipe (the global validator runs
  // `@MaxLength` before the controller body parser can choke on it).
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;
}
