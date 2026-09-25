import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';
import type { AuthenticatedUser } from './auth.types.js';

export interface AuthenticatedRequest extends Request {
  authUser?: AuthenticatedUser;
}

/**
 * Scoped guard (applied per-controller, not globally): requires a valid
 * Managed Neon Auth JWT as `Authorization: Bearer <token>`.
 * Banned users authenticate fine but are refused with 403.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = req.headers.authorization;
    const token = header?.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : undefined;
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }
    try {
      req.authUser = await this.auth.verifyBearer(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (req.authUser.banned === true) {
      req.authUser = undefined;
      throw new ForbiddenException('User is banned');
    }
    return true;
  }
}
