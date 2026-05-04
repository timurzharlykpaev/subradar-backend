import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum ReportType {
  SUMMARY = 'SUMMARY',
  DETAILED = 'DETAILED',
  TAX = 'TAX',
  AUDIT = 'AUDIT',
}

export enum ReportStatus {
  PENDING = 'PENDING',
  GENERATING = 'GENERATING',
  READY = 'READY',
  FAILED = 'FAILED',
}

@Entity('reports')
export class Report {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  /**
   * When set, this is a team report scoped to a workspace — the row's
   * `userId` becomes the requesting owner (for billing/auth) and the
   * PDF aggregates data across every active workspace member.
   * Null for personal reports (the long-standing default).
   */
  @Column({ type: 'uuid', nullable: true })
  workspaceId: string | null;

  @Column({ type: 'enum', enum: ReportType })
  type: ReportType;

  @Column()
  from: string;

  @Column()
  to: string;

  @Column({ nullable: true })
  fileUrl: string;

  @Column({ type: 'enum', enum: ReportStatus, default: ReportStatus.PENDING })
  status: ReportStatus;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
