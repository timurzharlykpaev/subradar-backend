import { IsString, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum PlanType {
  PRO = 'PRO',
  TEAM = 'TEAM',
}

export class CheckoutDto {
  @ApiProperty({ enum: PlanType })
  @IsEnum(PlanType)
  plan: PlanType;
}
