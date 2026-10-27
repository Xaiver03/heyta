/**
 * 自动收集的**租约判活**必须与会话时区无关。
 *
 * 症状（2026-10-27 在本机现量到）：同一份代码，连 UTC 的 Postgres 跑绿、连
 * `Asia/Shanghai` 的 Postgres 跑红 —— 红在租约那一步，报的是"租约已失效"。
 * 归因链三段，每段都单独量过：
 *  · `automation_*` 的时间列是 `timestamp without time zone`（现量：
 *    `information_schema.columns.data_type = 'timestamp without time zone'`）；
 *  · Prisma 客户端把一个 JS `Date` 按 **UTC 挂钟**写进这种列（现量：写入 `07:12:43Z`
 *    ⇒ 列里是 `2026-10-27 07:12:43`），读回来也按 UTC 解释；
 *  · 而这种裸值与任何 `timestamptz`（`clock_timestamp()`，或直接绑进来的 JS Date）比较时，
 *    Postgres **按会话 TimeZone** 解释裸值 —— `Asia/Shanghai` 下 `07:12:43` 被当成
 *    `07:12:43+08`，绝对时刻比真实值早 8 小时 ⇒ 一把还有 60 秒寿命的租约读成"八小时前就过期了"。
 *
 * 🔴 为什么这一档必须存在，而不是"要求运维把库设成 UTC"：`test:integration:postgres`
 * 那套门禁此前只在一台 UTC 的 Postgres 上跑过，所以这个错**从来没被任何一只眼看到过**；
 * 而自托管装完 Postgres 的默认 `TimeZone` 跟着 OS —— 这片最常见的是 +08。
 * 换句话说：**在开发机上不是 bug，在用户机上就是 bug**，而且症状是自动收集永远领不到许可。
 *
 * 本档不复制产品里那句 SQL：它把一枚**会话时区钉死成 +08** 的连接交给产品自己的
 * `reserveAutomationAiAttempt`，产品代码写错一个字符这里就红。对照臂（已过期的租约仍须被拒）
 * 挡的是"把判活改成恒真"那种为了让本档变绿的改法。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { reserveAutomationAiAttempt } from '../../src/automation/ai-metering';
import { generateWorkerCredential } from '../../src/automation/worker-identity';
import { createPrismaSqlExecutor } from '../../src/billing/pricing-store';

const DATABASE_URL = process.env.DATABASE_URL;

/** 一个 UTC 以东、且**这片自托管者最可能撞上**的会话时区。 */
const EAST_OF_UTC = 'Asia/Shanghai';

