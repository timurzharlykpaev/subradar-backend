import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Subscription } from '../../subscriptions/entities/subscription.entity';
import { PaymentCard } from '../../payment-cards/entities/payment-card.entity';

export enum AuthProvider {
  LOCAL = 'local',
  GOOGLE = 'google',
  APPLE = 'apple',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  name: string;

  @Column({ unique: true })
  email: string;

  @Column({ nullable: true, select: false })
  password: string;

  @Column({ nullable: true })
  avatarUrl: string;

  @Column({ type: 'enum', enum: AuthProvider, default: AuthProvider.LOCAL })
  provider: AuthProvider;

  @Column({ nullable: true })
  providerId: string;

  @Column({ nullable: true })
  fcmToken: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ nullable: true })
  refreshToken: string;

  @Column({ nullable: true })
  magicLinkToken: string;

  @Column({ nullable: true })
  magicLinkExpiry: Date;

  @Column({ nullable: true })
  lemonSqueezyCustomerId: string;

  @Column({ default: 'free' })
  plan: string;

  @Column({ default: false })
  trialUsed: boolean;

  @Column({ nullable: true, type: 'timestamp' })
  trialStartDate: Date;

  @Column({ nullable: true, type: 'timestamp' })
  trialEndDate: Date;

  @Column({ default: 0 })
  aiRequestsUsed: number;

  @Column({ nullable: true })
  aiRequestsMonth: string;

  @Column({ type: 'varchar', nullable: true, default: null })
  proInviteeEmail!: string;

  @Column({ nullable: true })
  timezone: string;

  @Column({ nullable: true })
  locale: string;

  @Column({ nullable: true })
  country: string;

  @Column({ nullable: true, default: 'USD' })
  defaultCurrency: string;

  @Column({ nullable: true })
  dateFormat: string;

  @Column({ default: false })
  onboardingCompleted: boolean;

  @Column({ default: true })
  notificationsEnabled: boolean;

  @Column({ nullable: true, default: 3 })
  reminderDaysBefore: number;

  @Column({ nullable: true, default: true })
  emailNotifications: boolean;

  @Column({ type: 'boolean', default: true })
  weeklyDigestEnabled: boolean;

  @OneToMany(() => Subscription, (s) => s.user)
  subscriptions: Subscription[];

  @OneToMany(() => PaymentCard, (c) => c.user)
  paymentCards: PaymentCard[];

  @Column({ nullable: true })
  billingSource: string;

  @Column({ default: false })
  cancelAtPeriodEnd: boolean;

  @Column({ nullable: true, type: 'timestamp' })
  currentPeriodEnd: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
