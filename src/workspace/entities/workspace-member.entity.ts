import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Workspace } from './workspace.entity';
import { User } from '../../users/entities/user.entity';

export enum WorkspaceMemberRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER',
}

export enum WorkspaceMemberStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
}

@Entity('workspace_members')
export class WorkspaceMember {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  workspaceId: string;

  @ManyToOne(() => Workspace, (w) => w.members, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspaceId' })
  workspace: Workspace;

  @Index()
  @Column({ nullable: true })
  userId: string;

  @ManyToOne(() => User, { nullable: true, eager: false })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({
    type: 'enum',
    enum: WorkspaceMemberRole,
    default: WorkspaceMemberRole.MEMBER,
  })
  role: WorkspaceMemberRole;

  @Column({ nullable: true })
  inviteEmail: string;

  @Column({
    type: 'enum',
    enum: WorkspaceMemberStatus,
    default: WorkspaceMemberStatus.PENDING,
  })
  status: WorkspaceMemberStatus;

  @CreateDateColumn()
  joinedAt: Date;
}
