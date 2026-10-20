import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as listener } from 'node:net';
const fake = vi.hoisted(() => { process.env.JWT_SECRET = 'r'.repeat(64); return { coordinator: vi.fn(), start: vi.fn(), stop: vi.fn() }; });
vi.mock('../src/db', async (original) => ({ ...await original<typeof import('../src/db')>(), disconnectDb: vi.fn() }));
vi.mock('../src/central-auth/coordinator', async (original) => ({ ...await original<typeof import('../src/central-auth/coordinator')>(), createCentralAuthCoordinator: fake.coordinator }));
vi.mock('../src/central-auth/worker', () => ({ createCentralAuthWorker: async () => ({ start: fake.start, stop: fake.stop }) }));
// Boot normally renders legal files in the package public directory. This test
// exercises actual listeners/lifecycle without mutating repository artifacts.
vi.mock('fs', async (original) => ({ ...await original<typeof import('fs')>(), writeFileSync: vi.fn(), rmSync: vi.fn(), copyFileSync: vi.fn() }));
import { acquireAuthenticationRuntime, centralRuntime } from '../src/central-auth/runtime';
import { createServer } from '../src/server';
import { authCache } from '../src/auth-cache';
let servers: ReturnType<typeof createServer>[] = [];
let dirs: string[] = [];
function env(mode: 'local' | 'oidc') {
  for (const key of Object.keys(process.env).filter((key) => key.startsWith('HEYTA_OIDC_') || key.startsWith('HEYTA_AUTH_'))) vi.stubEnv(key, undefined);
  vi.stubEnv('HEYTA_AUTH_MODE', mode); vi.stubEnv('HEYTA_AUTH_DEPLOYMENT', mode === 'oidc' ? 'official' : 'self-hosted');
  vi.stubEnv('PUBLIC_URL', 'https://heyta.example');
  if (mode === 'oidc') for (const [key, value] of Object.entries({ HEYTA_OIDC_ISSUER: 'https://identity.example', HEYTA_OIDC_CLIENT_ID: 'heyta', HEYTA_OIDC_CLIENT_SECRET: 'synthetic-secret',
    HEYTA_OIDC_REDIRECT_URI: 'https://heyta.example/api/auth/oidc/callback', HEYTA_OIDC_SESSION_ENCRYPTION_KEY: '77'.repeat(32) })) vi.stubEnv(key,value);
}
async function make(port?: number) {
  if (port === undefined) {
    const probe = listener(); await new Promise<void>((done) => probe.listen(0, '127.0.0.1', done));
    port = (probe.address() as { port: number }).port; await new Promise<void>((done) => probe.close(() => done()));
  }
  const dataDir = mkdtempSync(join(tmpdir(),'heyta-runtime-')); dirs.push(dataDir);
  const server = createServer({ port, host: '127.0.0.1', dataDir }); servers.push(server); return server;
}
beforeEach(() => { vi.clearAllMocks(); fake.coordinator.mockReset(); fake.stop.mockReset(); fake.coordinator.mockResolvedValue({}); fake.stop.mockResolvedValue(undefined); env('local'); });
afterEach(async () => {
  for (const server of servers) await server.stop(); servers = [];
  for (const dir of dirs) await rm(dir,{ recursive: true, force: true }); dirs=[]; vi.unstubAllEnvs();
});
describe('authentication process ownership and actual listener lifecycle', () => {
  it('local startup has no issuer factory, owns the singleton, and can restart after a complete stop', async () => {
    const first = await make(), second = await make();
    const address = await first.start(); expect((await fetch(address+'/api/auth/central/config')).status).toBe(200);
    expect(fake.coordinator).not.toHaveBeenCalled();
    await expect(make()).rejects.toThrow('already owned');
    await expect(second.start()).rejects.toThrow('already owned'); await second.stop();
    expect((await fetch(address+'/api/auth/central/config')).status).toBe(200);
    await expect(first.start()).rejects.toThrow('already started'); await first.stop(); await first.stop();
    await second.start(); expect(second.fastifyServer?.server.listening).toBe(true); await second.stop();
  });
  it('official startup failure never listens or falls back and releases ownership for retry', async () => {
    env('oidc'); fake.coordinator.mockRejectedValueOnce(new Error('synthetic unavailable'));
    const server = await make(); await expect(server.start()).rejects.toThrow('synthetic unavailable');
    expect(server.fastifyServer).toBeUndefined(); expect(fake.start).not.toHaveBeenCalled(); expect(() => centralRuntime()).toThrow('central_unavailable');
    await server.start(); expect(fake.start).toHaveBeenCalledTimes(1); await server.stop(); expect(fake.stop).toHaveBeenCalledTimes(1);
  });
  it('failed listen stops its worker and releases the singleton without clearing another owner', async () => {
    env('oidc'); const occupied = listener(); await new Promise<void>((done)=>occupied.listen(0,'127.0.0.1',done));
    const port = (occupied.address() as {port:number}).port;
    try { const server = await make(port); await expect(server.start()).rejects.toMatchObject({ code: 'EADDRINUSE' });
      expect(fake.start).not.toHaveBeenCalled(); expect(fake.stop).toHaveBeenCalledTimes(1); expect(server.fastifyServer).toBeUndefined();
    } finally { await new Promise<void>((done)=>occupied.close(()=>done())); }
    const server = await make(); await server.start(); await server.stop();
  });
  it('awaits worker shutdown, coalesces duplicate stop and clears warm auth metadata', async () => {
    env('oidc'); const config = { mode:'oidc' as const, deployment:'official' as const, issuer:'https://identity.example', clientId:'heyta', clientSecret:'synthetic', redirectUri:'https://heyta.example/api/auth/oidc/callback', sessionEncryptionKey:'77'.repeat(32) };
    let release!: () => void; fake.stop.mockImplementationOnce(()=>new Promise<void>((done)=>{release=done;}));
    const owner = await acquireAuthenticationRuntime(config); authCache.setIfCurrent(1,null,0,true,authCache.getInvalidationVersion(1));
    const stopped = owner.stop(); const again=owner.stop(); expect(again).toBe(stopped); expect(fake.stop).toHaveBeenCalledTimes(1);
    await expect(acquireAuthenticationRuntime(config)).rejects.toThrow('already owned'); release(); await stopped;
    expect(authCache.get(1,null)).toBeNull(); expect(() => centralRuntime()).toThrow('central_unavailable');
  });
  it('retains ownership through asynchronous shared-resource cleanup after the worker has stopped', async () => {
    const config = { mode: 'local' as const, deployment: 'self-hosted' as const };
    const owner = await acquireAuthenticationRuntime(config);
    let release!: () => void, entered!: () => void;
    const ready = new Promise<void>((done)=>{entered=done;});
    const stopped = owner.stop(async () => { entered(); await new Promise<void>((done)=>{release=done;}); });
    await ready; await expect(acquireAuthenticationRuntime(config)).rejects.toThrow('already owned');
    release(); await stopped;
    const next = await acquireAuthenticationRuntime(config); await next.stop();
  });

});
