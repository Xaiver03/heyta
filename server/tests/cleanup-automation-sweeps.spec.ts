/**
 * 每日清扫**那一次调用**在册（A5 / BLOCKED.md B175 的收口）。
 *
 * `purgeRetiredAutomationEntitlementClocks` 的函数体与真库判据早就在
 * （`server/tests/automation-clock-retirement.pglite.spec.ts` 五条），
 * 但那条套件测的是"给它一张表它会删什么"，**测不到它会不会自己发生**。
 * 一个写了却没人调的清扫，在数据库层的判据上永远是绿的 —— 那正是
 * 「不能失败的检查没有价值」（AGENTS §8.3）点名的形状。
 *
 * 本文件因此**不**再测 SQL，只测接线：
 *
 * | 判据 | 摘掉它会发生什么 |
 * |---|---|
 * | 每日任务真的各调一次三枚 automation 清扫 | 删掉任何一处调用 ⇒ 对应计数 0 ⇒ 红 |
 * | 时钟清扫排在 nonce 清扫**之后** | 调换两处顺序 ⇒ 顺序断言红 |
 * | 某一步抛错不带走后面的步 | 让 nonce 清扫抛 ⇒ 时钟清扫照样被调 |
 *
 * 顺序那条不是洁癖：一台 installation 只要还有票据消费行就还没退役，
 * 而上一趟刚把过期的 nonce 摘掉 —— 反过来写会让"最后一引用已消失"的那些
 * 时钟行**多留一天**，于是这个清扫永远追不上最后一条 nonce。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
const sweep = (name: string, value: () => number = () => 0) => vi.fn(async (..._args: unknown[]) => {
  calls.push(name);
  return value();
});

const eventsPurge = sweep('automation-events');
const noncePurge = sweep('automation-entitlement-tickets');
const clockPurge = sweep('automation-entitlement-clocks');

vi.mock('../src/sync/sync.service', () => ({
  getSyncService: () => new Proxy({}, {
    // 每一步外面都裹着 try/catch，所以"其它步全炸"不影响本文件要证的这三处调用；
    // 反过来这也钉住一件事：**任何一步的失败都不许带走后面的清扫**。
    get: () => {
      throw new Error('本文件不需要真同步服务');
    },
  }),
}));
vi.mock('../src/sync/services/vault-key-migration.service', () => ({
  vaultKeyMigrationService: { cleanupExpired: vi.fn(async () => { throw new Error('不需要'); }) },
}));
vi.mock('../src/ai/metering', () => ({ purgeExpiredAiUsageCounters: vi.fn(async () => { throw new Error('不需要'); }) }));
vi.mock('../src/billing/reconcile-job', () => ({ runBillingReconciliation: vi.fn(async () => { throw new Error('不需要'); }) }));
vi.mock('../src/account/credential-sweep', () => ({ sweepExpiredAccountCredentials: vi.fn(async () => { throw new Error('不需要'); }) }));
vi.mock('../src/automation/rules', () => ({ purgeExpiredAutomationEvents: eventsPurge }));
vi.mock('../src/automation/entitlement-ticket', () => ({
  purgeExpiredAutomationEntitlementTicketUses: noncePurge,
  purgeRetiredAutomationEntitlementClocks: clockPurge,
}));
vi.mock('../src/logger', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { startCleanupJobs, stopCleanupJobs } = await import('../src/sync/cleanup');

const FIRST_PASS_MS = 10_000;

beforeEach(() => {
  calls.length = 0;
  eventsPurge.mockClear();
  noncePurge.mockClear();
  clockPurge.mockClear();
});

describe('每日清扫里那三枚 automation 清扫的接线', () => {
  it('起任务后首趟运行：事件密文、nonce、退役时钟**各被调一次**', async () => {
    vi.useFakeTimers();
    try {
      startCleanupJobs();
      await vi.advanceTimersByTimeAsync(FIRST_PASS_MS);
    } finally {
      stopCleanupJobs();
      vi.useRealTimers();
    }
    expect(eventsPurge).toHaveBeenCalledTimes(1);
    expect(noncePurge).toHaveBeenCalledTimes(1);
    expect(clockPurge).toHaveBeenCalledTimes(1);
  });

  it('🔴 退役时钟排在 nonce 之后（否则最后一条 nonce 消失后时钟还要多留一天）', async () => {
    vi.useFakeTimers();
    try {
      startCleanupJobs();
      await vi.advanceTimersByTimeAsync(FIRST_PASS_MS);
    } finally {
      stopCleanupJobs();
      vi.useRealTimers();
    }
    expect(calls.indexOf('automation-entitlement-tickets')).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf('automation-entitlement-clocks')).toBeGreaterThan(calls.indexOf('automation-entitlement-tickets'));
  });

  it('前面那步抛错**不带走**退役时钟（三处各自独立 try/catch）', async () => {
    noncePurge.mockRejectedValueOnce(new Error('nonce 清扫这一趟炸了'));
    vi.useFakeTimers();
    try {
      startCleanupJobs();
      await vi.advanceTimersByTimeAsync(FIRST_PASS_MS);
    } finally {
      stopCleanupJobs();
      vi.useRealTimers();
    }
    expect(noncePurge).toHaveBeenCalledTimes(1);
    expect(clockPurge).toHaveBeenCalledTimes(1);
  });
});
