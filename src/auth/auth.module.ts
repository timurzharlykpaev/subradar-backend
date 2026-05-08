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
import { DEV_JWT_ACCESS_SENTINEL } from '../config/configuration';

const DEV_ENVS = new Set(['development', 'test']);
function isDevEnvironment(): boolean {
  const env = (process.env.NODE_ENV || '').toLowerCase().trim();
  return DEV_ENVS.has(env);
}

@Module({
  imports: [
    UsersModule,
    NotificationsModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (cfg: ConfigService) => {
        // Mirror configuration.ts.requireSecret: same sentinel constant so
        // tokens minted via JwtModule.sign are verifiable via configuration's
        // jwt.secret value, and same fail-closed rule for non-dev envs
        // (anything other than NODE_ENV=development|test must supply real
        // secrets).
        const raw =
          cfg.get<string>('JWT_ACCESS_SECRET') || cfg.get<string>('JWT_SECRET');
        const secret = raw && raw.trim().length > 0 ? raw : null;
        if (!secret) {
          if (!isDevEnvironment()) {
            throw new Error(
              'JWT_ACCESS_SECRET (or legacy JWT_SECRET) must be set when NODE_ENV is not development|test',
            );
          }
          return {
            secret: DEV_JWT_ACCESS_SENTINEL,
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
