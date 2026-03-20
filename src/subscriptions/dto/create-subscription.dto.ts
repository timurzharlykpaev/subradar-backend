import {
  IsString,
  IsNumber,
  IsEnum,
  IsOptional,
  IsBoolean,
  IsArray,
  IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  SubscriptionCategory,
  BillingPeriod,
  SubscriptionStatus,
  AddedVia,
} from '../entities/subscription.entity';

export class CreateSubscriptionDto {
  @ApiProperty() @IsString() name: string;
  @ApiPropertyOptional({ enum: SubscriptionCategory })
  @IsOptional()
  @IsEnum(SubscriptionCategory)
  category?: SubscriptionCategory;
  @ApiProperty() @IsNumber() amount: number;
  @ApiPropertyOptional() @IsOptional() @IsString() currency?: string;
  @ApiPropertyOptional({ enum: BillingPeriod })
  @IsOptional()
  @IsEnum(BillingPeriod)
  billingPeriod?: BillingPeriod;
  @ApiPropertyOptional() @IsOptional() @IsNumber() billingDay?: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() startDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() currentPlan?: string;
  @ApiPropertyOptional() @IsOptional() availablePlans?: object[];
  @ApiPropertyOptional({ enum: SubscriptionStatus })
  @IsOptional()
  @IsEnum(SubscriptionStatus)
  status?: SubscriptionStatus;
  @ApiPropertyOptional() @IsOptional() @IsDateString() trialEndDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() serviceUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cancelUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() managePlanUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() iconUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsArray() reminderDaysBefore?: number[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() reminderEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isBusinessExpense?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() taxCategory?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional({ enum: AddedVia })
  @IsOptional()
  @IsEnum(AddedVia)
  addedVia?: AddedVia;
  @ApiPropertyOptional() @IsOptional() aiMetadata?: object;
  @ApiPropertyOptional() @IsOptional() @IsString() paymentCardId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() color?: string;
  @ApiPropertyOptional() @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
}
