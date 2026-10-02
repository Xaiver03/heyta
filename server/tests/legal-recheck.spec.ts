import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * G-27 重新确认的**逻辑层**判据（`src/legal-recheck.ts`）。
 * =====================================================
 *
 * 分两层测，是因为这两件事会各自单独坏：
 *
 * | 层 | 坏法 | 谁抓 |
 * |---|---|---|
 * | 判定（纯函数） | 把 `null` 读成"等于当前版本"⇒ 那批证明不了同意过哪一版的人**永远不拦**，补签形同没做 | 本文件第 1 组 |
 * | 实例适用性 | 漏掉"这台实例无法命名版本"那一层 ⇒ 自建部署上所有人的指针都是 `null`，于是**每个人都被永久锁在门外** | 本文件第 3 组 |
 * | 写入（事务形状） | 把两次写拆成两次顶层调用 ⇒ "表里有 1.1、指针还写着 1.0"，同一个人被拦两次而第二次点击修不好它 | 本文件第 4 组 |
 *
 * ## 🔴 这份假库证明什么、不证明什么（写完就先说清）
 *
 * `state.consents` 是一个 JS 数组，`$transaction` 是"把回调里的写操作跑完再落地"。
 * 于是这里能证明的是：**我们的代码在那一次事务调用里做了哪几件事、顺序与条件对不对**；
 * 不能证明的是 PostgreSQL 的原子性 —— 那是 `user-consent-history-migration.pglite.spec.ts`
 * 用真库真 WAL 证的（同一份 SQL 在这里跑不出结论，在那边跑得出来）。两份互补，缺一会漏：
 * 唯一索引在真库里拦不拦得住，只有 pglite 那份知道；搬账的条件写得对不对，只有这份知道。
 *
 * 假库的写入语义**刻意照抄真库的两条约束**（`(user_id, kind, document_version)` 唯一、
 * `create` 撞唯一就抛），否则"重复确认不长第二行"这类断言会变成一个永远为真的道具。
 */

/** 被测模块 `import { prisma } from './db'` 拿到的就是这一个对象（身份稳定，方法在 beforeEach 装）。 */
const mocks = vi.hoisted(() => ({ prisma: {} as Record<string, any> }));

vi.mock('../src/db', () => ({ prisma: mocks.prisma }));

import {
  LEGAL_CONSENT_KINDS,
  decideLegalRecheck,
  evaluateLegalRecheck,
  legalRecheckApplicable,
  recordLegalReconfirm,
} from '../src/legal-recheck';
import { LEGAL_SET_VERSION } from '../src/legal.generated';

const OLD = 'terms@1.0;privacy@1.0;minors@1.0';
const OFFICIAL_URL = 'https://heyta.waytofuture.cn';
const SELF_HOSTED_URL = 'https://heyta.example-corp.com';

type ConsentRow = {
  id: number;
  userId: number;
  kind: string;
  documentVersion: string;
  acceptedAt: bigint;
  serverReceivedAt: bigint;
};

const state = {
  users: new Map<number, { id: number; termsAcceptedAt: bigint | null; termsDocumentVersion: string | null }>(),
  consents: [] as ConsentRow[],
  nextId: 1,
  /** 被调用过的 `$transaction(fn)` 次数。 */
  txCalls: 0,
  /** 任何**绕过事务**的顶层写都记在这里 —— 第 4 组判据就靠它。 */
  writesOutsideTx: [] as string[],
};

const consentData = (d: Record<string, unknown>): ConsentRow => ({
  id: state.nextId++,
  userId: Number(d.userId ?? (d.user as { connect?: { id?: number } })?.connect?.id),
  kind: String(d.kind),
  documentVersion: String(d.documentVersion),
  acceptedAt: BigInt(String(d.acceptedAt ?? 0)),
  serverReceivedAt: BigInt(String(d.serverReceivedAt ?? 0)),
});

/** 取最新一行：只认 `orderBy: { id: 'desc' }`，别的排序一律不接受（见下面那条测试）。 */
const latestConsent = (where: { userId: number; kind: string }): ConsentRow | undefined =>
  state.consents
    .filter((r) => r.userId === where.userId && r.kind === where.kind)
    .sort((a, b) => b.id - a.id)[0];

/** 真插一行：撞 `(user_id, kind, document_version)` 就抛，照抄真库那条 UNIQUE。 */
const insertConsent = (data: Record<string, unknown>, insideTx: boolean): ConsentRow => {
  if (!insideTx) state.writesOutsideTx.push('userConsent.create');
  const row = consentData(data);
  const clash = state.consents.find(
    (r) => r.userId === row.userId && r.kind === row.kind && r.documentVersion === row.documentVersion,
  );
  if (clash) throw new Error('duplicate key value violates unique constraint');
  state.consents.push(row);
  return row;
};

