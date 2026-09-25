import { flattenedVerify } from 'jose';
import type { KeySet } from '../auth.jwt.js';

export interface NeonWebhookHeaders {
  signature: string;
  kid: string;
  timestamp: string;
  eventType: string;
  eventId: string;
}

const TIMESTAMP_MAX_AGE_MS = 5 * 60 * 1000;
const TIMESTAMP_MAX_SKEW_MS = 60 * 1000;

/** Reads the `X-Neon-*` headers; throws on missing values. */
export const parseNeonWebhookHeaders = (
  headers: Record<string, string | string[] | undefined>,
): NeonWebhookHeaders => {
  const first = (value: string | string[] | undefined): string | undefined =>
    Array.isArray(value) ? value[0] : value;
  const signature = first(headers['x-neon-signature']);
  const kid = first(headers['x-neon-signature-kid']);
  const timestamp = first(headers['x-neon-timestamp']);
  const eventType = first(headers['x-neon-event-type']);
  const eventId = first(headers['x-neon-event-id']);
  if (!signature || !kid || !timestamp || !eventType || !eventId) {
    throw new Error('Missing required X-Neon-* webhook headers');
  }
  return { signature, kid, timestamp, eventType, eventId };
};

/**
 * Verifies a Managed Neon Auth webhook request.
 *
 * Neon signs with EdDSA (Ed25519) detached JWS (`header..signature`) binding
 * the delivery timestamp. Reconstruction (double base64url) per
 * https://neon.com/docs/auth/guides/webhooks#verification-steps.
 *
 * Throws on invalid signature, unknown key, or stale/future timestamps.
 */
export const verifyNeonWebhookSignature = async (
  rawBody: string,
  headers: NeonWebhookHeaders,
  keySet: KeySet,
): Promise<void> => {
  const timestampMs = Number(headers.timestamp);
  if (!Number.isFinite(timestampMs)) {
    throw new Error('Invalid webhook timestamp');
  }
  const ageMs = Date.now() - timestampMs;
  if (ageMs > TIMESTAMP_MAX_AGE_MS || ageMs < -TIMESTAMP_MAX_SKEW_MS) {
    throw new Error('Webhook timestamp outside tolerance');
  }

  const parts = headers.signature.split('.');
  if (parts.length !== 3 || parts[1] !== '' || !parts[0] || !parts[2]) {
    throw new Error('Expected detached JWS format (header..signature)');
  }
  const [headerB64, , signatureB64] = parts as [string, string, string];

  const payloadB64 = Buffer.from(rawBody, 'utf8').toString('base64url');
  const innerB64 = Buffer.from(`${headers.timestamp}.${payloadB64}`, 'utf8').toString('base64url');

  const key = await keySet({ alg: 'EdDSA', kid: headers.kid });
  await flattenedVerify({ payload: innerB64, protected: headerB64, signature: signatureB64 }, key);
};
