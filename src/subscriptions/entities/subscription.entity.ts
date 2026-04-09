import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { PaymentCard } from '../../payment-cards/entities/payment-card.entity';

export enum SubscriptionCategory {
  STREAMING = 'STREAMING',
  AI_SERVICES = 'AI_SERVICES',
  INFRASTRUCTURE = 'INFRASTRUCTURE',
  PRODUCTIVITY = 'PRODUCTIVITY',
  MUSIC = 'MUSIC',
  GAMING = 'GAMING',
  NEWS = 'NEWS',
  HEALTH = 'HEALTH',
  EDUCATION = 'EDUCATION',
  FINANCE = 'FINANCE',
  DESIGN = 'DESIGN',
  SECURITY = 'SECURITY',
  DEVELOPER = 'DEVELOPER',
  SPORT = 'SPORT',
  BUSINESS = 'BUSINESS',
  OTHER = 'OTHER',
}

export enum BillingPeriod {
  MONTHLY = 'MONTHLY',
  YEARLY = 'YEARLY',
  WEEKLY = 'WEEKLY',
  QUARTERLY = 'QUARTERLY',
  LIFETIME = 'LIFETIME',
  ONE_TIME = 'ONE_TIME',
}

export enum SubscriptionStatus {
  TRIAL = 'TRIAL',
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  CANCELLED = 'CANCELLED',
}

export enum AddedVia {
  MANUAL = 'MANUAL',
  AI_VOICE = 'AI_VOICE',
  AI_SCREENSHOT = 'AI_SCREENSHOT',
  AI_TEXT = 'AI_TEXT',
}

@Entity('subscriptions')
@Index(['userId', 'status'])
@Index(['userId', 'category'])
@Index(['userId', 'createdAt'])
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @ManyToOne(() => User, (u) => u.subscriptions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  name: string;

  @Column({
    type: 'enum',
    enum: SubscriptionCategory,
    default: SubscriptionCategory.OTHER,
  })
  category: SubscriptionCategory;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column({ default: 'USD' })
  currency: string;

  @Column({ type: 'enum', enum: BillingPeriod, default: BillingPeriod.MONTHLY })
  billingPeriod: BillingPeriod;

  @Column({ nullable: true })
  billingDay: number;

  @Column({ nullable: true, type: 'date' })
  startDate: Date;

  @Index()
  @Column({ nullable: true, type: 'date' })
  nextPaymentDate: Date;

  @Column({ nullable: true })
  currentPlan: string;

  @Column({ type: 'jsonb', nullable: true })
  availablePlans: object[];

  @Index()
  @Column({
    type: 'enum',
    enum: SubscriptionStatus,
    default: SubscriptionStatus.ACTIVE,
  })
  status: SubscriptionStatus;

  @Column({ nullable: true, type: 'date' })
  trialEndDate: Date;

  @Column({ nullable: true })
  cancelledAt: Date;

  @Column({ nullable: true })
  serviceUrl: string;

  @Column({ nullable: true })
  cancelUrl: string;

  @Column({ nullable: true })
  managePlanUrl: string;

  @Column({ nullable: true })
  iconUrl: string;

  @Column({ type: 'int', array: true, nullable: true, default: () => "'{3}'" })
  reminderDaysBefore: number[];

  @Column({ nullable: true, default: true })
  reminderEnabled: boolean;

  @Column({ default: false })
  isBusinessExpense: boolean;

  @Column({ nullable: true })
  taxCategory: string;

  @Column({ nullable: true, type: 'text' })
  notes: string;

  @Column({ type: 'enum', enum: AddedVia, default: AddedVia.MANUAL })
  addedVia: AddedVia;

  @Column({ type: 'jsonb', nullable: true })
  aiMetadata: object;

  @Column({ nullable: true })
  paymentCardId: string;

  @ManyToOne(() => PaymentCard, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'paymentCardId' })
  paymentCard: PaymentCard;

  @Column({ type: 'varchar', length: 7, nullable: true })
  color: string | null;

  @Column({ type: 'simple-json', nullable: true })
  tags: string[] | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