const makeDelegates = (insideTx: boolean) => ({
  user: {
    findUnique: async ({ where, select }: any) => {
      const u = state.users.get(where.id);
      if (!u) return null;
      if (select) {
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(select)) out[k] = (u as any)[k];
        return out;
      }
      return u;
    },
    update: async ({ where, data }: any) => {
      if (!insideTx) state.writesOutsideTx.push('user.update');
      const u = state.users.get(where.id);
      if (!u) throw new Error('no such user');
      Object.assign(u, data);
      return u;
    },
  },
  userConsent: {
    findFirst: async ({ where, orderBy }: any) => {
      if (orderBy && !(Object.keys(orderBy).length === 1 && Object.keys(orderBy)[0] === 'id')) {
        throw new Error(
          `假库只实现了 orderBy: { id: 'desc' } —— 生产代码换了排序键说明它在按客户端时钟取最新，` +
            '那是 §7 第 19 条（墙上时钟不能裁决因果）在这个位置上的具体形态，必须显式改这里而不是让它静默通过。',
        );
      }
      return latestConsent(where) ?? null;
    },
    create: async ({ data }: any) => insertConsent(data, insideTx),
    upsert: async ({ where, create, update }: any) => {
      if (!insideTx) state.writesOutsideTx.push('userConsent.upsert');
      const key = where.userId_kind_documentVersion;
      const hit = state.consents.find(
        (r) => r.userId === key.userId && r.kind === key.kind && r.documentVersion === key.documentVersion,
      );
      if (hit) {
        Object.assign(hit, { serverReceivedAt: BigInt(String(update.serverReceivedAt ?? hit.serverReceivedAt)) });
        return hit;
      }
      return insertConsent(create, insideTx);
    },
  },
});

/** 把假库装进那个稳定身份的对象上。 */
const installFakePrisma = () => {
  const outside = makeDelegates(false);
  Object.assign(mocks.prisma, outside, {
    $transaction: async (fn: any) => {
      if (typeof fn !== 'function') {
        // 数组形式的 $transaction 也算一次事务，但本模块刻意用回调形式（搬账要先读后写）。
        state.txCalls += 1;
        return Promise.all((fn as unknown[]).map((p) => p));
      }
      state.txCalls += 1;
      return fn(makeDelegates(true));
    },
  });
};

const setPublicUrl = (url: string) => {
  process.env.PUBLIC_URL = url;
};

const seedUser = (id: number, pointer: string | null, acceptedAt: bigint | null = BigInt(0)) => {
  state.users.set(id, { id, termsAcceptedAt: acceptedAt, termsDocumentVersion: pointer });
};

beforeEach(() => {
  installFakePrisma();
  state.users.clear();
  state.consents.length = 0;
  state.nextId = 1;
  state.txCalls = 0;
  state.writesOutsideTx.length = 0;
  setPublicUrl(OFFICIAL_URL);
});

afterEach(() => {
  delete process.env.PUBLIC_URL;
});

