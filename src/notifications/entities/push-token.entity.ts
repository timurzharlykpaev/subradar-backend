import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index,
} from 'typeorm';

@Entity('push_tokens')
export class PushToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @Column()
  token: string;

  @Column({ nullable: true })
  platform: string; // 'ios' | 'android'

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
