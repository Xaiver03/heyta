import type { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
/** Internal services only. B2 wires HTTP/WS/auth-cache entry points separately. */
import type { AuthenticationConfig } from './config';
import { createCentralOidcClient, CentralOidcError } from './oidc-client';
import { CentralAuthRepository, CentralPersistenceError, type CentralSessionBinding, type CentralLiveSnapshot, type LocalProof } from './repository';
import { SESSION_MAX_AGE_MS } from './session-policy';
import { deleteAccountWithTombstone } from '../account/account-tombstones';
import { authCache } from '../auth-cache';
import type { SessionMeta } from '../account/access-sessions';
import { getWsConnectionService } from '../sync/services/websocket-connection.service';
import { randomSecret } from './crypto';

type OidcConfig = Extract<AuthenticationConfig, { mode: 'oidc' }>;
type Oidc = Awaited<ReturnType<typeof createCentralOidcClient>>;
export class CentralSessionError extends Error {
  constructor(readonly code: 'session_inactive' | 'central_unavailable') { super(code); }
}
/** The only public factory constructs the fixed-endpoint standard protocol client. */
export async function createCentralAuthCoordinator(config: OidcConfig, repository: CentralAuthRepository) {
  return new CentralAuthCoordinator(Object.freeze({ ...config }), repository, await createCentralOidcClient(config, repository));
}
class CentralAuthCoordinator {
  private readonly refreshing = new Map<string, Promise<void>>();
  constructor(private readonly config: OidcConfig, private readonly repo: CentralAuthRepository, private readonly oidc: Oidc) {}
  begin(input: { browser: string; link?: LocalProof }) { return this.oidc.begin(input); }
  async beginDevice(input: { deviceChallenge: string; terms?: { acceptedAt: number; documentVersion: string } }) {
    const browser = randomSecret(), launchSecret = randomSecret();
    const pairingCode = randomBytes(6).toString('hex').toUpperCase();
    const pending = await this.oidc.begin({ browser });
    const handoff = await this.repo.createHandoff({ pendingId: pending.pendingId, browser,
      deviceChallenge: input.deviceChallenge, launchSecret, pairingCode,
      authorizationUrl: pending.authorizationUrl, terms: input.terms });
    return { handoffId: handoff.id, launchSecret, pairingCode, expiresAt: handoff.expiresAt };
  }
  inspectDeviceLaunch(secret: string) { return this.repo.inspectHandoffLaunch(secret); }
  launchDevice(secret: string, pairingCode: string) { return this.repo.launchHandoff(secret, pairingCode); }
  claimDevice(id: string, verifier: string) { return this.repo.claimHandoff(id, verifier); }
  handoffForPending(id: string) { return this.repo.handoffForPending(id); }
  async authorize(input: { callbackUrl: string; browser: string; meta?: SessionMeta;
    terms?: { acceptedAt: number; documentVersion: string }; handoffId?: string }) {
    const verified = await this.oidc.exchange(input);
    const result = await this.repo.readResult(verified.attemptId);
    if (result.issuer !== this.config.issuer || result.clientId !== this.config.clientId || !result.tokens.accessToken)
      throw new CentralSessionError('central_unavailable');
    const info = await this.oidc.userInfo(result.tokens.accessToken, verified.subject);
    return this.repo.completeAuthorization({ attemptId: verified.attemptId, subject: verified.subject, rootSid: verified.rootSid,
      expiresAt: Date.now() + SESSION_MAX_AGE_MS, accessExpiresAt: verified.accessExpiresAt, meta: input.meta,
      handoffId: input.handoffId,
      ...(info.verifiedEmail && input.terms ? { newUser: { email: info.verifiedEmail,
        termsAcceptedAt: input.terms.acceptedAt, termsDocumentVersion: input.terms.documentVersion } } : {}) });
  }
  private binding(input: Pick<CentralSessionBinding, 'userId' | 'sessionHash' | 'tokenVersion'>): CentralSessionBinding {
    if (!Number.isSafeInteger(input.userId) || input.userId <= 0 ||
        !Number.isSafeInteger(input.tokenVersion) || input.tokenVersion < 0 ||
        typeof input.sessionHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.sessionHash))
      throw new CentralSessionError('session_inactive');
    // Issuer/client always come from fixed deployment configuration.
    return { userId: input.userId, sessionHash: input.sessionHash, tokenVersion: input.tokenVersion,
      issuer: this.config.issuer, clientId: this.config.clientId };
  }
  private refresh(snapshot: CentralLiveSnapshot) {
    let pending = this.refreshing.get(snapshot.grantId);
    if (!pending) {
      pending = (async () => {
        const current = await this.repo.readLive(snapshot);
        if (current.version !== snapshot.version) return;
        const verified = await this.oidc.refresh(snapshot.grantId);
        // Never substitute access-token expiry for the absolute product grant bound.
        await this.repo.completeRefresh(verified.attemptId, snapshot.expiresAt, verified.accessExpiresAt);
      })();
      this.refreshing.set(snapshot.grantId, pending);
      void pending.finally(() => { if (this.refreshing.get(snapshot.grantId) === pending) this.refreshing.delete(snapshot.grantId); }).catch(() => {});
    }
    return pending;
  }
  async live(input: Pick<CentralSessionBinding, 'userId' | 'sessionHash' | 'tokenVersion'>) {
    let snapshot: CentralLiveSnapshot | undefined;
    try {
      snapshot = await this.repo.readLive(this.binding(input));
      if (snapshot.tokens.expiresAt !== undefined && snapshot.tokens.expiresAt <= Date.now()) {
        await this.refresh(snapshot);
        snapshot = await this.repo.readLive(this.binding(input));
      }
      if (!snapshot.tokens.accessToken) throw new CentralSessionError('session_inactive');
      const active = await this.oidc.introspect(snapshot.tokens.accessToken, snapshot.subject);
      return await this.repo.confirmLive(snapshot, active.accessExpiresAt);
    } catch (error) {
      if (error instanceof CentralOidcError && error.code === 'central_inactive' && snapshot) {
        if (await this.repo.revokeSnapshot(snapshot)) this.invalidate(input.userId, input.sessionHash);
        throw new CentralSessionError('session_inactive');
      }
      if (error instanceof CentralPersistenceError && error.code === 'session_inactive')
        throw new CentralSessionError('session_inactive');
      if (error instanceof CentralSessionError) throw error;
      // Network uncertainty, a concurrent rotation, or an unacknowledged COMMIT is retryable.
      // None is an account-closure signal; never invoke E2EE/account deletion here.
      throw new CentralSessionError('central_unavailable');
    }
  }
  private invalidate(userId: number, sessionHash?: string) {
    authCache.invalidate(userId);
    if (sessionHash) getWsConnectionService().closeForSession(userId, sessionHash);
    else getWsConnectionService().closeForUser(userId);
  }
  async logout(userId: number, sessionHash: string) {
    const changed = await this.repo.revokeSession(userId, sessionHash);
    this.invalidate(userId, sessionHash);
    return changed;
  }
  async logoutProduct(userId: number, mutate?: (tx: Prisma.TransactionClient) => Promise<void>) {
    return this.repo.revokeUserSessions(userId, (id) => this.invalidate(id), mutate);
  }
  async closeProductAccount(userId: number) {
    await this.repo.prepareUserClosure(userId, async (tx) => { await deleteAccountWithTombstone(tx, userId); });
    this.invalidate(userId);
  }
}
