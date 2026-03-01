import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  UpdateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum CardBrand {
  VISA = 'VISA',
  MC = 'MC',
  AMEX = 'AMEX',
  MIR = 'MIR',
  OTHER = 'OTHER',
}

@Entity('payment_cards')
export class PaymentCard {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @ManyToOne(() => User, (u) => u.paymentCards, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  nickname: string;

  @Column({ length: 4 })
  last4: string;

  @Column({ type: 'enum', enum: CardBrand, default: CardBrand.OTHER })
  brand: CardBrand;

  @Column({ default: '#6366f1' })
  color: string;

  @Column({ default: false })
  isDefault: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
