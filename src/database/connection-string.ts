const SSLMODE_ALIAS_PATTERN = /([?&]sslmode=)(?:prefer|require|verify-ca)(?=&|#|$)/i;

/**
 * pg-connection-string treats sslmode=prefer/require/verify-ca as aliases for
 * verify-full and warns that v3/pg v9 will change their meaning. Rewrite them
 * up front so the intent (and current behavior) is explicit. Real modes such
 * as disable/verify-full are left untouched.
 */
export const normalizeSslMode = (connectionString: string): string =>
  connectionString.replace(
    SSLMODE_ALIAS_PATTERN,
    (_match, prefix: string) => `${prefix}verify-full`,
  );
