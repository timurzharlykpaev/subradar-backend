import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

export enum AnalysisJobStatus {
  QUEUED = 'QUEUED',
  COLLECTING = 'COLLECTING',
  NORMALIZING = 'NORMALIZING',
  LOOKING_UP = 'LOOKING_UP',
  ANALYZING = 'ANALYZING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum AnalysisTriggerType {
  AUTO = 'AUTO',
  MANUAL = 'MANUAL',
  CRON = 'CRON',
  SUBSCRIPTION_CHANGE = 'SUBSCRIPTION_CHANGE',
}

@Entity('analysis_jobs')
@Index(['userId', 'status'])
@Index(['userId', 'createdAt'])
export class AnalysisJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  userId: string;

  @Column('uuid', { nullable: true })
  workspaceId: string | null;

  @Column({ type: 'enum', enum: AnalysisJobStatus, default: AnalysisJobStatus.QUEUED })
  status: AnalysisJobStatus;

  @Column({ type: 'enum', enum: AnalysisTriggerType })
  triggerType: AnalysisTriggerType;

  @Column({ type: 'varchar', length: 64 })
  inputHash: string;

  @Column({ type: 'jsonb', default: { collect: 'pending', normalize: 'pending', marketLookup: 'pending', aiAnalyze: 'pending', store: 'pending' }})
  stageProgress: {
    collect: 'pending' | 'done';
    normalize: 'pending' | 'done';
    marketLookup: 'pending' | 'done';
    aiAnalyze: 'pending' | 'done';
    store: 'pending' | 'done';
  };

  @Column({ type: 'int', default: 0 })
  tokensUsed: number;

  @Column({ type: 'int', default: 0 })
  webSearchesUsed: number;

  @Column('uuid', { nullable: true })
  resultId: string | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date | null;
}
