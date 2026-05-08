import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import { UsersModule } from '../users/users.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    UsersModule,
    NotificationsModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (cfg: ConfigService) => {
        // Mirror the fail-closed behaviour from configuration.ts. A `'secret'`
        // fallback here defeats the entire JWT signature scheme.
        const secret =
          cfg.get<string>('JWT_ACCESS_SECRET') || cfg.get<string>('JWT_SECRET');
        if (!secret) {
          if (process.env.NODE_ENV === 'production') {
            throw new Error(
              'JWT_ACCESS_SECRET (or legacy JWT_SECRET) must be set in production',
            );
          }
          // Dev-only sentinel — kept distinct from any other secret in the project.
          return {
            secret: 'dev-only-jwt-access-do-not-use-in-prod',
            signOptions: { expiresIn: cfg.get('JWT_EXPIRES_IN', '7d') },
          };
        }
        return {
          secret,
          signOptions: { expiresIn: cfg.get('JWT_EXPIRES_IN', '7d') },
        };
      },
      inject: [ConfigService],
    }),
  ],
  providers: [AuthService, JwtStrategy, GoogleStrategy],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
