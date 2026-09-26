import { normalizeSslMode } from './connection-string.js';

describe('normalizeSslMode', () => {
  it('rewrites sslmode=require to verify-full', () => {
    expect(
      normalizeSslMode('postgresql://user:pass@host/db?sslmode=require&channel_binding=require'),
    ).toBe('postgresql://user:pass@host/db?sslmode=verify-full&channel_binding=require');
  });

  it.each(['prefer', 'verify-ca'])('rewrites sslmode=%s to verify-full', mode => {
    expect(normalizeSslMode(`postgresql://user:pass@host/db?sslmode=${mode}`)).toBe(
      'postgresql://user:pass@host/db?sslmode=verify-full',
    );
  });

  it('keeps sslmode=verify-full and sslmode=disable as-is', () => {
    expect(normalizeSslMode('postgresql://user:pass@host/db?sslmode=verify-full')).toBe(
      'postgresql://user:pass@host/db?sslmode=verify-full',
    );
    expect(normalizeSslMode('postgresql://user:pass@host/db?sslmode=disable')).toBe(
      'postgresql://user:pass@host/db?sslmode=disable',
    );
  });

  it('leaves connection strings without sslmode untouched', () => {
    const url = 'postgresql://user:pass@host:5432/db?channel_binding=require';
    expect(normalizeSslMode(url)).toBe(url);
  });

  it('preserves other query parameters and their order', () => {
    expect(
      normalizeSslMode(
        'postgresql://user:pass@host/db?sslmode=require&application_name=svc&options=-c%20search_path%3Dpublic',
      ),
    ).toBe(
      'postgresql://user:pass@host/db?sslmode=verify-full&application_name=svc&options=-c%20search_path%3Dpublic',
    );
  });

  it('rewrites sslmode anywhere in the query string', () => {
    expect(
      normalizeSslMode('postgresql://user:pass@host/db?channel_binding=require&sslmode=require'),
    ).toBe('postgresql://user:pass@host/db?channel_binding=require&sslmode=verify-full');
  });
});
