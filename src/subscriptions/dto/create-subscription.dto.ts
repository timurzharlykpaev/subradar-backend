import {
  IsString,
  IsNumber,
  IsEnum,
  IsOptional,
  IsBoolean,
  IsArray,
  IsDateString,
  MaxLength,
  Min,
  Max,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  SubscriptionCategory,
  BillingPeriod,
  SubscriptionStatus,
  AddedVia,
} from '../entities/subscription.entity';

export class CreateSubscriptionDto {
  @ApiProperty() @IsString() @MaxLength(255) name: string;
  @ApiPropertyOptional({ enum: SubscriptionCategory })
  @IsOptional()
  @IsEnum(SubscriptionCategory)
  category?: SubscriptionCategory;
  @ApiProperty() @IsNumber() @Min(0) @Max(999999) amount: number;
  @ApiPropertyOptional() @IsOptional() @IsString() currency?: string;
  // Normalise lowercase values from older mobile builds (≤1.4.7) — the
  // onboarding quick-add backfill used to send `'monthly'`, which then
  // failed the strict enum check and dropped the user's first
  // subscriptions silently. Upper-casing here keeps every legitimate
  // value valid without loosening the enum or accepting garbage.
  @ApiPropertyOptional({ enum: BillingPeriod })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @IsEnum(BillingPeriod)
  billingPeriod?: BillingPeriod;
  @ApiPropertyOptional() @IsOptional() @IsNumber() billingDay?: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() startDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() nextPaymentDate?: string;
  /**
   * Legacy alias for `nextPaymentDate`. Mobile builds ≤1.4.7 sent this
   * name on the onboarding quick-add backfill; without acknowledging it
   * here the strict whitelist returns 400 and the user lands on an empty
   * dashboard. The controller remaps this onto `nextPaymentDate` before
   * persistence, then drops it. New clients should send
   * `nextPaymentDate` directly.
   * @deprecated remove once mobile v1.4.6/v1.4.7 adoption is < 1 %.
   */
  @ApiPropertyOptional({ deprecated: true })
  @IsOptional()
  @IsDateString()
  nextChargeDate?: string;
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
  @ApiPropertyOptional() @IsOptional() @IsString() catalogPlanId?: string;
}
