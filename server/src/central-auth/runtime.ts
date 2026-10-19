/** One process owns one auth runtime, matching the existing Prisma/WS lifetime. */
import type { AuthenticationConfig } from './config';
import { CredentialCipher } from './crypto';
import { CentralAuthRepository } from './repository';
import { createCentralAuthCoordinator, CentralSessionError } from './coordinator';
import { createCentralAuthWorker } from './worker';
import { centralSessionIssuer } from './session-issuer';
import { prisma } from '../db';
import { authCache } from '../auth-cache';
import { Logger } from '../logger';

export type CentralRuntime = {
  config: Extract<AuthenticationConfig, { mode: 'oidc' }>;
  cipher: CredentialCipher;
  coordinator: Awaited<ReturnType<typeof createCentralAuthCoordinator>>;
  worker: Awaited<ReturnType<typeof createCentralAuthWorker>>;
};
let owner: object | undefined;
let mode: 'local' | 'oidc' | undefined;
let active: CentralRuntime | undefined;

export function centralRuntime(): CentralRuntime | undefined {
  if (active) return active;
  if (mode === 'local') return undefined;
  if (mode === 'oidc' || process.env.HEYTA_AUTH_DEPLOYMENT === 'official' ||
      (process.env.HEYTA_AUTH_MODE !== undefined && process.env.HEYTA_AUTH_MODE !== 'local'))
    throw new CentralSessionError('central_unavailable');
  return undefined;
}

export function assertAuthenticationRuntimeUnowned(): void {
  if (owner) throw new Error('Authentication runtime already owned');
}
export async function acquireAuthenticationRuntime(config: AuthenticationConfig) {
  assertAuthenticationRuntimeUnowned();
  const mine = {}; owner = mine; mode = config.mode; authCache.clear();
  const release = () => { if (owner === mine) { active = undefined; mode = undefined; owner = undefined; authCache.clear(); } };
  try {
    if (config.mode === 'oidc') {
      const fixed = Object.freeze({ ...config });
      const cipher = new CredentialCipher(fixed.sessionEncryptionKey);
      const repository = new CentralAuthRepository(prisma, cipher, centralSessionIssuer());
      const coordinator = await createCentralAuthCoordinator(fixed, repository);
      const worker = await createCentralAuthWorker(fixed, repository, (report) => {
        if (report.failed || report.expiredUnconfirmed) Logger.warn('[central-auth] cleanup report', report);
      });
      active = { config: fixed, cipher, coordinator, worker };
    }
    const runtime = active;
    let stopping: Promise<void> | undefined;
    return {
      runtime,
      start() { if (owner !== mine) throw new Error('Authentication runtime released'); runtime?.worker.start(); },
      stop(beforeRelease?: () => Promise<void>) {
        if (stopping) return stopping;
        if (owner !== mine) return Promise.resolve();
        stopping = (async () => {
          try { await runtime?.worker.stop(); }
          finally { try { await beforeRelease?.(); } finally { release(); } }
        })();
        return stopping;
      },
    };
  } catch (error) { release(); throw error; }
}
