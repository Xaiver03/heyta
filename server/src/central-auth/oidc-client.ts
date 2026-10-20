/** MIT implementation against public OIDC/OAuth contracts. Server coordinator only.
 * This transport never mints a product session, applies an attempt, or compensates
 * by revoking after a persistence error. The durable attempt owns every result.
 */
import type { Configuration, CustomFetch, IDToken, ServerMetadata } from 'openid-client';
import type { AuthenticationConfig } from './config';
import type { CentralAuthRepository, LocalProof, TokenMaterial } from './repository';
import { loadOidcClient } from './oidc-runtime';

type OidcConfig = Extract<AuthenticationConfig, { mode: 'oidc' }>;
type RepositoryPort = Pick<CentralAuthRepository, 'prepare' | 'dispatchAuthorization' | 'beginRefresh' | 'recordResult'>;
type Attempt = { id: string; dispatchToken: string; issuer: string; clientId: string };
const DEADLINE_MS = 15_000;
const MAX_BODY = 65_536;
const MAX_TOKEN = 16_384;
const endpointMethods = {
  authorization_endpoint: 'GET', token_endpoint: 'POST', userinfo_endpoint: 'GET',
  introspection_endpoint: 'POST', revocation_endpoint: 'POST', jwks_uri: 'GET',
} as const;

export class CentralOidcError extends Error {
  constructor(readonly code: 'central_unavailable' | 'central_invalid' | 'central_timeout' | 'central_inactive') {
    super(code);
    this.name = 'CentralOidcError';
  }
}
function invalid(): never { throw new CentralOidcError('central_invalid'); }
function text(value: unknown, max = MAX_TOKEN): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u0020\u007f]/.test(value);
}
function endpoint(value: unknown, issuer: string): string {
  if (typeof value !== 'string') invalid();
  let url: URL;
  try { url = new URL(value); } catch { invalid(); }
  if (url.protocol !== 'https:' || url.origin !== new URL(issuer).origin || url.username || url.password ||
      url.search || url.hash || /[?#\\\s]/.test(value) || url.href !== value) invalid();
  return value;
}
function metadataValid(metadata: ServerMetadata, config: OidcConfig): void {
  if (metadata.issuer !== config.issuer || !metadata.id_token_signing_alg_values_supported?.includes('ES256') ||
      !metadata.code_challenge_methods_supported?.includes('S256')) invalid();
  for (const key of Object.keys(endpointMethods) as (keyof typeof endpointMethods)[]) endpoint(metadata[key], config.issuer);
}
function material(body: string): TokenMaterial | undefined {
  let json: Record<string, unknown>;
  try { json = JSON.parse(body); } catch { return undefined; }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return undefined;
  const tokens: TokenMaterial = {};
  if (text(json.access_token)) tokens.accessToken = json.access_token;
  if (text(json.refresh_token)) tokens.refreshToken = json.refresh_token;
  if (text(json.id_token)) tokens.idToken = json.id_token;
  if (!tokens.accessToken && !tokens.refreshToken) return undefined;
  if (typeof json.expires_in === 'number' && Number.isSafeInteger(json.expires_in) && json.expires_in > 0 && json.expires_in <= 86400 * 365) {
    tokens.expiresAt = Date.now() + json.expires_in * 1000;
  }
  return tokens;
}
async function bounded(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BODY) { await reader.cancel(); invalid(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}

/** The timeout covers DB receipt, all HTTP bodies, and standard-library validation.
 * An unacknowledged DB operation may finish after this rejects; it retains ownership.
 */
async function operation<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new CentralOidcError('central_timeout'));
    }, DEADLINE_MS);
  });
  try { return await Promise.race([run(controller.signal), timeout]); }
  catch (error) {
    // SDK errors can include response bodies, URLs and credentials. Never attach cause.
    if (error instanceof CentralOidcError) throw error;
    throw new CentralOidcError('central_unavailable');
  } finally { clearTimeout(timer!); }
}

