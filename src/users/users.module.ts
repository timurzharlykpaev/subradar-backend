import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UserBilling } from '../billing/entities/user-billing.entity';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  imports: [TypeOrmModule.forFeature([User, UserBilling])],
  providers: [UsersService],
  controllers: [UsersController],
  // Re-export TypeOrmModule so AuthModule's JwtStrategy can inject
  // Repository<User> directly (it needs a per-request light SELECT for
  // tokenVersion check; injecting UsersService would create a circular
  // dependency since UsersService doesn't expose tokenVersion read).
  exports: [UsersService, TypeOrmModule],
})
export class UsersModule {}
