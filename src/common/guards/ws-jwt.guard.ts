import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
// WsException not installed - using standard Error
class WsException extends Error {
  constructor(message: string) { super(message); }
}

@Injectable()
export class WsJwtGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly cfg: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const client = context.switchToWs().getClient();
    const token =
      client.handshake?.auth?.token ||
      client.handshake?.headers?.authorization?.replace('Bearer ', '');

    if (!token) throw new WsException('Unauthorized');

    try {
      const payload = this.jwtService.verify(token, {
        secret: this.cfg.get('JWT_SECRET', 'jwt-secret-change-me'),
      });
      client.user = payload;
      return true;
    } catch {
      throw new WsException('Invalid token');
    }
  }
}
