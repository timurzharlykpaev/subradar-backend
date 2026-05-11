import { IsEmail, IsIn, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WorkspaceMemberRole } from '../entities/workspace-member.entity';

// Roles a caller is allowed to ASSIGN via invite. OWNER is deliberately
// excluded: there's exactly one owner per workspace (the user who
// created it) and ownership transfer goes through the dedicated
// /transfer-owner endpoint, never through the invite flow. Accepting
// `role: 'OWNER'` in this DTO would let a workspace owner mint a
// second OWNER member row — a privilege-escalation surface even though
// the workspace.ownerId column stays unchanged.
const INVITABLE_ROLES = [
  WorkspaceMemberRole.MEMBER,
  WorkspaceMemberRole.ADMIN,
] as const;
type InvitableRole = (typeof INVITABLE_ROLES)[number];

export class InviteMemberDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ enum: INVITABLE_ROLES })
  @IsOptional()
  @IsIn(INVITABLE_ROLES as readonly string[])
  role?: InvitableRole = WorkspaceMemberRole.MEMBER;
}
