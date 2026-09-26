import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { FlattenedJWSInput, JWSHeaderParameters } from 'jose';
import type { AuthenticatedUser } from './auth.types.js';

/**
 * Callable shape shared by jose's remote and local JWKS resolvers, so
 * production code and offline unit tests use the same verification path.
 */
export type KeySet = (
  protectedHeader?: JWSHeaderParameters,
  token?: FlattenedJWSInput,
) => Promise<CryptoKey>;

/**
 * Pure JWT verification against a key set. Kept free of Nest/Config so unit
 * tests can exercise it with `jose.createLocalJWKSet` (no network).
 */
export const verifyToken = async (
  token: string,
  keySet: KeySet,
  issuer: string,
): Promise<AuthenticatedUser> => {
  const { payload } = await jwtVerify(token, keySet, { issuer });
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw new Error('JWT has no sub claim');
  }
  return {
    id: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    banned: payload.banned === true ? true : undefined,
  };
};

export const createNeonKeySet = (jwksUrl: string): KeySet => createRemoteJWKSet(new URL(jwksUrl));
