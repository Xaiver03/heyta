import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertAuthenticationModeAvailable, loadAuthenticationConfig } from '../src/central-auth/config';
import { loadConfigFromEnv } from '../src/config';

const publicUrl = 'https://heyta.example';
const configured = () => ({
  HEYTA_AUTH_MODE: 'oidc',
  HEYTA_AUTH_DEPLOYMENT: 'official',
  HEYTA_OIDC_ISSUER: 'https://identity.example/issuer/',
  HEYTA_OIDC_CLIENT_ID: 'heyta-test',
  HEYTA_OIDC_CLIENT_SECRET: 'synthetic-test-secret',
  HEYTA_OIDC_REDIRECT_URI: `${publicUrl}/api/auth/oidc/callback`,
  HEYTA_OIDC_SESSION_ENCRYPTION_KEY: '0123456789abcdef'.repeat(4),
});
afterEach(() => vi.unstubAllEnvs());

describe('authentication deployment boundary', () => {
  it('preserves unconfigured self-hosted local mode without contacting an identity provider', () => {
    const config = loadAuthenticationConfig({}, 'http://localhost:1900');
    expect(config).toEqual({ deployment: 'self-hosted', mode: 'local' });
    expect(() => assertAuthenticationModeAvailable(config)).not.toThrow();
  });
  it.each(['', 'OIDC', 'central', ' local '])('rejects an invalid explicit mode %j', (mode) => {
    expect(() => loadAuthenticationConfig({ HEYTA_AUTH_MODE: mode }, publicUrl)).toThrow('HEYTA_AUTH_MODE');
  });
  it.each(['', 'production', ' official '])('rejects an invalid deployment %j', (deployment) => {
    expect(() => loadAuthenticationConfig({ HEYTA_AUTH_DEPLOYMENT: deployment }, publicUrl)).toThrow('HEYTA_AUTH_DEPLOYMENT');
  });
  it.each([undefined, 'local'])('never defaults official to local (mode %j)', (mode) => {
    expect(() => loadAuthenticationConfig({ HEYTA_AUTH_DEPLOYMENT: 'official', HEYTA_AUTH_MODE: mode }, publicUrl)).toThrow();
  });
  it.each(['HEYTA_OIDC_ISSUER', 'HEYTA_OIDC_CLIENT_SECRT'])('rejects partial or misspelled OIDC configuration in implicit local mode (%s)', (key) => {
    expect(() => loadAuthenticationConfig({ [key]: '' }, publicUrl)).toThrow('Local mode');
  });
  it('rejects misspelled OIDC keys even with otherwise complete configuration', () => {
    expect(() => loadAuthenticationConfig({ ...configured(), HEYTA_OIDC_REDIRECT_URL: 'https://bad.example' }, publicUrl)).toThrow('Unknown');
  });
  it.each(Object.keys(configured()).filter((key) => key.startsWith('HEYTA_OIDC_')))('requires %s', (key) => {
    const env: Record<string, string> = configured();
    delete env[key];
    expect(() => loadAuthenticationConfig(env, publicUrl)).toThrow(key);
  });
  it('keeps issuer bytes and accepts a complete self-hosted OIDC configuration', () => {
    const config = loadAuthenticationConfig({ ...configured(), HEYTA_AUTH_DEPLOYMENT: 'self-hosted' }, publicUrl);
    expect(config.mode).toBe('oidc');
    if (config.mode === 'oidc') expect(config.issuer).toBe('https://identity.example/issuer/');
  });
  it.each([
    'http://identity.example', 'https:identity.example', 'https://user:password@identity.example',
    'https://identity.example/?query=1', 'https://identity.example/#fragment',
    'https://identity.example?', 'https://identity.example#', 'https://identity.example\\evil',
  ])('rejects unsafe issuer shape %s', (issuer) => {
    expect(() => loadAuthenticationConfig({ ...configured(), HEYTA_OIDC_ISSUER: issuer }, publicUrl)).toThrow('HEYTA_OIDC_ISSUER');
  });
  it.each([
    'https://other.example/api/auth/oidc/callback', `${publicUrl}/wrong`,
    `${publicUrl}/api/auth/oidc/callback?next=/`, `${publicUrl}/api/auth/oidc/callback#token`,
    `${publicUrl}:443/api/auth/oidc/callback`, `${publicUrl}/api/auth/oidc/../oidc/callback`,
  ])('requires one exact registered callback %s', (redirect) => {
    expect(() => loadAuthenticationConfig({ ...configured(), HEYTA_OIDC_REDIRECT_URI: redirect }, publicUrl)).toThrow('HEYTA_OIDC_REDIRECT_URI');
  });
  it('rejects public HTTP in OIDC mode even for loopback', () => {
    expect(() => loadAuthenticationConfig(configured(), 'http://localhost:1900')).toThrow('PUBLIC_URL');
  });
  it.each(['a'.repeat(63), 'z'.repeat(64), ''])('rejects invalid encryption key without disclosing it', (key) => {
    expect(() => loadAuthenticationConfig({ ...configured(), HEYTA_OIDC_SESSION_ENCRYPTION_KEY: key }, publicUrl)).toThrow('HEYTA_OIDC_SESSION_ENCRYPTION_KEY');
  });
  it('does not reuse the local JWT signing secret as encryption key', () => {
    expect(() => loadAuthenticationConfig({ ...configured(), JWT_SECRET: configured().HEYTA_OIDC_SESSION_ENCRYPTION_KEY }, publicUrl)).toThrow('independent');
  });
  it('does not disclose credential values in invalid configuration errors', () => {
    const secret = 'synthetic-secret-must-not-leak\n';
    try {
      loadAuthenticationConfig({ ...configured(), HEYTA_OIDC_CLIENT_SECRET: secret }, publicUrl);
      throw new Error('unexpected success');
    } catch (error) {
      expect(String(error)).toContain('HEYTA_OIDC_CLIENT_SECRET');
      expect(String(error)).not.toContain(secret.trim());
    }
  });
  it('keeps OIDC unavailable while handlers and revocation are unimplemented', () => {
    expect(() => assertAuthenticationModeAvailable(loadAuthenticationConfig(configured(), publicUrl))).toThrow('refusing to start');
  });
  it('resolves actual server configuration from env, overriding caller supplied local mode', () => {
    for (const [key, value] of Object.entries(configured())) vi.stubEnv(key, value);
    vi.stubEnv('PUBLIC_URL', publicUrl);
    const config = loadConfigFromEnv({ publicUrl, authentication: { mode: 'local', deployment: 'self-hosted' } });
    expect(config.authentication?.mode).toBe('oidc');
    expect(() => assertAuthenticationModeAvailable(config.authentication!)).toThrow('refusing to start');
  });
});
