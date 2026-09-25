import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createNeonKeySet, verifyToken, type KeySet } from './auth.jwt.js';
import type { AuthenticatedUser, NeonAuthOptions } from './auth.types.js';

/**
 * Verifies Managed Neon Auth JWTs (EdDSA, 15-min expiry) from the
 * `Authorization: Bearer` header. Public keys come from the instance JWKS —
 * key rotation needs no redeploy or secret handling.
 */
@Injectable()
export class AuthService {
  private readonly keySet: KeySet;
  readonly options: NeonAuthOptions;

  constructor(config: ConfigService) {
    const baseUrl = config.getOrThrow<string>('NEON_AUTH_BASE_URL').replace(/\/+$/, '');
    const jwksUrl = config.get<string>('NEON_AUTH_JWKS_URL') ?? `${baseUrl}/.well-known/jwks.json`;
    // Per Neon docs the token issuer is the origin of the Neon Auth URL.
    const issuer = config.get<string>('NEON_AUTH_ISSUER') ?? new URL(baseUrl).origin;
    this.options = { baseUrl, jwksUrl, issuer };
    this.keySet = createNeonKeySet(jwksUrl);
  }

  verifyBearer(token: string): Promise<AuthenticatedUser> {
    return verifyToken(token, this.keySet, this.options.issuer);
  }
}
