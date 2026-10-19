/** Deployment configuration only; never derive an identity provider from a request. */
export type AuthenticationConfig =
  | { readonly mode: 'local'; readonly deployment: 'self-hosted' }
  | {
      readonly mode: 'oidc';
      readonly deployment: 'official' | 'self-hosted';
      readonly issuer: string;
      readonly clientId: string;
      readonly clientSecret: string;
      readonly redirectUri: string;
      readonly sessionEncryptionKey: string;
    };

type Environment = Readonly<Record<string, string | undefined>>;
const OIDC_KEYS = [
  'HEYTA_OIDC_ISSUER', 'HEYTA_OIDC_CLIENT_ID', 'HEYTA_OIDC_CLIENT_SECRET',
  'HEYTA_OIDC_REDIRECT_URI', 'HEYTA_OIDC_SESSION_ENCRYPTION_KEY',
] as const;

function required(env: Environment, key: string): string {
  const value = env[key];
  if (!value || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    // Values can contain credentials. Errors must identify keys, never values.
    throw new Error(`${key} must be present and contain no surrounding whitespace or controls`);
  }
  return value;
}

function httpsUrl(value: string, key: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${key} must be an absolute HTTPS URL`); }
  if (!value.startsWith('https://') || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      value.includes('?') || value.includes('#') || value.includes('\\') || /\s/.test(value)) {
    throw new Error(`${key} must use HTTPS without credentials, query or fragment`);
  }
  return url;
}

export function loadAuthenticationConfig(env: Environment, publicUrl: string): AuthenticationConfig {
  const deployment = env.HEYTA_AUTH_DEPLOYMENT ?? 'self-hosted';
  if (deployment !== 'self-hosted' && deployment !== 'official') {
    throw new Error('HEYTA_AUTH_DEPLOYMENT must be self-hosted or official');
  }
  const mode = env.HEYTA_AUTH_MODE ?? (deployment === 'self-hosted' ? 'local' : undefined);
  if (mode !== 'local' && mode !== 'oidc') {
    throw new Error('HEYTA_AUTH_MODE must be local or oidc; official requires explicit oidc');
  }
  const configuredKeys = Object.keys(env).filter((key) => key.startsWith('HEYTA_OIDC_') && env[key] !== undefined);
  if (mode === 'local') {
    if (deployment === 'official') throw new Error('Official deployment requires OIDC; local authentication is forbidden');
    if (configuredKeys.length) throw new Error('Local mode must not contain HEYTA_OIDC_* configuration');
    return { mode, deployment };
  }
  if (configuredKeys.some((key) => !(OIDC_KEYS as readonly string[]).includes(key))) {
    throw new Error('Unknown HEYTA_OIDC_* configuration key');
  }
  const issuer = required(env, 'HEYTA_OIDC_ISSUER');
  httpsUrl(issuer, 'HEYTA_OIDC_ISSUER');
  const clientId = required(env, 'HEYTA_OIDC_CLIENT_ID');
  const clientSecret = required(env, 'HEYTA_OIDC_CLIENT_SECRET');
  const redirectUri = required(env, 'HEYTA_OIDC_REDIRECT_URI');
  const redirect = httpsUrl(redirectUri, 'HEYTA_OIDC_REDIRECT_URI');
  const origin = httpsUrl(publicUrl, 'PUBLIC_URL');
  if (redirect.origin !== origin.origin || redirect.pathname !== '/api/auth/oidc/callback' ||
      redirectUri !== `${origin.origin}/api/auth/oidc/callback`) {
    throw new Error('HEYTA_OIDC_REDIRECT_URI must be the exact PUBLIC_URL origin callback /api/auth/oidc/callback');
  }
  const sessionEncryptionKey = required(env, 'HEYTA_OIDC_SESSION_ENCRYPTION_KEY');
  if (!/^[0-9a-f]{64}$/i.test(sessionEncryptionKey) || sessionEncryptionKey === env.JWT_SECRET) {
    throw new Error('HEYTA_OIDC_SESSION_ENCRYPTION_KEY must be an independent 32-byte hexadecimal key');
  }
  return { mode, deployment, issuer, clientId, clientSecret, redirectUri, sessionEncryptionKey };
}

/** Remove only with the complete OIDC/session/revocation implementation, never via an env bypass. */
export function assertAuthenticationModeAvailable(config: AuthenticationConfig): void {
  if (config.mode === 'oidc') {
    throw new Error('OIDC authentication is not available yet; refusing to start without complete session and revocation support');
  }
}
