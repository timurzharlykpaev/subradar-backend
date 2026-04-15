import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { SubscriptionCategory } from '../../subscriptions/entities/subscription.entity';
import { CatalogPlan } from './catalog-plan.entity';

@Entity('catalog_services')
export class CatalogService {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  slug: string;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  @Column({
    type: 'enum',
    enum: SubscriptionCategory,
    default: SubscriptionCategory.OTHER,
  })
  category: SubscriptionCategory;

  @Column({ type: 'text', nullable: true })
  iconUrl: string | null;

  @Column({ type: 'text', nullable: true })
  websiteUrl: string | null;

  @Column({ type: 'text', array: true, default: '{}' })
  aliases: string[];

  @Column({ type: 'timestamptz', nullable: true })
  lastResearchedAt: Date | null;

  @Column({ type: 'integer', default: 0 })
  researchCount: number;

  @CreateDateColumn({ name: 'createdAt' })
  createdAt: Date;

  @OneToMany(() => CatalogPlan, (p) => p.service)
  plans: CatalogPlan[];
}
