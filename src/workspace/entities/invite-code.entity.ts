import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('invite_codes')
@Index(['code'], { unique: true })
@Index(['workspaceId'])
export class InviteCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  workspaceId: string;

  @Column({ type: 'varchar', length: 6 })
  code: string;

  @Column('uuid')
  createdBy: string;

  @Column('uuid', { nullable: true })
  usedBy: string | null;

  @Column({ type: 'timestamp', nullable: true })
  usedAt: Date | null;

  @Column({ type: 'timestamp' })
  expiresAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
