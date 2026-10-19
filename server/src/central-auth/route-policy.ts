import { AUTH_PASSWORD_PATHS, EMAIL_CHANGE_PATHS } from '@heyta/shared-schema';
import type { FastifyInstance } from 'fastify';
import { CENTRAL_AUTH_REQUIRED } from '@heyta/shared-schema';

export const LOCAL_CREDENTIAL_PATHS = new Set([
  ...Object.values(AUTH_PASSWORD_PATHS).map((p) => `/api${p}`),
  ...Object.values(EMAIL_CHANGE_PATHS).map((p) => `/api/${p}`),
  '/api/verify-email', '/api/auth/email/verify',
  ...['register/passkey/options', 'register/passkey/verify', 'login/passkey/options', 'login/passkey/verify',
    'recover/passkey', 'recover/passkey/options', 'recover/passkey/complete', 'passkeys', 'passkeys/:id',
    'passkeys/registration/options', 'passkeys/registration/complete', 'register/magic-link', 'login/magic-link', 'login/magic-link/verify'].map((p) => `/api/${p}`),
  '/verify-email', '/recover-passkey', '/magic-login', '/reset-password', '/change-email',
]);
export function installCentralRoutePolicy(server: FastifyInstance) {
  server.addHook('onRequest', async (req, reply) => {
    if (LOCAL_CREDENTIAL_PATHS.has(req.routeOptions.url ?? ''))
      return reply.code(409).send({ code: CENTRAL_AUTH_REQUIRED, message: CENTRAL_AUTH_REQUIRED });
  });
}
