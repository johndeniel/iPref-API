/** Identity extracted from a verified Neon Auth JWT. */
export interface AuthenticatedUser {
  /** JWT `sub` — the `neon_auth.user.id`, also stored as `personal_information.user_id`. */
  id: string;
  /** JWT `email` claim, when present. */
  email?: string;
  /** JWT `banned` claim. Stale up to the token lifetime (15 min). */
  banned?: boolean;
}

/** Resolved Neon Auth endpoints used for Bearer verification. */
export interface NeonAuthOptions {
  baseUrl: string;
  jwksUrl: string;
  /** Expected JWT `iss` — the origin of the Neon Auth URL. */
  issuer: string;
}
