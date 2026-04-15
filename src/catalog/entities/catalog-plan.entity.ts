import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { CatalogService } from './catalog-service.entity';
import { BillingPeriod } from '../../subscriptions/entities/subscription.entity';

export enum PriceSource {
  AI_RESEARCH = 'AI_RESEARCH',
  USER_REPORTED = 'USER_REPORTED',
  MANUAL = 'MANUAL',
}

export enum PriceConfidence {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
}

@Entity('catalog_plans')
@Unique(['serviceId', 'region', 'planName'])
@Index(['lastPriceRefreshAt'])
@Index(['serviceId', 'region'])
export class CatalogPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  serviceId: string;

  @ManyToOne(() => CatalogService, (s) => s.plans, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'serviceId' })
  service: CatalogService;

  @Column({ type: 'varchar', length: 2 })
  region: string;

  @Column({ type: 'varchar', length: 128 })
  planName: string;

  @Column({ type: 'decimal', precision: 19, scale: 4 })
  price: string;

  @Column({ type: 'varchar', length: 3 })
  currency: string;

  @Column({ type: 'enum', enum: BillingPeriod })
  period: BillingPeriod;

  @Column({ type: 'integer', nullable: true })
  trialDays: number | null;

  @Column({ type: 'text', array: true, default: '{}' })
  features: string[];

  @Column({ type: 'enum', enum: PriceSource, default: PriceSource.AI_RESEARCH })
  priceSource: PriceSource;

  @Column({ type: 'enum', enum: PriceConfidence, default: PriceConfidence.HIGH })
  priceConfidence: PriceConfidence;

  @Column({ type: 'timestamptz', nullable: true })
  lastPriceRefreshAt: Date | null;
}
