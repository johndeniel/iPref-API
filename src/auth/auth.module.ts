import { Global, Module } from '@nestjs/common';
import { JwtAuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';

/**
 * Managed Neon Auth: verifies Bearer JWTs against the instance JWKS.
 * Global so feature modules can use the guard/service without imports;
 * the guard itself is scoped per-controller (health stays open).
 */
@Global()
@Module({
  providers: [AuthService, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard],
})
export class AuthModule {}