export async function createCentralOidcClient(config: OidcConfig, repository: RepositoryPort) {
  const client = loadOidcClient();
  // Capture deployment data once, not a mutable object owned by a caller.
  config = Object.freeze({ ...config });
  endpoint(config.issuer, config.issuer);
  const credentials = {
    client_secret: config.clientSecret, id_token_signed_response_alg: 'ES256',
    [client.clockTolerance]: 0,
  };
  const discoveryUrl = `${config.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
  const discovered = await operation(async (signal) => client.discovery(
    new URL(config.issuer), config.clientId, credentials, client.ClientSecretBasic(config.clientSecret), {
      algorithm: 'oidc', timeout: DEADLINE_MS / 1000,
      [client.customFetch]: transport(new Map([[discoveryUrl, 'GET']]), signal),
    },
  ));
  const metadata = structuredClone(discovered.serverMetadata());
  metadataValid(metadata, config);
  const allowed = new Map<string, string>();
  for (const key of Object.keys(endpointMethods) as (keyof typeof endpointMethods)[]) {
    const address = endpoint(metadata[key], config.issuer);
    // Ambiguous metadata must not silently widen an endpoint's method.
    if (allowed.has(address) && allowed.get(address) !== endpointMethods[key]) invalid();
    allowed.set(address, endpointMethods[key]);
  }

  function transport(addresses: Map<string, string>, signal: AbortSignal, attempt?: Attempt): CustomFetch {
    let tokenSent = false;
    return async (url, options) => {
      signal.throwIfAborted();
      if (addresses.get(url) !== options.method || endpoint(url, config.issuer) !== url) invalid();
      if (attempt && url === metadata.token_endpoint) {
        if (tokenSent || options.method !== 'POST') invalid();
        tokenSent = true;
      }
      if (options.body != null && typeof options.body !== 'string' && !(options.body instanceof URLSearchParams)) invalid();
      const response = await fetch(url, {
        ...options, body: options.body?.toString(), redirect: 'manual', signal: options.signal ? AbortSignal.any([signal, options.signal]) : signal,
      });
      const body = await bounded(response);
      if (attempt && url === metadata.token_endpoint) {
        const tokens = material(body);
        if (tokens) await repository.recordResult(attempt.id, attempt.dispatchToken, tokens);
      }
      signal.throwIfAborted();
      if (response.status >= 300 && response.status < 400) invalid();
      return new Response(body || null, { status: response.status, headers: response.headers });
    };
  }
  function fresh(signal: AbortSignal, attempt?: Attempt): Configuration {
    const cfg = new client.Configuration(structuredClone(metadata), config.clientId, credentials, client.ClientSecretBasic(config.clientSecret));
    cfg.timeout = DEADLINE_MS / 1000;
    cfg[client.customFetch] = transport(allowed, signal, attempt);
    client.enableNonRepudiationChecks(cfg);
    return cfg;
  }
  function binding(attempt: Attempt) {
    if (attempt.issuer !== config.issuer || attempt.clientId !== config.clientId) invalid();
  }
  function identity(claims: IDToken, expectedSubject?: string, startedAt?: number) {
    const now = Math.floor(Date.now() / 1000);
    if (!text(claims.sub, 4096) || (expectedSubject && claims.sub !== expectedSubject) ||
        typeof claims.auth_time !== 'number' || !Number.isSafeInteger(claims.auth_time) || claims.auth_time <= 0 || claims.auth_time > now ||
        (startedAt !== undefined && claims.auth_time < Math.floor(startedAt / 1000)) ||
        (claims.sid !== undefined && !text(claims.sid, 4096))) invalid();
    return { subject: claims.sub, authTime: claims.auth_time * 1000, rootSid: claims.sid as string | undefined };
  }
  async function introspection(cfg: Configuration, accessToken: string, subject: string) {
    if (!text(accessToken) || !text(subject, 4096)) invalid();
    const data = await client.tokenIntrospection(cfg, accessToken);
    if (data.active === false) throw new CentralOidcError('central_inactive');
    if (data.active !== true || data.client_id !== config.clientId || data.sub !== subject ||
        typeof data.token_type !== 'string' || data.token_type.toLowerCase() !== 'bearer' ||
        !Number.isSafeInteger(data.exp) || data.exp! <= Math.floor(Date.now() / 1000)) invalid();
    // This identity-only issuer has no resource audience; no audience is guessed.
    return { subject, accessExpiresAt: data.exp! * 1000 };
  }
  return Object.freeze({
    async begin({ browser, link }: { browser: string; link?: LocalProof }) {
      return operation(async (signal) => {
        const nonce = client.randomNonce(), verifier = client.randomPKCECodeVerifier();
        const challenge = await client.calculatePKCECodeChallenge(verifier);
        const pending = await repository.prepare({
          issuer: config.issuer, clientId: config.clientId, redirectUri: config.redirectUri, browser, nonce, verifier, link,
        });
        signal.throwIfAborted();
        const url = client.buildAuthorizationUrl(fresh(signal), {
          redirect_uri: config.redirectUri, scope: 'openid profile email offline_access', response_type: 'code',
          state: pending.state, nonce, code_challenge: challenge, code_challenge_method: 'S256',
          prompt: link ? 'login consent' : 'consent', ...(link ? { max_age: '0' } : {}),
        });
        return { pendingId: pending.id, authorizationUrl: url.href };
      });
    },
    async exchange({ callbackUrl, browser }: { callbackUrl: string; browser: string }) {
      return operation(async (signal) => {
        const callback = new URL(callbackUrl);
        if (!callbackUrl.startsWith(`${config.redirectUri}?`) || callback.origin + callback.pathname !== config.redirectUri ||
            callback.username || callback.password || callback.hash || /[\\\s]/.test(callbackUrl)) invalid();
        const permitted = new Set(['code', 'state', 'iss', 'error', 'error_description', 'error_uri']);
        for (const key of callback.searchParams.keys()) {
          if (!permitted.has(key) || callback.searchParams.getAll(key).length !== 1) invalid();
        }
        const state = callback.searchParams.get('state');
        if (!text(state, 4096) || callback.searchParams.get('iss') !== config.issuer) invalid();
        const attempt = await repository.dispatchAuthorization(state, browser);
        binding(attempt);
        if (attempt.request.redirectUri !== config.redirectUri) invalid();
        signal.throwIfAborted();
        const cfg = fresh(signal, attempt);
        const tokens = await client.authorizationCodeGrant(cfg, callback, {
          expectedState: state, expectedNonce: attempt.request.nonce, pkceCodeVerifier: attempt.request.verifier, idTokenExpected: true,
        });
        const claims = tokens.claims();
        if (!claims) invalid();
        const verified = identity(claims, undefined, attempt.request.link ? attempt.startedAt : undefined);
        const live = await introspection(cfg, tokens.access_token, verified.subject);
        signal.throwIfAborted();
        return { attemptId: attempt.id, ...verified, ...live };
      });
    },
    async refresh(grantId: string) {
      return operation(async (signal) => {
        const attempt = await repository.beginRefresh(grantId);
        binding(attempt);
        signal.throwIfAborted();
        const cfg = fresh(signal, attempt);
        const tokens = await client.refreshTokenGrant(cfg, attempt.refreshToken);
        const claims = tokens.claims();
        const verified = claims ? identity(claims, attempt.subject) : { subject: attempt.subject };
        const live = await introspection(cfg, tokens.access_token, attempt.subject);
        signal.throwIfAborted();
        return { attemptId: attempt.id, ...verified, ...live };
      });
    },
    // Internal server methods, never mount as browser-controlled endpoints.
    async introspect(accessToken: string, subject: string) {
      return operation((signal) => introspection(fresh(signal), accessToken, subject));
    },
    async userInfo(accessToken: string, subject: string) {
      return operation(async (signal) => {
        if (!text(accessToken) || !text(subject, 4096)) invalid();
        const info = await client.fetchUserInfo(fresh(signal), accessToken, subject);
        return { subject, ...(info.email_verified === true && typeof info.email === 'string' &&
          info.email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(info.email) ? { verifiedEmail: info.email } : {}) };
      });
    },
    async revoke(token: string, hint: 'access_token' | 'refresh_token') {
      return operation(async (signal) => {
        if (!text(token) || !['access_token', 'refresh_token'].includes(hint)) invalid();
        await client.tokenRevocation(fresh(signal), token, { token_type_hint: hint });
      });
    },
  });
}
