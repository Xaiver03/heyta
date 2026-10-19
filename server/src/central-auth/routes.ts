import type { FastifyInstance, FastifyReply } from 'fastify';
import { CENTRAL_AUTH_PATHS } from '@heyta/shared-schema';
import { verifyToken } from '../auth';
import { sessionMetaFromRequest } from '../account/access-sessions';
import { isOfficialHostedInstance } from '../legal-consent';
import { LEGAL_SET_VERSION } from '../legal.generated';
import { randomSecret } from './crypto';
import type { CentralRuntime } from './runtime';
import { CentralHttpError, CENTRAL_COOKIES, clearCentralSession, createHttpSecurity, readCentralCredential, setCentralCookie, uniqueCookie } from './http-security';
import { CentralSessionError } from './coordinator';
import { CentralOidcError } from './oidc-client';
import { CentralPersistenceError } from './repository';

export async function centralAuthRoutes(server: FastifyInstance, runtime: CentralRuntime | undefined) {
  const origin = runtime && new URL(runtime.config.redirectUri).origin;
  const security = runtime && createHttpSecurity(runtime.cipher, origin!);
  const documentVersion = origin && isOfficialHostedInstance(origin) ? LEGAL_SET_VERSION : null;
  const unavailable = (reply: FastifyReply) => reply.code(409).send({ code: 'central_authentication_unavailable' });
  const failure = (reply: FastifyReply, error: unknown) => {
    if (error instanceof CentralHttpError) return reply.code(error.status).send({ code: error.code });
    if (error instanceof CentralOidcError && (error.code === 'central_invalid' || error.code === 'central_inactive'))
      return reply.code(400).send({ code: 'invalid_callback' });
    if (error instanceof CentralSessionError || error instanceof CentralOidcError)
      return reply.code(503).send({ code: 'CENTRAL_UNAVAILABLE' });
    if (error instanceof CentralPersistenceError) return reply.code(400).send({ code: 'invalid_callback' });
    // Never include provider diagnostics, callbacks or credential material in responses/logs.
    return reply.code(500).send({ code: 'central_authentication_failed' });
  };
  server.get(CENTRAL_AUTH_PATHS.config, async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { mode: runtime ? 'oidc' : 'local', loginPath: CENTRAL_AUTH_PATHS.start, documentVersion };
  });
  server.get(CENTRAL_AUTH_PATHS.session, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!runtime || !security) return unavailable(reply);
    try {
      const cookie = uniqueCookie(req.headers.cookie, CENTRAL_COOKIES.session);
      if (cookie === undefined && req.headers.authorization === undefined)
        return { authenticated: false, csrfToken: security.csrf(reply) };
      const { token } = readCentralCredential(req);
      const result = await verifyToken(token);
      if (!result.valid) {
        if (result.code === 'CENTRAL_UNAVAILABLE') return reply.code(503).send({ code: result.code });
        // The browser cannot remove HttpOnly credentials. Permit a fresh login
        // after a definitive local rejection, while preserving unknown sessions.
        clearCentralSession(reply);
        return reply.code(result.code === 'ACCOUNT_CLOSED' ? 410 : 401).send({ code: result.code, csrfToken: security.csrf(reply) });
      }
      return { authenticated: true, user: { id: result.userId, email: result.email }, csrfToken: security.csrf(reply, token) };
    } catch (error) { return failure(reply, error); }
  });
  server.post(CENTRAL_AUTH_PATHS.start, { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!runtime || !security) return unavailable(reply);
    try {
      const existing = uniqueCookie(req.headers.cookie, CENTRAL_COOKIES.session);
      if (req.headers.authorization !== undefined) throw new CentralHttpError(400, 'ambiguous_credentials');
      security.verifyCsrf(req, existing);
      const body = req.body ?? {};
      if (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !['termsAccepted', 'documentVersion'].includes(key)))
        throw new CentralHttpError(400, 'invalid_request');
      const input = body as { termsAccepted?: unknown; documentVersion?: unknown };
      if ((input.termsAccepted !== undefined && typeof input.termsAccepted !== 'boolean') ||
          (input.documentVersion !== undefined && (input.termsAccepted !== true || input.documentVersion !== documentVersion)))
        throw new CentralHttpError(400, 'invalid_terms_consent');
      if (input.termsAccepted === true && (!documentVersion || input.documentVersion !== documentVersion))
        throw new CentralHttpError(400, 'invalid_terms_consent');
      const terms = input.termsAccepted === true ? { acceptedAt: Date.now(), documentVersion: documentVersion! } : undefined;
      const browser = randomSecret();
      const result = await runtime.coordinator.begin({ browser });
      security.writePending(reply, { browser, pendingId: result.pendingId, terms });
      return { authorizationUrl: result.authorizationUrl };
    } catch (error) { return failure(reply, error); }
  });
  server.get(CENTRAL_AUTH_PATHS.callback, async (req, reply) => {
    reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
    if (!runtime || !security) return unavailable(reply);
    try {
      const pending = security.readPending(req);
      const raw = req.raw.url ?? '';
      const query = raw.includes('?') ? raw.slice(raw.indexOf('?')) : '';
      if (query.length > 8192) throw new CentralHttpError(400, 'invalid_callback');
      const callbackUrl = new URL(runtime.config.redirectUri + query);
      const keys = [...callbackUrl.searchParams.keys()];
      if (new Set(keys).size !== keys.length) throw new CentralHttpError(400, 'invalid_callback');
      const result = await runtime.coordinator.authorize({ callbackUrl: callbackUrl.href, browser: pending.browser,
        terms: pending.terms, meta: sessionMetaFromRequest(req) });
      setCentralCookie(reply, 'pending', '', 0);
      if (!result.token || !result.expiresAt) throw new CentralHttpError(409, 'authentication_restart_required');
      setCentralCookie(reply, 'session', result.token, (result.expiresAt - Date.now()) / 1000);
      security.csrf(reply, result.token);
      return reply.code(303).header('Location', `${origin}/app/`).send();
    } catch (error) { setCentralCookie(reply, 'pending', '', 0); return failure(reply, error); }
  });
}
