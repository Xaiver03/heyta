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

const DEVICE_SECRET = /^[A-Za-z0-9_-]{43}$/;
const DEVICE_CHALLENGE = /^[a-f0-9]{64}$/;
const DEVICE_ID = /^[0-9a-f-]{36}$/;
function strictBody(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some((key) => !keys.includes(key))) throw new CentralHttpError(400, 'invalid_request');
  return value as Record<string, unknown>;
}

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
    if (error instanceof CentralPersistenceError && error.code === 'handoff_unavailable')
      return reply.code(410).send({ code: 'handoff_unavailable' });
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
  server.post(CENTRAL_AUTH_PATHS.deviceStart, { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!runtime || !origin) return unavailable(reply);
    try {
      if (req.headers.authorization !== undefined || req.headers.cookie !== undefined ||
          (req.headers.origin !== undefined && req.headers.origin !== origin) ||
          (req.headers['sec-fetch-site'] !== undefined && req.headers['sec-fetch-site'] !== 'same-origin'))
        throw new CentralHttpError(403, 'forbidden');
      const body = strictBody(req.body, ['deviceChallenge', 'termsAccepted', 'documentVersion']);
      if (typeof body.deviceChallenge !== 'string' || !DEVICE_CHALLENGE.test(body.deviceChallenge))
        throw new CentralHttpError(400, 'invalid_request');
      if ((body.termsAccepted !== undefined && body.termsAccepted !== true) ||
          (body.documentVersion !== undefined && (body.termsAccepted !== true || body.documentVersion !== documentVersion)) ||
          (body.termsAccepted === true && (!documentVersion || body.documentVersion !== documentVersion)))
        throw new CentralHttpError(400, 'invalid_terms_consent');
      const terms = body.termsAccepted === true ? { acceptedAt: Date.now(), documentVersion: documentVersion! } : undefined;
      const result = await runtime.coordinator.beginDevice({ deviceChallenge: body.deviceChallenge, terms });
      return { handoffId: result.handoffId, launchUrl: `${origin}${CENTRAL_AUTH_PATHS.deviceLaunch}/${result.launchSecret}`,
        pairingCode: result.pairingCode, expiresAt: result.expiresAt };
    } catch (error) { return failure(reply, error); }
  });
  server.get(`${CENTRAL_AUTH_PATHS.deviceLaunch}/:secret`, async (req, reply) => {
    reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer')
      .header('Content-Security-Policy', "default-src 'none'; form-action 'self'; base-uri 'none'");
    if (!runtime || !security) return unavailable(reply);
    try {
      const { secret } = req.params as { secret?: string };
      if (!secret || !DEVICE_SECRET.test(secret)) throw new CentralHttpError(404, 'handoff_unavailable');
      await runtime.coordinator.inspectDeviceLaunch(secret);
      const page = security.writeLaunchPage(reply, secret);
      return reply.type('text/html; charset=utf-8').send(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>heyta 登录确认</title><body><main><h1>继续登录 heyta</h1><p>请核对发起设备上显示的 12 位确认码；只有代码相同才继续。完成后，登录会交给该设备。</p><form method="post" enctype="text/plain" action="${CENTRAL_AUTH_PATHS.deviceLaunch}"><input type="hidden" name="launch" value="${secret}"><input type="hidden" name="page" value="${page}"><label>设备确认码 <input name="code" required pattern="[A-Fa-f0-9]{12}" maxlength="12" autocomplete="off"></label><button type="submit">确认并继续</button></form></main></body></html>`);
    } catch (error) { return failure(reply, error); }
  });
  server.post(CENTRAL_AUTH_PATHS.deviceLaunch, { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
    if (!runtime || !security) return unavailable(reply);
    try {
      if (typeof req.body !== 'string' || req.body.length > 512 ||
          !req.headers['content-type']?.startsWith('text/plain')) throw new CentralHttpError(400, 'invalid_request');
      const lines = req.body.trimEnd().split(/\r?\n/);
      if (lines.length !== 3) throw new CentralHttpError(400, 'invalid_request');
      const fields = new Map<string, string>();
      for (const line of lines) {
        const index = line.indexOf('=');
        if (index < 1 || fields.has(line.slice(0, index))) throw new CentralHttpError(400, 'invalid_request');
        fields.set(line.slice(0, index), line.slice(index + 1));
      }
      const secret = fields.get('launch'), page = fields.get('page'), code = fields.get('code')?.toUpperCase();
      if (!secret || !page || !code || fields.size !== 3) throw new CentralHttpError(400, 'invalid_request');
      security.verifyLaunchPage(req, secret, page);
      const result = await runtime.coordinator.launchDevice(secret, code);
      security.writePending(reply, { browser: result.browser, pendingId: result.pendingId, terms: result.terms });
      setCentralCookie(reply, 'launch', '', 0);
      return reply.code(303).header('Location', result.authorizationUrl).send();
    } catch (error) { return failure(reply, error); }
  });
  server.post(CENTRAL_AUTH_PATHS.deviceClaim, { config: { rateLimit: { max: 150, timeWindow: '15 minutes' } } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!runtime || !origin) return unavailable(reply);
    try {
      if (req.headers.authorization !== undefined || req.headers.cookie !== undefined ||
          (req.headers.origin !== undefined && req.headers.origin !== origin) ||
          (req.headers['sec-fetch-site'] !== undefined && req.headers['sec-fetch-site'] !== 'same-origin'))
        throw new CentralHttpError(403, 'forbidden');
      const body = strictBody(req.body, ['handoffId', 'verifier']);
      if (typeof body.handoffId !== 'string' || !DEVICE_ID.test(body.handoffId) ||
          typeof body.verifier !== 'string' || !DEVICE_SECRET.test(body.verifier))
        throw new CentralHttpError(400, 'invalid_request');
      const result = await runtime.coordinator.claimDevice(body.handoffId, body.verifier);
      if (result.status === 'pending') return reply.code(202).send({ status: 'pending' });
      return { status: 'claimed', token: result.token, user: result.user, expiresAt: result.expiresAt };
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
      const handoff = await runtime.coordinator.handoffForPending(pending.pendingId);
      const result = await runtime.coordinator.authorize({ callbackUrl: callbackUrl.href, browser: pending.browser,
        terms: pending.terms, meta: sessionMetaFromRequest(req), handoffId: handoff?.id });
      setCentralCookie(reply, 'pending', '', 0);
      if (handoff) return reply.type('text/html; charset=utf-8').header('Referrer-Policy', 'no-referrer')
        .header('Content-Security-Policy', "default-src 'none'; base-uri 'none'")
        .send('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>heyta 登录完成</title><body><main><h1>登录已完成</h1><p>请返回发起登录的设备继续。</p></main></body></html>');
      if (!result.token || !result.expiresAt) throw new CentralHttpError(409, 'authentication_restart_required');
      setCentralCookie(reply, 'session', result.token, (result.expiresAt - Date.now()) / 1000);
      security.csrf(reply, result.token);
      return reply.code(303).header('Location', `${origin}/app/`).send();
    } catch (error) { setCentralCookie(reply, 'pending', '', 0); return failure(reply, error); }
  });
}
