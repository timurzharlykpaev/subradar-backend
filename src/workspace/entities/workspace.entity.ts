import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany,
} from 'typeorm';
import { WorkspaceMember } from './workspace-member.entity';

@Entity('workspaces')
export class Workspace {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column()
  ownerId: string;

  @Column({ default: 'TEAM' })
  plan: string;

  @Column({ default: 5 })
  maxMembers: number;

  @Column({ nullable: true })
  lemonSqueezySubscriptionId: string;

  @OneToMany(() => WorkspaceMember, (m) => m.workspace)
  members: WorkspaceMember[];

  @CreateDateColumn()
  createdAt: Date;
}
