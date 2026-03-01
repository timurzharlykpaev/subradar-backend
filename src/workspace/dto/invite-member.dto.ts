import { IsEmail, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WorkspaceMemberRole } from '../entities/workspace-member.entity';

export class InviteMemberDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ enum: WorkspaceMemberRole })
  @IsOptional()
  @IsEnum(WorkspaceMemberRole)
  role?: WorkspaceMemberRole = WorkspaceMemberRole.MEMBER;
}
