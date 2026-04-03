import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

export interface Recommendation {
  type: 'CANCEL' | 'DOWNGRADE' | 'SWITCH_PLAN' | 'SWITCH_PROVIDER' | 'BUNDLE' | 'LOW_USAGE';
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  subscriptionId: string;
  subscriptionName: string;
  title: string;
  description: string;
  estimatedSavingsMonthly: number;
  alternativeProvider?: string;
  alternativePrice?: number;
  alternativePlan?: string;
  confidence: number;
}

export interface DuplicateGroup {
  reason: string;
  subscriptions: { id: string; name: string; amount: number }[];
  suggestion: string;
  estimatedSavingsMonthly: number;
}

export interface SubscriptionOverlap {
  serviceName: string;
  members: { userId: string; name: string; amount: number }[];
  currentTotalMonthly: number;
  suggestedPlan: string;
  suggestedTotalMonthly: number;
  savingsMonthly: number;
}

@Entity('analysis_results')
@Index(['userId', 'createdAt'])
export class AnalysisResult {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  userId: string;

  @Column('uuid', { nullable: true })
  workspaceId: string | null;

  @Column('uuid')
  jobId: string;

  @Column({ type: 'varchar', length: 64 })
  inputHash: string;

  @Column({ type: 'text' })
  summary: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  totalMonthlySavings: number;

  @Column({ type: 'varchar', length: 3, default: 'USD' })
  currency: string;

  @Column({ type: 'jsonb', default: [] })
  recommendations: Recommendation[];

  @Column({ type: 'jsonb', default: [] })
  duplicates: DuplicateGroup[];

  @Column({ type: 'jsonb', nullable: true })
  overlaps: SubscriptionOverlap[] | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  teamSavings: number | null;

  @Column({ type: 'int', nullable: true })
  memberCount: number | null;

  @Column({ type: 'int' })
  subscriptionCount: number;

  @Column({ type: 'varchar', length: 32, default: 'gpt-4o' })
  modelUsed: string;

  @Column({ type: 'int', default: 0 })
  tokensUsed: number;

  @Column({ type: 'timestamp' })
  expiresAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
