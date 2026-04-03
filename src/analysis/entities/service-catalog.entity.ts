import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export interface ServicePlan {
  name: string;
  priceMonthly?: number;
  priceYearly?: number;
  currency: string;
  features?: string[];
}

export enum ServiceSource {
  HARDCODED = 'HARDCODED',
  WEB_SEARCH = 'WEB_SEARCH',
  MANUAL = 'MANUAL',
}

@Entity('service_catalog')
@Index(['normalizedName'], { unique: true })
export class ServiceCatalog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 128 })
  normalizedName: string;

  @Column({ type: 'varchar', length: 256 })
  displayName: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  category: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  logoUrl: string | null;

  @Column({ type: 'jsonb', default: [] })
  plans: ServicePlan[];

  @Column({ type: 'jsonb', default: [] })
  alternatives: string[];

  @Column({ type: 'enum', enum: ServiceSource, default: ServiceSource.HARDCODED })
  source: ServiceSource;

  @Column({ type: 'timestamp', nullable: true })
  lastVerifiedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  expiresAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