describe.skipIf(!DATABASE_URL)('automation lease validity does not depend on the DB session timezone', () => {
  const ambient = new PrismaClient();
  // 🔴 `connection_limit=1` 是让 `SET TIME ZONE` 真正生效的那一步：会话级 GUC 只属于它被设进
  // 的那一枚物理连接，而池里其它连接仍是 UTC —— 不限成 1，本档就会一半查询走 +08、一半走 UTC，
  // 读数与产品行为对不上，红也红得没有意义。
  const pinned = new PrismaClient({
    datasources: { db: { url: `${DATABASE_URL}${DATABASE_URL.includes('?') ? '&' : '?'}connection_limit=1` } },
  });
  let userId = 0;

  beforeAll(async () => {
    // `SET TIME ZONE` 不吃绑定参数（utility 语句），所以走 `set_config`：第三枚 `false` = 会话级而非事务级。
    await pinned.$executeRaw`SELECT set_config('TimeZone', ${EAST_OF_UTC}, false)`;
    const rows = await pinned.$queryRaw<{ tz: string }[]>`SELECT current_setting('TimeZone') AS tz`;
    // 探针自证：钉不住就当场红，别留一条"永远在 UTC 上量不到东西"的静绿臂。
    expect(rows[0]?.tz, `会话时区没钉成 ${EAST_OF_UTC}，实得 ${String(rows[0]?.tz)}`).toBe(EAST_OF_UTC);
  }, 60_000);

  afterEach(async () => {
    if (userId) await ambient.user.delete({ where: { id: userId } }).catch(() => undefined);
    userId = 0;
  });

  afterAll(async () => {
    await ambient.$disconnect();
    await pinned.$disconnect();
  });

  interface Fixture { ruleId: string; eventId: string; workerId: string; clientId: string; epoch: string; credentialHash: string }

  /** 造一台"刚刚真领到一条事件、租约还有 60 秒"的宿主：行的时间字段一律由 **Prisma 客户端**写入，
   *  因为那才是产品的写入口径（客户端按 UTC 挂钟写裸列）。用裸 SQL 写会把口径换成会话本地时间，
   *  于是这一档量的就不是被测物了。 */
  const leasedEvent = async (): Promise<Fixture> => {
    const user = await ambient.user.create({ data: { email: `lease-tz-${randomUUID()}@test.local`, isVerified: 1 } });
    userId = user.id;
    const worker = generateWorkerCredential();
    const ruleId = randomUUID();
    const eventId = randomUUID();
    const clientId = `lease-tz-${randomUUID()}`;
    const epoch = randomUUID();
    await ambient.automationRule.create({ data: { id: ruleId, userId, enabled: true, keyId: 'inbound-v1', parseVersion: 1 } });
    await ambient.automationWorker.create({ data: { id: worker.workerId, userId,
      credentialHash: worker.credentialHash, syncClientId: clientId, databaseEpoch: epoch } });
    await ambient.automationEvent.create({ data: { userId, ruleId, eventId, ruleVersion: 1,
      dedupeDigest: 'a'.repeat(64), contentType: 'application/json', payloadCiphertext: 'sealed-input',
      status: 'leased', leaseWorkerId: worker.workerId, leaseGeneration: 1,
      leaseExpiresAt: new Date(Date.now() + 60_000), attempt: 1, parseVersion: 1,
      expiresAt: new Date(Date.now() + 86_400_000) } });
    // 同一把尺量一次"列里存的到底是哪挂钟"：客户端读回来必须仍是 +60s 那把租约。
    const row = await ambient.automationEvent.findFirst({ where: { userId, eventId } });
    expect(row?.leaseExpiresAt, '夹具的租约在客户端读回时就已经不对，后面的读数不能算').not.toBeNull();
    expect((row!.leaseExpiresAt!.getTime() - Date.now()) / 1000, '租约该还有约 60 秒').toBeGreaterThan(30);
    return { ruleId, eventId, workerId: worker.workerId, clientId, epoch, credentialHash: worker.credentialHash };
  };

  const reserve = async (f: Fixture) => reserveAutomationAiAttempt(
    { userId, ruleId: f.ruleId, eventId: f.eventId, parseVersion: 1, attempt: 1 },
    Date.now(), undefined, createPrismaSqlExecutor(pinned),
    { clientId: f.clientId, credentialHash: f.credentialHash, databaseEpoch: f.epoch, tokenVersion: 0, leaseGeneration: 1 },
    'direct',
  );

  it('+08 会话下，还剩 60 秒的租约仍算活着 ⇒ 预留成功并落一行 reserved', async () => {
    const f = await leasedEvent();
    const reserved = await reserve(f);
    expect(reserved.state).toBe('reserved');
    expect(reserved.billingSource).toBe('direct');
    const rows = await ambient.automationAiAttempt.findMany({ where: { userId, eventId: f.eventId } });
    expect(rows.map((r) => r.state), '预留必须真的落库').toEqual(['reserved']);
  }, 60_000);

  it('对照臂：同一枚 +08 会话下，租约已过期仍须被拒（挡住"判活改成恒真"）', async () => {
    const f = await leasedEvent();
    await ambient.automationEvent.update({ where: { userId_ruleId_eventId: { userId, ruleId: f.ruleId, eventId: f.eventId } },
      data: { leaseExpiresAt: new Date(Date.now() - 60_000) } });
    await expect(reserve(f)).rejects.toThrow(/lease is no longer valid/i);
    expect(await ambient.automationAiAttempt.count({ where: { userId, eventId: f.eventId } }),
      '被拒的预留不许留下一行').toBe(0);
  }, 60_000);

  it('对照臂：正文保留期(expires_at)已过的租约同样被拒，且它不是被会话时区提前判死的', async () => {
    const f = await leasedEvent();
    await ambient.automationEvent.update({ where: { userId_ruleId_eventId: { userId, ruleId: f.ruleId, eventId: f.eventId } },
      data: { expiresAt: new Date(Date.now() - 60_000) } });
    await expect(reserve(f)).rejects.toThrow(/lease is no longer valid/i);
  }, 60_000);
});
