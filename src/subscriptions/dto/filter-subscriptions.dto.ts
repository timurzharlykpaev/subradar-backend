import { IsOptional, IsEnum, IsString, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  SubscriptionCategory,
  SubscriptionStatus,
} from '../entities/subscription.entity';

export class FilterSubscriptionsDto {
  @ApiPropertyOptional({ enum: SubscriptionStatus })
  @IsOptional()
  @IsEnum(SubscriptionStatus)
  status?: SubscriptionStatus;

  @ApiPropertyOptional({ enum: SubscriptionCategory })
  @IsOptional()
  @IsEnum(SubscriptionCategory)
  category?: SubscriptionCategory;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    enum: ['name', 'amount', 'nextPaymentDate', 'createdAt'],
  })
  @IsOptional()
  @IsIn(['name', 'amount', 'nextPaymentDate', 'createdAt'])
  sort?: 'name' | 'amount' | 'nextPaymentDate' | 'createdAt';

  @ApiPropertyOptional({ enum: ['ASC', 'DESC'] })
  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  order?: 'ASC' | 'DESC';
}
