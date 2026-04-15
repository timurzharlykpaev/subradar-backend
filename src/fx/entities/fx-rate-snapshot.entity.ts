import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('fx_rate_snapshots')
export class FxRateSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 3, default: 'USD' })
  base: string;

  @Column({ type: 'jsonb' })
  rates: Record<string, number>;

  @Index()
  @CreateDateColumn({ name: 'fetchedAt' })
  fetchedAt: Date;

  @Column({ type: 'varchar', length: 64, default: 'exchangerate.host' })
  source: string;
}
