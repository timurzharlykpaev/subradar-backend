import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { WorkspaceMemberRole } from '../entities/workspace-member.entity';

// Roles a caller can DEMOTE/PROMOTE a member to via this endpoint.
// OWNER excluded for the same reason as InviteMemberDto: ownership
// changes go through /transfer-owner where they get an explicit
// confirmation + audit trail, not a silent role flip.
const ASSIGNABLE_ROLES = [
  WorkspaceMemberRole.MEMBER,
  WorkspaceMemberRole.ADMIN,
] as const;

export class ChangeMemberRoleDto {
  @ApiProperty({ enum: ASSIGNABLE_ROLES })
  @IsIn(ASSIGNABLE_ROLES as readonly string[])
  role: (typeof ASSIGNABLE_ROLES)[number];
}
