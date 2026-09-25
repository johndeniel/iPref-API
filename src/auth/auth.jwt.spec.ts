import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { verifyToken, type KeySet } from './auth.jwt.js';

const ISSUER = 'https://ep-example.neonauth.aws.neon.tech';

const setup = async () => {
  const { publicKey, privateKey } = await generateKeyPair('Ed25519');
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'EdDSA' };
  const keySet: KeySet = createLocalJWKSet({ keys: [jwk] });
  const sign = (claims: Record<string, unknown>, kid = 'test-key') =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'EdDSA', kid })
      .setSubject('user-1')
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
  return { keySet, privateKey, sign };
};

describe('verifyToken', () => {
  it('accepts a valid token and returns sub/email', async () => {
    const { keySet, sign } = await setup();
    const token = await sign({ email: 'ada@example.com' });

    const user = await verifyToken(token, keySet, ISSUER);

    expect(user).toEqual({ id: 'user-1', email: 'ada@example.com' });
  });

  it('omits email when the claim is absent', async () => {
    const { keySet, sign } = await setup();
    const token = await sign({});

    const user = await verifyToken(token, keySet, ISSUER);

    expect(user).toEqual({ id: 'user-1', email: undefined });
  });

  it('rejects a foreign issuer', async () => {
    const { keySet, sign } = await setup();
    const token = await sign({});

    await expect(verifyToken(token, keySet, 'https://evil.example')).rejects.toThrow();
  });

  it('rejects an unknown key id', async () => {
    const { keySet, sign } = await setup();
    const token = await sign({}, 'unknown-key');

    await expect(verifyToken(token, keySet, ISSUER)).rejects.toThrow();
  });

  it('rejects expired tokens', async () => {
    const { keySet, privateKey } = await setup();
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'EdDSA', kid: 'test-key' })
      .setSubject('user-1')
      .setIssuer(ISSUER)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(privateKey);

    await expect(verifyToken(token, keySet, ISSUER)).rejects.toThrow();
  });

  it('rejects tokens without a sub claim', async () => {
    const { keySet, privateKey } = await setup();
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'EdDSA', kid: 'test-key' })
      .setIssuer(ISSUER)
      .setExpirationTime('5m')
      .sign(privateKey);

    await expect(verifyToken(token, keySet, ISSUER)).rejects.toThrow(/sub/);
  });

  it('rejects tampered tokens', async () => {
    const { keySet, sign } = await setup();
    const token = await sign({});
    const tampered = `${token.slice(0, -2)}xx`;

    await expect(verifyToken(tampered, keySet, ISSUER)).rejects.toThrow();
  });

  it('rejects malformed input without network access', async () => {
    const { keySet } = await setup();

    await expect(verifyToken('not-a-jwt', keySet, ISSUER)).rejects.toThrow();
  });
});
