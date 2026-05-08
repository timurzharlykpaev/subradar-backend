import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'known_billing_senders' })
@Index('idx_known_senders_active', ['active'], { where: 'active = true' })
export class KnownBillingSender {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  domain: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'email_pattern' })
  emailPattern: string | null;

  @Column({ type: 'varchar', length: 100, name: 'service_name' })
  serviceName: string;

  @Column({ type: 'varchar', length: 50 })
  category: string;

  @Column({ type: 'varchar', length: 3, nullable: true, name: 'default_currency' })
  defaultCurrency: string | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn({ name: 'added_at' })
  addedAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
