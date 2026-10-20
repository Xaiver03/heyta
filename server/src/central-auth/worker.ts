/** Durable revocation runner. Network work never runs under a PostgreSQL lock. */
import type { AuthenticationConfig } from './config';
import { createCentralOidcClient } from './oidc-client';
import type { CentralAuthRepository } from './repository';
type Config = Extract<AuthenticationConfig, { mode: 'oidc' }>;
export type RevocationReport = { confirmed: number; retry: number; expiredUnconfirmed: number; failed: boolean };
export async function createCentralAuthWorker(config: Config, repo: CentralAuthRepository,
  report: (result: RevocationReport) => void, intervalMs = 30_000) {
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 100 || intervalMs > 60_000) throw new Error('Invalid worker interval');
  const fixed = Object.freeze({ ...config });
  const oidc = await createCentralOidcClient(fixed, repo);
  let running: Promise<RevocationReport> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = true;
  let generation = 0;
  function tick(): Promise<RevocationReport> {
    if (running) return running;
    running = (async () => {
      const result: RevocationReport = { confirmed: 0, retry: 0, expiredUnconfirmed: 0, failed: false };
      try {
        const clean = await repo.cleanup();
        result.expiredUnconfirmed = clean.expiredUnconfirmed;
        // One item bounds tick time to two protocol deadlines; the next tick resumes.
        const job = await repo.claimRevocation();
        if (job) {
          let confirmed = false;
          try {
            if (job.issuer !== fixed.issuer || job.clientId !== fixed.clientId) throw new Error('Unconfigured issuer');
            if (job.tokens.refreshToken) await oidc.revoke(job.tokens.refreshToken, 'refresh_token');
            if (job.tokens.accessToken) await oidc.revoke(job.tokens.accessToken, 'access_token');
            confirmed = true;
          } catch { result.retry++; }
          await repo.finishRevocation(job.id, job.lease, confirmed);
          if (confirmed) result.confirmed++;
        }
      } catch { result.failed = true; }
      // Never expose credential-bearing SDK errors or outbox payloads to observers.
      try { report(Object.freeze({ ...result })); } catch { /* Observer failure must not stop durable cleanup. */ }
      return result;
    })();
    void running.finally(() => { running = undefined; }).catch(() => {});
    return running;
  }
  function schedule(epoch: number) {
    if (stopped || epoch !== generation) return;
    timer = setTimeout(async () => { await tick(); schedule(epoch); }, intervalMs);
    timer.unref();
  }
  return Object.freeze({ tick,
    start() { if (!stopped) return; stopped = false; schedule(++generation); },
    async stop() { stopped = true; generation++; if (timer) clearTimeout(timer); await running; },
  });
}