describe('第 1 组 · 判定表：只比版本，其余一概不看', () => {
  const base = { applicable: true, currentVersion: LEGAL_SET_VERSION };

  it('这台实例不能命名版本 ⇒ 整体不适用，且**不许**报出当前版本号', () => {
    const d = decideLegalRecheck({
      ...base,
      applicable: false,
      latestConsentVersion: null,
      pointerVersion: null,
    });
    expect(d).toEqual({
      needsReconfirm: false,
      reason: 'not-applicable',
      currentVersion: null,
      recordedVersion: null,
    });
  });

  it('🔴 没有任何版本记录 ⇒ 拦（那批人证明不了自己同意过哪一版）', () => {
    const d = decideLegalRecheck({ ...base, latestConsentVersion: null, pointerVersion: null });
    expect(d.needsReconfirm).toBe(true);
    expect(d.reason).toBe('unprovable');
    // 这条是补签存在的理由。把它写成 `recorded === current` 之外的兜底（比如放行）
    // 会让那批账号永远不再被要求确认 —— 而整个套件其他地方都不会红。
  });

  it('指针等于当前版本 ⇒ 一个弹窗都不许看到（防"每次都拦"的误伤判据）', () => {
    const d = decideLegalRecheck({
      ...base,
      latestConsentVersion: null,
      pointerVersion: LEGAL_SET_VERSION,
    });
    expect(d.needsReconfirm).toBe(false);
    expect(d.reason).toBe('current');
  });

  it('指针是别的一版 ⇒ 拦，并说清"你同意过的是哪一版"', () => {
    const d = decideLegalRecheck({ ...base, latestConsentVersion: null, pointerVersion: OLD });
    expect(d.needsReconfirm).toBe(true);
    expect(d.reason).toBe('version-changed');
    expect(d.recordedVersion).toBe(OLD);
  });

  it('🔴 表里最新一行优先于指针：表 1.1 / 指针没跟上 ⇒ 按**表**判，不拦', () => {
    const d = decideLegalRecheck({
      ...base,
      latestConsentVersion: LEGAL_SET_VERSION,
      pointerVersion: OLD,
    });
    expect(d.needsReconfirm).toBe(false);
    expect(d.recordedVersion).toBe(LEGAL_SET_VERSION);
  });

  it('反方向也要对：表里最新一行是旧版 ⇒ 拦（指针被别的东西改脏不算证据）', () => {
    const d = decideLegalRecheck({
      ...base,
      latestConsentVersion: OLD,
      pointerVersion: LEGAL_SET_VERSION,
    });
    expect(d.needsReconfirm).toBe(true);
    expect(d.recordedVersion).toBe(OLD);
  });

  it('判定输入里**没有**时间：签名只认这四个键', () => {
    // 不是形式主义：只要给 decide 传过 acceptedAt，改版当天就会有一批人因为
    // 时钟慢了半秒而被当成"同意过旧版的人"。§7 第 19 条在这里的形态。
    const seen: string[] = [];
    const spy = (input: Record<string, unknown>) => {
      seen.push(...Object.keys(input));
      return decideLegalRecheck(input as any);
    };
    spy({
      applicable: true,
      currentVersion: LEGAL_SET_VERSION,
      latestConsentVersion: null,
      pointerVersion: OLD,
    });
    expect([...new Set(seen)].sort()).toEqual([
      'applicable',
      'currentVersion',
      'latestConsentVersion',
      'pointerVersion',
    ]);
  });

  it('同意事项词表恰好一个成员，加成员要连着改这条', () => {
    expect(LEGAL_CONSENT_KINDS).toEqual(['legal_set']);
  });
});

describe('第 3 组 · 实例适用性（读的是真 env，不是猜的）', () => {
  it('官方域名 ⇒ 适用；自建域名 ⇒ 不适用', () => {
    setPublicUrl(OFFICIAL_URL);
    expect(legalRecheckApplicable()).toBe(true);
    setPublicUrl(SELF_HOSTED_URL);
    expect(legalRecheckApplicable()).toBe(false);
  });

  it('🔴 自建实例上，指针为 null 的账号**不拦**（否则那台机器上所有人都出不了门）', async () => {
    seedUser(1, null);
    setPublicUrl(SELF_HOSTED_URL);
    const d = await evaluateLegalRecheck(1);
    expect(d.needsReconfirm).toBe(false);
    expect(d.reason).toBe('not-applicable');

    // 阳性对照：同一个人、同一个 null，换成官方域名就必须拦。
    // 没有这一句，"官方 / 自建都返回 false"也是一个看起来对的实现。
    setPublicUrl(OFFICIAL_URL);
    const off = await evaluateLegalRecheck(1);
    expect(off.needsReconfirm).toBe(true);
    expect(off.reason).toBe('unprovable');
  });

  it('表里有最新一行时，读的就是那一行（且按 id 倒序取，不按客户端时刻）', async () => {
    seedUser(2, OLD);
    // 手写两行：id 大的那行是"服务端最后收到的"，它的 acceptedAt 反而更小 ——
    // 模拟一个时钟慢了的客户端。按 id 取才不会被它骗。
    state.consents.push({
      id: 1,
      userId: 2,
      kind: 'legal_set',
      documentVersion: 'something@9.9',
      acceptedAt: BigInt(2_000_000_000_000),
      serverReceivedAt: BigInt(0),
    });
    state.consents.push({
      id: 2,
      userId: 2,
      kind: 'legal_set',
      documentVersion: LEGAL_SET_VERSION,
      acceptedAt: BigInt(1_000_000_000_000),
      serverReceivedAt: BigInt(1),
    });
    const d = await evaluateLegalRecheck(2);
    expect(d.recordedVersion).toBe(LEGAL_SET_VERSION);
    expect(d.needsReconfirm).toBe(false);
  });
});

