import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn, Index } from 'typeorm';

@Entity('analysis_usage')
@Index(['userId', 'periodStart'], { unique: true })
export class AnalysisUsage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  userId: string;

  @Column({ type: 'timestamp' })
  periodStart: Date;

  @Column({ type: 'timestamp' })
  periodEnd: Date;

  @Column({ type: 'int', default: 0 })
  autoAnalysesUsed: number;

  @Column({ type: 'int', default: 0 })
  manualAnalysesUsed: number;

  @Column({ type: 'int', default: 0 })
  webSearchesUsed: number;

  @Column({ type: 'int', default: 0 })
  tokensUsed: number;

  @Column({ type: 'timestamp', nullable: true })
  lastManualAt: Date | null;

  @UpdateDateColumn()
  updatedAt: Date;
}
