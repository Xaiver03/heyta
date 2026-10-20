/** Real TLS + PostgreSQL + the real sole JWT mint. No runtime routes are mounted. */
import { sessionIssuer } from '../fixtures/central-session-issuer';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as jwt from 'jsonwebtoken';
import { CentralAuthRepository, type CentralSessionIssuer } from '../../src/central-auth/repository';
import { CredentialCipher, randomSecret } from '../../src/central-auth/crypto';
import { createCentralAuthCoordinator } from '../../src/central-auth/coordinator';
import { createCentralOidcClient } from '../../src/central-auth/oidc-client';
import { createCentralAuthWorker, type RevocationReport } from '../../src/central-auth/worker';
import { SESSION_MAX_AGE_MS } from '../../src/central-auth/session-policy';
import { sessionIdOf } from '../../src/account/access-sessions';
import { CentralOidcProvider } from '../fixtures/central-oidc-provider';
import type { IncomingMessage, ServerResponse } from 'node:http';
const url = process.env.HEYTA_CENTRAL_TEST_DATABASE_URL;
if (!url) throw new Error('Explicit isolated PostgreSQL URL required');
const target = new URL(url);
if (!['127.0.0.1','localhost'].includes(target.hostname) || !/^\/heyta_central_auth_oidc[a-z0-9_]*test$/.test(target.pathname) || target.search || target.hash) throw new Error('Unsafe fixture database');
const db = new PrismaClient({ datasources: { db: { url } } });
const cipher = new CredentialCipher('44'.repeat(32));
let repo: CentralAuthRepository, provider: CentralOidcProvider;
let coordinator: Awaited<ReturnType<typeof createCentralAuthCoordinator>>;
beforeEach(async () => {
  await db.centralRevocation.deleteMany(); await db.centralGrant.deleteMany(); await db.centralAttempt.deleteMany();
  await db.centralPending.deleteMany(); await db.centralIdentity.deleteMany();
  await db.user.deleteMany({ where: { email: { endsWith: '@central.test' } } });
  await db.accountTombstone.deleteMany();
  repo = new CentralAuthRepository(db, cipher, sessionIssuer);
  provider = await new CentralOidcProvider().start();
  coordinator = await createCentralAuthCoordinator(provider.config(), repo);
});
afterEach(async () => provider.close());
afterAll(async () => db.$disconnect());
async function login(subject?: string, service = coordinator) {
  const browser = randomSecret(), pending = await service.begin({ browser });
  const callbackUrl = await provider.callback(pending.authorizationUrl);
  if (subject) provider.codes.get(new URL(callbackUrl).searchParams.get('code')!)!.subject = subject;
  const result = await service.authorize({ browser, callbackUrl, meta: { userAgent: 'synthetic-coordinator-test' }, terms: { acceptedAt: Date.now(), documentVersion: 'test@1' } });
  if (result.alreadyApplied || !result.token || !result.sessionHash || !result.userId) throw new Error('No newly committed session');
  const grant = await db.centralGrant.findUniqueOrThrow({ where: { id: result.grantId } });
  return { result, grant, binding: { userId: result.userId, sessionHash: result.sessionHash, tokenVersion: grant.tokenVersion } };
}
async function expireAccess(grantId: string) {
  const grant = await db.centralGrant.findUniqueOrThrow({ where: { id: grantId } });
  const aad = `grant:${grant.id}:${grant.version}`;
  const tokens = cipher.open<Record<string, unknown>>(aad, grant.tokensCipher!);
  await db.centralGrant.update({ where: { id: grantId }, data: { tokensCipher: cipher.seal(aad, { ...tokens, expiresAt: 1 }) } });
}
function intercept(path: string, handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) {
  const original = provider.server.listeners('request')[0] as (req: IncomingMessage, res: ServerResponse) => void;
  provider.server.removeAllListeners('request');
  provider.server.on('request', (req, res) => req.url?.endsWith(path) ? handler(req, res, () => original(req, res)) : original(req, res));
}
function barrier() {
  let release!: () => void, entered!: () => void;
  return { held: new Promise<void>((r) => release = r), reached: new Promise<void>((r) => entered = r), release: () => release(), enter: () => entered() };
}
describe('central coordinator durable sessions', () => {
  it('commits exactly one real minted session, binds its JWT and clamps the absolute lifetime', async () => {
    const { result, grant, binding } = await login();
    const payload = jwt.verify(result.token!, process.env.JWT_SECRET!) as jwt.JwtPayload;
    expect(sessionIdOf(payload.jti!)).toBe(grant.sessionHash);
    expect(payload.userId).toBe(grant.userId); expect(payload.tokenVersion).toBe(grant.tokenVersion);
    expect(await db.accessSession.count()).toBe(1);
    expect((await db.accessSession.findFirst())?.userAgent).toBe('synthetic-coordinator-test');
    expect(grant.expiresAt.getTime() - Date.now()).toBeGreaterThan(SESSION_MAX_AGE_MS - 5000);
    expect(grant.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(SESSION_MAX_AGE_MS);
    expect(payload.exp! * 1000).toBeLessThanOrEqual(grant.expiresAt.getTime());
    expect(await coordinator.live(binding)).toEqual(binding);
    const again = await repo.completeAuthorization({ accessExpiresAt: Date.now() + 300_000, attemptId: grant.authorizationAttemptId, subject: grant.subject, expiresAt: Date.now() + SESSION_MAX_AGE_MS });
    expect(again.alreadyApplied).toBe(true); expect(again.token).toBeUndefined(); expect(await db.accessSession.count()).toBe(1);
  });
  it('caps an oversized trusted grant request and rejects expired live evidence', async () => {
    const a=await login();
    const pending=await repo.prepare({issuer:provider.issuer,clientId:provider.clientId,redirectUri:provider.redirectUri,
      browser:'synthetic-browser',nonce:randomSecret(),verifier:randomSecret()});
    const attempt=await repo.dispatchAuthorization(pending.state,'synthetic-browser');
    await repo.recordResult(attempt.id,attempt.dispatchToken,{accessToken:'synthetic-test-access'});
    const before=Date.now();
    const applied=await repo.completeAuthorization({ accessExpiresAt: Date.now() + 300_000,attemptId:attempt.id,subject:a.grant.subject,expiresAt:before+2*SESSION_MAX_AGE_MS});
    const grant=await db.centralGrant.findUniqueOrThrow({where:{id:applied.grantId}});
    expect(grant.expiresAt.getTime()).toBeLessThanOrEqual(Date.now()+SESSION_MAX_AGE_MS);
    const snap=await repo.readLive({...a.binding,issuer:provider.issuer,clientId:provider.clientId});
    await expect(repo.confirmLive(snap,Date.now()-1)).rejects.toMatchObject({code:'session_changed'});
  });
  it('rejects an issuer receipt that has no actual session row in the transaction', async () => {
    const invalid=new CentralAuthRepository(db,cipher,async()=>({token:'synthetic-unusable-token',sessionHash:'a'.repeat(64)}));
    const service=await createCentralAuthCoordinator(provider.config(),invalid);
    await expect(login(undefined,service)).rejects.toMatchObject({code:'session_issuer_invalid'});
    expect(await db.accessSession.count()).toBe(0);expect(await db.user.count()).toBe(0);expect(await db.centralGrant.count()).toBe(0);
  });
  it('rejects protocol evidence expiring during UserInfo and leaves no minted account/session', async () => {
    intercept('/introspect', (_q,res) => {
      res.writeHead(200, {'content-type':'application/json'});
      res.end(JSON.stringify({active:true,client_id:provider.clientId,sub:provider.issued.at(-1)!.subject,
        token_type:'Bearer',exp:Math.floor(Date.now()/1000)+1}));
    });
    intercept('/userinfo', (_q,_r,next) => { setTimeout(next,1200); });
    await expect(login()).rejects.toMatchObject({code:'access_evidence_expired'});
    expect(await db.user.count()).toBe(0);expect(await db.accessSession.count()).toBe(0);expect(await db.centralGrant.count()).toBe(0);
    expect((await db.centralAttempt.findMany())[0].status).toBe('RESULT');
  });
  it('rolls back the real mint if verified access evidence expires inside the issuer', async () => {
    intercept('/introspect', (_q,res) => {
      res.writeHead(200, {'content-type':'application/json'});
      res.end(JSON.stringify({active:true,client_id:provider.clientId,sub:provider.issued.at(-1)!.subject,
        token_type:'Bearer',exp:Math.floor(Date.now()/1000)+1}));
    });
    let issued=0;
    const delayed=new CentralAuthRepository(db,cipher,async(...args)=>{
      const result=await sessionIssuer(...args); issued++;
      await new Promise(r=>setTimeout(r,1200));
      return result;
    });
    const service=await createCentralAuthCoordinator(provider.config(),delayed);
    await expect(login(undefined,service)).rejects.toMatchObject({code:'access_evidence_expired'});
    expect(issued).toBe(1);expect(await db.user.count()).toBe(0);expect(await db.accessSession.count()).toBe(0);
    expect(await db.centralIdentity.count()).toBe(0);expect(await db.centralGrant.count()).toBe(0);
    expect((await db.centralAttempt.findMany())[0].status).toBe('RESULT');
  });
  it('rejects a verified refresh that expires while waiting for the user row lock', async () => {
    const a=await login();
    intercept('/introspect', (_q,res) => {
      res.writeHead(200, {'content-type':'application/json'});
      res.end(JSON.stringify({active:true,client_id:provider.clientId,sub:provider.issued.at(-1)!.subject,
        token_type:'Bearer',exp:Math.floor(Date.now()/1000)+1}));
    });
    const oidc=await createCentralOidcClient(provider.config(),repo);
    const verified=await oidc.refresh(a.grant.id);
    const gate=barrier();
    const blocker=db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${a.binding.userId} FOR UPDATE`;
      gate.enter();await gate.held;
    });
    await gate.reached;
    const applying=repo.completeRefresh(verified.attemptId,a.grant.expiresAt.getTime(),verified.accessExpiresAt);
    const rejected=expect(applying).rejects.toMatchObject({code:'access_evidence_expired'});
    await new Promise(r=>setTimeout(r,Math.max(0,verified.accessExpiresAt-Date.now())+100));
    gate.release();await blocker;await rejected;
    const after=await db.centralGrant.findUniqueOrThrow({where:{id:a.grant.id}});
    expect(after.version).toBe(a.grant.version);expect(after.tokensCipher).toBe(a.grant.tokensCipher);
    expect(after.activeAttemptId).toBe(verified.attemptId);expect(after.revokedAt).toBeNull();
    expect((await repo.inspectAttempt(verified.attemptId))?.status).toBe('RESULT');
    expect(await db.centralRevocation.count()).toBe(0);expect(await db.accessSession.count()).toBe(1);
  });
  it('requires explicit finite verified evidence and never falls back to token-response expiry',async()=>{
    const a=await login();
    const input={issuer:provider.issuer,clientId:provider.clientId,redirectUri:provider.redirectUri,
      browser:'synthetic-browser',nonce:randomSecret(),verifier:randomSecret()};
    const pending=await repo.prepare(input),attempt=await repo.dispatchAuthorization(pending.state,input.browser);
    await repo.recordResult(attempt.id,attempt.dispatchToken,{accessToken:'synthetic-unverified-expiry',expiresAt:Date.now()+300_000});
    await expect(repo.completeAuthorization({attemptId:attempt.id,subject:a.grant.subject,expiresAt:Date.now()+3600_000,
      accessExpiresAt:undefined as unknown as number})).rejects.toMatchObject({code:'invalid_time'});
    const refresh=await repo.beginRefresh(a.grant.id);
    await repo.recordResult(refresh.id,refresh.dispatchToken,{accessToken:'synthetic-unverified-refresh-expiry',expiresAt:Date.now()+300_000});
    await expect(repo.completeRefresh(refresh.id,a.grant.expiresAt.getTime(),undefined as unknown as number)).rejects.toMatchObject({code:'invalid_time'});
    expect((await repo.inspectAttempt(attempt.id))?.status).toBe('RESULT');
    expect((await repo.inspectAttempt(refresh.id))?.status).toBe('RESULT');
    expect(await db.accessSession.count()).toBe(1);
  });
  it('rejects unverified email onboarding and never merges an existing email', async () => {
    provider.nextMode = 'unverified-email';
    await expect(login()).rejects.toMatchObject({ code: 'onboarding_required' });
    expect(await db.user.count()).toBe(0); expect(await db.accessSession.count()).toBe(0);
    await db.user.create({ data: { email: 'fixture@central.test' } });
    await expect(login()).rejects.toMatchObject({ code: 'binding_required' });
    expect(await db.centralIdentity.count()).toBe(0);
  });
  it('rolls back identity/session/grant when issuance fails after the real mint', async () => {
    const failed = new CentralAuthRepository(db, cipher, async (...args) => { await sessionIssuer(...args); throw new Error('synthetic issuance failure'); });
    const service = await createCentralAuthCoordinator(provider.config(), failed);
    await expect(login(undefined, service)).rejects.toThrow('synthetic issuance failure');
    expect(await db.accessSession.count()).toBe(0); expect(await db.centralGrant.count()).toBe(0); expect(await db.user.count()).toBe(0);
    expect((await db.centralAttempt.findMany())[0].status).toBe('RESULT'); expect(provider.revocations).toBe(0);
  });
  it('waits for COMMIT acknowledgement before returning JWT; lost receipt never remints or revokes', async () => {
    let mintCount = 0;
    const gate = barrier();
    const wrapped = new Proxy(db, { get(target, prop) {
      if (prop === '$transaction') return async (run: (tx: unknown) => Promise<unknown>) => {
        const value = await target.$transaction(run as never);
        if ((value as { token?: string })?.token) { gate.enter(); await gate.held; throw new Error('synthetic commit receipt lost'); }
        return value;
      };
      return Reflect.get(target, prop);
    } });
    const issuing: CentralSessionIssuer = async (...args) => { mintCount++; return sessionIssuer(...args); };
    const lost = new CentralAuthRepository(wrapped, cipher, issuing);
    const service = await createCentralAuthCoordinator(provider.config(), lost);
    let returned = false;
    const attempt = login(undefined, service).then(() => { returned = true; return false; }, () => true);
    await gate.reached; expect(returned).toBe(false); expect(await db.accessSession.count()).toBe(1);
    gate.release(); expect(await attempt).toBe(true);
    const applied = (await db.centralAttempt.findMany())[0]; expect(applied.status).toBe('APPLIED');
    expect(await lost.completeAuthorization({ accessExpiresAt: Date.now() + 300_000, attemptId: applied.id, subject: 'ignored-replay', expiresAt: Date.now()+10000 })).toMatchObject({ alreadyApplied: true });
    expect(mintCount).toBe(1); expect(provider.revocations).toBe(0); expect(await db.centralRevocation.count()).toBe(0);
  });
  it('refreshes expired AT once for concurrent callers, retaining the absolute grant/JWT limit', async () => {
    const { result, grant, binding } = await login();
    await expireAccess(grant.id); provider.nextRefreshMode = 'delay';
    const responses = await Promise.allSettled([coordinator.live(binding), coordinator.live(binding)]);
    expect(responses.some((r) => r.status === 'fulfilled')).toBe(true);
    for (const r of responses) if (r.status === 'rejected') expect(r.reason.code).toBe('central_unavailable');
    expect(provider.tokenPosts).toBe(2);
    const current = await db.centralGrant.findUniqueOrThrow({ where: { id: grant.id } });
    expect(current.version).toBe(2); expect(current.expiresAt).toEqual(grant.expiresAt);
    expect(await db.accessSession.count()).toBe(1); expect(result.token).toBeTruthy();
    expect(await coordinator.live(binding)).toEqual(binding);
  });
  it('cannot slide expiry via direct completion, and expired grant cannot dispatch refresh', async () => {
    const { grant } = await login();
    const attempt = await repo.beginRefresh(grant.id);
    await repo.recordResult(attempt.id, attempt.dispatchToken, { accessToken: 'synthetic-next' });
    await repo.completeRefresh(attempt.id, grant.expiresAt.getTime()+SESSION_MAX_AGE_MS, Date.now()+300_000);
    expect((await db.centralGrant.findUniqueOrThrow({ where: { id: grant.id } })).expiresAt).toEqual(grant.expiresAt);
    await db.centralGrant.update({ where: { id: grant.id }, data: { expiresAt: new Date(0) } });
    await expect(repo.beginRefresh(grant.id)).rejects.toMatchObject({ code: 'grant_unavailable' });
  });
  it('unknown refresh is never dispatched twice or converted to account closure', async () => {
    const { grant, binding } = await login(); await expireAccess(grant.id); provider.nextRefreshMode = 'drop-response';
    await expect(coordinator.live(binding)).rejects.toMatchObject({ code: 'central_unavailable' });
    await expect(coordinator.live(binding)).rejects.toMatchObject({ code: 'central_unavailable' });
    expect(provider.tokenPosts).toBe(2); expect(await db.user.count()).toBe(1); expect(await db.accountTombstone.count()).toBe(0);
    expect(await db.centralRevocation.count()).toBe(0);
    expect((await db.centralAttempt.findMany({ where: { kind: 'refresh' } }))[0].status).toBe('DISPATCHED');
  });
  it('network failure rejects access without deleting user/session/grant', async () => {
    const { binding, grant } = await login();
    intercept('/introspect', (_q, res) => { res.writeHead(503); res.end('{}'); });
    await expect(coordinator.live(binding)).rejects.toMatchObject({ code: 'central_unavailable' });
    expect(await db.accessSession.count()).toBe(1); expect(await db.user.count()).toBe(1);
    expect((await db.centralGrant.findUniqueOrThrow({ where: { id: grant.id } })).revokedAt).toBeNull();
    expect(await db.accountTombstone.count()).toBe(0); expect(await db.centralRevocation.count()).toBe(0);
  });
  it('confirmed central inactive revokes only its grant even with shared root sid', async () => {
    const a = await login(), b = await login(a.grant.subject);
    expect(a.grant.rootSid).toBe(b.grant.rootSid);
    provider.accesses.delete(provider.issued[0].accessToken);
    await expect(coordinator.live(a.binding)).rejects.toMatchObject({ code: 'session_inactive' });
    expect(await coordinator.live(b.binding)).toEqual(b.binding);
    expect(await db.centralRevocation.count()).toBe(1); expect(await db.accessSession.count()).toBe(1);
  });
  it('rejects missing/wrong tokenVersion/session and never trusts caller issuer/client', async () => {
    const { binding } = await login();
    for (const value of [{ ...binding, sessionHash: '' }, { ...binding, tokenVersion: binding.tokenVersion+1 }, { ...binding, userId: binding.userId+1 }])
      await expect(coordinator.live(value)).rejects.toMatchObject({ code: 'session_inactive' });
    expect(await coordinator.live({ ...binding, issuer: 'https://evil.test', clientId: 'evil' } as typeof binding)).toEqual(binding);
  });
  it('does not hold DB locks over HTTPS and rejects an in-flight active reply after logout', async () => {
    const a = await login(), gate = barrier();
    intercept('/introspect', (_q, _r, next) => { gate.enter(); void gate.held.then(next); });
    const pending = coordinator.live(a.binding).then(() => false, (e) => e.code);
    await gate.reached;
    await coordinator.logout(a.binding.userId, a.binding.sessionHash);
    gate.release(); expect(await pending).toBe('session_inactive');
    expect(await db.accessSession.count()).toBe(0);
  });
  it('late inactive reply cannot revoke a newer rotation', async () => {
    const a = await login(), snapshot = await repo.readLive({ ...a.binding, issuer: provider.issuer, clientId: provider.clientId });
    const attempt = await repo.beginRefresh(a.grant.id);
    await repo.recordResult(attempt.id, attempt.dispatchToken, { accessToken: provider.issued[0].accessToken });
    await repo.completeRefresh(attempt.id, a.grant.expiresAt.getTime(), Date.now()+300_000);
    expect(await repo.revokeSnapshot(snapshot)).toBe(false);
    expect(await coordinator.live(a.binding)).toEqual(a.binding);
  });
  it('single logout is user-bound; product logout revokes all sessions and increments tokenVersion', async () => {
    const a = await login(), b = await login(a.grant.subject);
    expect(await coordinator.logout(a.binding.userId+1,a.binding.sessionHash)).toBe(false);
    expect(await coordinator.live(a.binding)).toEqual(a.binding);
    await coordinator.logoutProduct(a.binding.userId);
    expect(await db.accessSession.count()).toBe(0); expect(await db.centralRevocation.count()).toBe(2);
    expect((await db.user.findUniqueOrThrow({ where: { id: a.binding.userId } })).tokenVersion).toBe(a.binding.tokenVersion+1);
    await expect(coordinator.live(b.binding)).rejects.toMatchObject({ code: 'session_inactive' });
  });
  it('closure commits tombstone plus outbox and captures a late refresh after user deletion', async () => {
    const a = await login(), attempt = await repo.beginRefresh(a.grant.id);
    await coordinator.closeProductAccount(a.binding.userId);
    expect(await db.user.count()).toBe(0); expect(await db.centralIdentity.count()).toBe(0); expect(await db.centralGrant.count()).toBe(0);
    expect(await db.accountTombstone.count()).toBe(1); expect(await db.centralRevocation.count()).toBe(1);
    await repo.recordResult(attempt.id, attempt.dispatchToken, { accessToken: 'synthetic-late', refreshToken: 'synthetic-late-refresh' });
    await expect(repo.completeRefresh(attempt.id, a.grant.expiresAt.getTime(), Date.now()+300_000)).rejects.toMatchObject({ code: 'grant_unavailable' });
    await repo.rejectResult(attempt.id); expect(await db.centralRevocation.count()).toBe(2);
  });
  it('worker retries partial RT/AT revocation, reports expired-unconfirmed, and keeps ticks single-flight', async () => {
    const a = await login(); await coordinator.logout(a.binding.userId,a.binding.sessionHash);
    let calls=0;
    intercept('/revoke', (_q,res,next) => { if (++calls===2) { res.writeHead(503); res.end('{}'); } else next(); });
    const reports: RevocationReport[]=[];
    const worker = await createCentralAuthWorker(provider.config(),repo,(r)=>reports.push(r),100);
    const first=worker.tick(), same=worker.tick(); expect(first).toBe(same);
    expect(await first).toMatchObject({ confirmed:0,retry:1,failed:false });
    expect(provider.refreshes.has(provider.issued[0].refreshToken)).toBe(false);
    expect(provider.accesses.has(provider.issued[0].accessToken)).toBe(true);
    await db.centralRevocation.updateMany({ data:{ nextAttemptAt:new Date(0) } });
    expect(await worker.tick()).toMatchObject({ confirmed:1,retry:0,failed:false });
    expect(provider.accesses.has(provider.issued[0].accessToken)).toBe(false);
    const b=await login(a.grant.subject); await coordinator.logout(b.binding.userId,b.binding.sessionHash);
    await db.centralRevocation.updateMany({ where:{status:'PENDING'},data:{expiresAt:new Date(0)} });
    expect(await worker.tick()).toMatchObject({ expiredUnconfirmed:1,confirmed:0 });
    expect(await db.centralRevocation.count({where:{status:'EXPIRED_UNCONFIRMED',tokensCipher:null}})).toBe(1);
    worker.start(); await worker.stop(); const size=reports.length;
    await new Promise((r)=>setTimeout(r,150)); expect(reports).toHaveLength(size);
  });
  it('late inactive HTTPS reply cannot revoke a newer committed rotation', async () => {
    const a = await login(), gate = barrier();
    intercept('/introspect', (_q,res) => { gate.enter(); void gate.held.then(() => { res.writeHead(200, {'content-type':'application/json'}); res.end('{"active":false}'); }); });
    const waiting = coordinator.live(a.binding).then(() => false, e => e.code);
    await gate.reached;
    const attempt = await repo.beginRefresh(a.grant.id);
    await repo.recordResult(attempt.id,attempt.dispatchToken,{accessToken:'synthetic-newer-rotation'});
    await repo.completeRefresh(attempt.id,a.grant.expiresAt.getTime(),Date.now()+300_000);
    gate.release(); expect(await waiting).toBe('session_inactive');
    const current=await db.centralGrant.findUniqueOrThrow({where:{id:a.grant.id}});
    expect(current.version).toBe(2); expect(current.revokedAt).toBeNull(); expect(await db.centralRevocation.count()).toBe(0);
  });
  it('closure failure rolls back the real tombstone, user deletion, sessions and outbox together', async () => {
    const a=await login();
    const rollback=new Proxy(db,{get(target,prop){
      if(prop==='$transaction') return async(run:(tx:unknown)=>Promise<unknown>)=>target.$transaction(async tx=>{
        const result=await run(tx);
        if(await tx.accountTombstone.count()) throw new Error('synthetic closure commit failure');
        return result;
      });
      return Reflect.get(target,prop);
    }});
    const service=await createCentralAuthCoordinator(provider.config(),new CentralAuthRepository(rollback,cipher,sessionIssuer));
    await expect(service.closeProductAccount(a.binding.userId)).rejects.toThrow('synthetic closure commit failure');
    expect(await db.user.count()).toBe(1);expect(await db.accessSession.count()).toBe(1);
    expect(await db.accountTombstone.count()).toBe(0);expect(await db.centralRevocation.count()).toBe(0);
    expect(await coordinator.live(a.binding)).toEqual(a.binding);
  });
  it('worker cannot acknowledge a lost lease even after upstream revocation succeeds',async()=>{
    const a=await login();await coordinator.logout(a.binding.userId,a.binding.sessionHash);
    const stale=new Proxy(repo,{get(target,prop){
      if(prop==='finishRevocation')return async(id:string,lease:string,confirmed:boolean)=>{
        await db.centralRevocation.update({where:{id},data:{leaseUntil:new Date(0)}});
        return target.finishRevocation(id,lease,confirmed);
      };
      return Reflect.get(target,prop);
    }});
    const worker=await createCentralAuthWorker(provider.config(),stale,()=>{});
    expect(await worker.tick()).toMatchObject({confirmed:0,failed:true});
    expect(await db.centralRevocation.count({where:{status:'PENDING'}})).toBe(1);
    expect(provider.accesses.has(provider.issued[0].accessToken)).toBe(false);
    await worker.stop();
  });
  it('worker refuses mismatched issuer/client outbox without making a provider call', async () => {
    const a=await login(); await coordinator.logout(a.binding.userId,a.binding.sessionHash);
    await db.centralRevocation.updateMany({ data:{issuer:'https://untrusted.example.test'} });
    const worker=await createCentralAuthWorker(provider.config(),repo,()=>{});
    expect(await worker.tick()).toMatchObject({confirmed:0,retry:1,failed:false});
    expect(provider.revocations).toBe(0); expect(await db.centralRevocation.count({where:{status:'PENDING'}})).toBe(1);
    await worker.stop();
  });
});
