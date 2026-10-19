import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => { process.env.JWT_SECRET = 'b'.repeat(64); });
import { apiRoutes } from '../src/api';
import { accountSecurityRoutes } from '../src/account/account-security.routes';
import { pageRoutes } from '../src/pages';
import { installCentralRoutePolicy, LOCAL_CREDENTIAL_PATHS } from '../src/central-auth/route-policy';
import { prisma } from '../src/db';

describe('official local credential closure', () => {
  it('blocks every actual registered password/passkey/magic/email route before validation, auth or database work', async () => {
    const app = Fastify();
    const registered: Array<{ method: string; url: string }> = [];
    const passed = vi.fn();
    app.addHook('onRoute', (route) => { for (const method of [route.method].flat()) if (method !== 'HEAD') registered.push({ method, url: route.url }); });
    installCentralRoutePolicy(app);
    app.addHook('preValidation', async () => { passed(); });
    await app.register(apiRoutes, { prefix: '/api', requireTermsConsent: false });
    await app.register(accountSecurityRoutes, { prefix: '/api' });
    await app.register(pageRoutes);
    await app.ready(); vi.clearAllMocks();
    const credentials = registered.filter((route) => /^\/api\/(?:register|login|recover|passkeys|verify-email|auth\/(?:password|email|register|login))/.test(route.url) || LOCAL_CREDENTIAL_PATHS.has(route.url));
    expect(credentials.length).toBeGreaterThan(30);
    for (const route of credentials) {
      expect(LOCAL_CREDENTIAL_PATHS.has(route.url), route.url).toBe(true);
      const response = await app.inject({ method: route.method as 'POST', url: route.url.replace(':id', '1') });
      expect(response.statusCode, `${route.method} ${route.url}`).toBe(409);
      expect(response.json().code).toBe('central_authentication_required');
    }
    expect(passed).not.toHaveBeenCalled(); expect(prisma.user.findUnique).not.toHaveBeenCalled();
    // Product key material and profile routes must remain outside the credential fence.
    expect(LOCAL_CREDENTIAL_PATHS.has('/api/sync/key-package')).toBe(false);
    expect(LOCAL_CREDENTIAL_PATHS.has('/api/account')).toBe(false);
    await app.close();
  });
});
