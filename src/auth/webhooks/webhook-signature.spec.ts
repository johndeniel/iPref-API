import { createLocalJWKSet } from 'jose';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  parseNeonWebhookHeaders,
  verifyNeonWebhookSignature,
  type NeonWebhookHeaders,
} from './webhook-signature.js';
import type { KeySet } from '../auth.jwt.js';

const KID = 'test-kid';
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicJwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'EdDSA' };
const keySet: KeySet = createLocalJWKSet({ keys: [publicJwk] });

const RAW_BODY = JSON.stringify({ event_type: 'user.created', user: { id: 'user-1' } });

/** Replicates the Neon server-side detached-JWS signing. */
const neonSign = (rawBody: string, timestamp: string): string => {
  const headerB64 = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWS', kid: KID })).toString(
    'base64url',
  );
  const payloadB64 = Buffer.from(rawBody, 'utf8').toString('base64url');
  const innerB64 = Buffer.from(`${timestamp}.${payloadB64}`, 'utf8').toString('base64url');
  const signature = sign(null, Buffer.from(`${headerB64}.${innerB64}`), privateKey).toString(
    'base64url',
  );
  return `${headerB64}..${signature}`;
};

const headersFor = (timestamp: string, signature: string): NeonWebhookHeaders => ({
  signature,
  kid: KID,
  timestamp,
  eventType: 'user.created',
  eventId: 'event-1',
});

describe('verifyNeonWebhookSignature', () => {
  it('accepts a correctly signed request', async () => {
    const timestamp = String(Date.now());
    const headers = headersFor(timestamp, neonSign(RAW_BODY, timestamp));

    await expect(verifyNeonWebhookSignature(RAW_BODY, headers, keySet)).resolves.toBeUndefined();
  });

  it('rejects a tampered body', async () => {
    const timestamp = String(Date.now());
    const headers = headersFor(timestamp, neonSign(RAW_BODY, timestamp));

    await expect(verifyNeonWebhookSignature(`${RAW_BODY} `, headers, keySet)).rejects.toThrow();
  });

  it('rejects a tampered timestamp', async () => {
    const timestamp = String(Date.now());
    const headers = headersFor(String(Date.now() + 1000), neonSign(RAW_BODY, timestamp));

    await expect(verifyNeonWebhookSignature(RAW_BODY, headers, keySet)).rejects.toThrow();
  });

  it('rejects stale timestamps', async () => {
    const timestamp = String(Date.now() - 10 * 60 * 1000);
    const headers = headersFor(timestamp, neonSign(RAW_BODY, timestamp));

    await expect(verifyNeonWebhookSignature(RAW_BODY, headers, keySet)).rejects.toThrow(
      /tolerance/,
    );
  });

  it('rejects non-detached signatures', async () => {
    const timestamp = String(Date.now());
    const headers = headersFor(timestamp, 'nota-jws');

    await expect(verifyNeonWebhookSignature(RAW_BODY, headers, keySet)).rejects.toThrow(
      /detached JWS/,
    );
  });

  it('rejects unknown key ids', async () => {
    const timestamp = String(Date.now());
    const headers: NeonWebhookHeaders = {
      ...headersFor(timestamp, neonSign(RAW_BODY, timestamp)),
      kid: 'unknown',
    };

    await expect(verifyNeonWebhookSignature(RAW_BODY, headers, keySet)).rejects.toThrow();
  });
});

describe('parseNeonWebhookHeaders', () => {
  it('reads the X-Neon-* headers', () => {
    expect(
      parseNeonWebhookHeaders({
        'x-neon-signature': 'sig',
        'x-neon-signature-kid': 'kid',
        'x-neon-timestamp': '123',
        'x-neon-event-type': 'user.created',
        'x-neon-event-id': 'event-1',
      }),
    ).toEqual({
      signature: 'sig',
      kid: 'kid',
      timestamp: '123',
      eventType: 'user.created',
      eventId: 'event-1',
    });
  });

  it('throws when any header is missing', () => {
    expect(() => parseNeonWebhookHeaders({})).toThrow(/X-Neon/);
  });
});