describe('第 4 组 · 写入：搬账、幂等、拒绝，以及两次写都在这次事务里', () => {
  it('指针写着旧版 ⇒ 先把那一版**搬进账**，再写新一版，再更新指针，全在同一次事务里', async () => {
    seedUser(3, OLD, BigInt(1_700_000_000_000));
    const before = state.txCalls;

    const r = await recordLegalReconfirm({
      userId: 3,
      clientVersion: LEGAL_SET_VERSION,
      acceptedAt: 1_800_000_000_000,
    });

    expect(r).toEqual({ ok: true, recordedVersion: LEGAL_SET_VERSION });
    expect(state.consents.map((c) => c.documentVersion).sort()).toEqual([OLD, LEGAL_SET_VERSION].sort());
    expect(state.users.get(3)!.termsDocumentVersion).toBe(LEGAL_SET_VERSION);
    // 搬过来的那行带的是注册时刻，且 serverReceivedAt = 0（"这条不是当场收到的"）。
    const moved = state.consents.find((c) => c.documentVersion === OLD)!;
    expect(moved.acceptedAt).toBe(BigInt(1_700_000_000_000));
    expect(moved.serverReceivedAt).toBe(BigInt(0));
    // 🔴 事务形状：整件事只开了一次事务，而且没有任何一次顶层写。
    expect(state.txCalls).toBe(before + 1);
    expect(state.writesOutsideTx).toEqual([]);
  });

  it('🔴 指针是 null ⇒ 只写新一版，**不**给旧版造行（那是发明同意）', async () => {
    seedUser(4, null);
    await recordLegalReconfirm({
      userId: 4,
      clientVersion: LEGAL_SET_VERSION,
      acceptedAt: 1_800_000_000_000,
    });
    expect(state.consents.map((c) => c.documentVersion)).toEqual([LEGAL_SET_VERSION]);
  });

  it('同一版重复确认 ⇒ 还是一行，指针也不动第二回（幂等，不会把人反复拦）', async () => {
    seedUser(5, OLD);
    await recordLegalReconfirm({ userId: 5, clientVersion: LEGAL_SET_VERSION, acceptedAt: 1 });
    const rowsAfterFirst = state.consents.length;
    const idAfterFirst = state.consents.map((c) => c.id).join(',');

    await recordLegalReconfirm({ userId: 5, clientVersion: LEGAL_SET_VERSION, acceptedAt: 2 });
    expect(state.consents).toHaveLength(rowsAfterFirst);
    expect(state.consents.map((c) => c.id).join(',')).toBe(idAfterFirst);
    expect(state.users.get(5)!.termsDocumentVersion).toBe(LEGAL_SET_VERSION);
  });

  it('客户端拿**旧版**来确认 ⇒ 拒，且一行都不写（"读的是 A、记的是 B"就是这件事）', async () => {
    seedUser(6, OLD);
    const r = await recordLegalReconfirm({ userId: 6, clientVersion: OLD, acceptedAt: 1 });
    expect(r).toEqual({ ok: false, error: 'version-mismatch' });
    expect(state.consents).toHaveLength(0);
    expect(state.users.get(6)!.termsDocumentVersion).toBe(OLD);
    expect(state.txCalls).toBe(0);
  });

  it('非官方实例 ⇒ 拒 `not-applicable`，零写入（那台机器没有可宣告的版本）', async () => {
    seedUser(7, null);
    setPublicUrl(SELF_HOSTED_URL);
    const r = await recordLegalReconfirm({
      userId: 7,
      clientVersion: LEGAL_SET_VERSION,
      acceptedAt: 1,
    });
    expect(r).toEqual({ ok: false, error: 'not-applicable' });
    expect(state.consents).toHaveLength(0);
    expect(state.txCalls).toBe(0);
  });

  it('同意时刻不合法（0 / 负数 / 小数）⇒ 拒，零写入：证据不能是 1970 年', async () => {
    for (const acceptedAt of [0, -1, 1.5]) {
      seedUser(8, OLD);
      state.consents.length = 0;
      const r = await recordLegalReconfirm({
        userId: 8,
        clientVersion: LEGAL_SET_VERSION,
        acceptedAt,
      });
      expect({ acceptedAt, r }).toEqual({
        acceptedAt,
        r: { ok: false, error: 'version-mismatch' },
      });
      expect(state.consents).toHaveLength(0);
    }
  });

  it('🔴 把两次写拆到事务外面 ⇒ 本组判据必须红（不许"看起来对"就合上）', async () => {
    // 这条不是测代码，是测**这份测试自己有没有牙**：把 recordLegalReconfirm 里
    // 的 upsert / update 改成顶层 prisma 调用时，writesOutsideTx 会收到名字、
    // txCalls 变成 0，下面两句之一必红。变异实测见台账 G-27 那段。
    seedUser(9, OLD);
    await recordLegalReconfirm({ userId: 9, clientVersion: LEGAL_SET_VERSION, acceptedAt: 1 });
    expect(state.writesOutsideTx).toEqual([]);
    expect(state.txCalls).toBe(1);
  });
});
