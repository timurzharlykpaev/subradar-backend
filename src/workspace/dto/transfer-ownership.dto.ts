import { IsUUID, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Body for POST /workspace/:id/transfer-owner.
 *
 * Two safeguards on a one-way action:
 *
 * - `newOwnerMemberId` — the workspace_members.id of the receiving
 *   admin/member. We use the membership-row id (not the bare userId)
 *   so a caller can't fat-finger an unrelated user id; the service
 *   verifies the target row belongs to the same workspace before any
 *   write.
 * - `confirm` — must be a literal `TRANSFER`. The mobile UI surfaces
 *   a confirm modal where the user has to type the word; the server
 *   re-checks so a buggy/replayed request can't silently rotate
 *   ownership on a one-tap miscue.
 */
export class TransferOwnershipDto {
  @ApiProperty()
  @IsUUID()
  newOwnerMemberId: string;

  @ApiProperty({ example: 'TRANSFER' })
  @IsString()
  @MinLength(8)
  confirm: string;
}
