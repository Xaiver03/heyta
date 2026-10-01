/**
 * 口令哈希层与**启动自检**的判据（计划 `docs/plans/email-password-auth.md` §8 里 J1/J2/J5 那一组）。
 *
 * 这一组判据的共同目的不是"哈希算得出来"，而是钉住四件容易悄悄坏掉的事：
 *
 * 1. **参数就是策略** —— 落库的 PHC 串必须写着 OWASP 最低参数，否则"我们按 OWASP 存"只是注释。
 * 2. **pepper 参与哈希** —— 如果它没参与，泄库就能离线爆破，整个设计的前提消失。
 *    这条由"换一个 pepper 复算同一条 known-answer，摘要必须变"来钉，而不是由代码注释来钉。
 * 3. **反枚举的计时平摊是真的** —— 账号不存在时跑的那个 dummy 必须与真校验**同参数**，
 *    否则它只是一次便宜的字符串比较，秒表还是能枚举账号。
 * 4. **启动自检会失败** —— 只断言它返回 `ok: true` 的自检等于没有自检。
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as argon2 from '@node-rs/argon2';

import {
  PASSWORD_PARAMS,
  getPasswordPepper,
  DUMMY_PHC,
  dummyVerify,
  PASSWORD_KAT,
  checkPasswordBackend,
  assertPasswordBackend,
  hashPassword,
  verifyPassword,
  needsRehash,
} from '../src/password/hash';

/** 与 `hash.ts` 里那个**未导出**的下限对齐：测试从行为侧钉住 32，而不是把常量导出来再抄一遍。 */
const PEPPER_MIN = 32;

const GOOD_PEPPER = 'test-pepper-that-is-definitely-long-enough-32chars';

// 本仓库的 vitest 会加载 `server/.env`，那里现在确实有 PASSWORD_PEPPER，
// 所以"未配置"这条路必须临时把变量删掉才走得到 —— 走完必须还原，否则同一进程里
// 后面的 spec 会在一个没人预期的环境下跑。
const originalPepper = process.env.PASSWORD_PEPPER;

const setPepper = (value: string | undefined): void => {
  if (value === undefined) delete process.env.PASSWORD_PEPPER;
  else process.env.PASSWORD_PEPPER = value;
};

afterEach(() => {
  setPepper(originalPepper);
});

describe('口令哈希参数（OWASP 最低线）', () => {
  it('参数不低于 OWASP Password Storage Cheat Sheet 的 Argon2id 最低推荐', () => {
    expect(PASSWORD_PARAMS.algorithm).toBe(argon2.Algorithm.Argon2id);
    expect(PASSWORD_PARAMS.memoryCost).toBeGreaterThanOrEqual(19_456);
    expect(PASSWORD_PARAMS.timeCost).toBeGreaterThanOrEqual(2);
    expect(PASSWORD_PARAMS.parallelism).toBeGreaterThanOrEqual(1);
    expect(PASSWORD_PARAMS.outputLen).toBeGreaterThanOrEqual(32);
    expect(PASSWORD_PARAMS.saltBytes).toBeGreaterThanOrEqual(16);
  });

  it('新写入的哈希确实带着这套参数（策略不是只写在源码里）', async () => {
    setPepper(GOOD_PEPPER);
    const phc = await hashPassword('a password that is long enough');
    const parsed = argon2.parseOptions(phc);
    expect(parsed.algorithm).toBe(PASSWORD_PARAMS.algorithm);
    expect(parsed.memoryCost).toBe(PASSWORD_PARAMS.memoryCost);
    expect(parsed.timeCost).toBe(PASSWORD_PARAMS.timeCost);
    expect(parsed.parallelism).toBe(PASSWORD_PARAMS.parallelism);
    expect(parsed.outputLen).toBe(PASSWORD_PARAMS.outputLen);
    // 自己刚按当前策略洗出来的串，不该被判定成"需要重算"。
    expect(needsRehash(phc)).toBe(false);
  });

  it('同一句口令两次哈希得到不同的串（每次都是新 salt）', async () => {
    setPepper(GOOD_PEPPER);
    const [a, b] = await Promise.all([hashPassword('same-input'), hashPassword('same-input')]);
    expect(a).not.toBe(b);
    // 但两者都必须验得过 —— 差异只在 salt，不在摘要语义。
    expect(await verifyPassword('same-input', a)).toBe(true);
    expect(await verifyPassword('same-input', b)).toBe(true);
  });
});

describe('pepper 的取用纪律（与 JWT_SECRET 同一条）', () => {
  it('未配置 ⇒ 抛错，且错误信息点名 PASSWORD_PEPPER', () => {
    setPepper(undefined);
    expect(() => getPasswordPepper()).toThrow(/PASSWORD_PEPPER/);
  });

  it(`短于 ${PEPPER_MIN} 字符 ⇒ 抛错并点名下限，而不是默默补齐`, () => {
    setPepper('x'.repeat(PEPPER_MIN - 1));
    expect(() => getPasswordPepper()).toThrow(new RegExp(String(PEPPER_MIN)));
  });

  it('恰好达标 ⇒ 按 UTF-8 字节取用（非 ASCII 的口令与 pepper 走同一条编码路径）', () => {
    setPepper('x'.repeat(PEPPER_MIN));
    expect(getPasswordPepper()).toEqual(new TextEncoder().encode('x'.repeat(PEPPER_MIN)));
  });

  it('🔴 pepper 真的参与哈希：换一个 pepper，同一条 known-answer 的摘要必须变', async () => {
    // 这条是"泄库也爆破不动"的全部理由。如果 pepper 只是被拼在口令前后又被 normalize 掉、
    // 或者根本没传给 argon2，这里两次摘要会相同而测试依然"看起来对"。
    const options = {
      algorithm: PASSWORD_PARAMS.algorithm,
      memoryCost: PASSWORD_PARAMS.memoryCost,
      timeCost: PASSWORD_PARAMS.timeCost,
      parallelism: PASSWORD_PARAMS.parallelism,
      outputLen: PASSWORD_PARAMS.outputLen,
      salt: PASSWORD_KAT.salt,
    };
    const withKatPepper = await argon2.hash(PASSWORD_KAT.password, {
      ...options,
      secret: PASSWORD_KAT.pepper,
    });
    const withOtherPepper = await argon2.hash(PASSWORD_KAT.password, {
      ...options,
      secret: new Uint8Array(32).fill(12),
    });

    expect(withKatPepper).toBe(PASSWORD_KAT.phc);
    expect(withOtherPepper).not.toBe(PASSWORD_KAT.phc);

    const digestOf = (phc: string): string => phc.split('$')[5];
    expect(digestOf(withOtherPepper)).not.toBe(PASSWORD_KAT.digestHex);
    // 裸摘要 hex 必须是同一条串的另一种写法（否则 digestHex 是个没人核对的装饰）。
    expect(Buffer.from(digestOf(withKatPepper), 'base64').toString('hex')).toBe(
      PASSWORD_KAT.digestHex,
    );
  });

  it('用 A 的 pepper 洗的哈希，换成 B 之后验不过（fail-closed，不是"宽松匹配"）', async () => {
    setPepper(GOOD_PEPPER);
    const phc = await hashPassword('rotating this pepper breaks verification');
    setPepper('a-completely-different-pepper-value-that-is-32+');
    expect(await verifyPassword('rotating this pepper breaks verification', phc)).toBe(false);
  });

  it('pepper 缺失时校验一律为假 —— 配置问题不得伪装成"口令对了"', async () => {
    setPepper(GOOD_PEPPER);
    const phc = await hashPassword('some password');
    setPepper(undefined);
    expect(await verifyPassword('some password', phc)).toBe(false);
  });
});

describe('反枚举用的 dummy 校验', () => {
  it('dummy 的 PHC 串带的参数 == 当前策略（计时才等同一条路）', () => {
    const parsed = argon2.parseOptions(DUMMY_PHC);
    expect(parsed.algorithm).toBe(PASSWORD_PARAMS.algorithm);
    expect(parsed.memoryCost).toBe(PASSWORD_PARAMS.memoryCost);
    expect(parsed.timeCost).toBe(PASSWORD_PARAMS.timeCost);
    expect(parsed.parallelism).toBe(PASSWORD_PARAMS.parallelism);
    expect(parsed.outputLen).toBe(PASSWORD_PARAMS.outputLen);
  });

  it('dummyVerify 恒为 false：正确的口令、常见的错口令、空串都不许通过', async () => {
    setPepper(GOOD_PEPPER);
    // 唯一能让它返回 true 的办法是 DUMMY_PHC 的摘要恰好等于某个真实哈希的摘要。
    // 拿真哈希反证：同一条口令真洗出来的串能过，dummy 不能。
    const real = await hashPassword('hunter2hunter2hunter2');
    expect(await verifyPassword('hunter2hunter2hunter2', real)).toBe(true);
    expect(await dummyVerify('hunter2hunter2hunter2')).toBe(false);
    expect(await dummyVerify('wrong')).toBe(false);
    expect(await dummyVerify('')).toBe(false);
  });

  it('未配置 pepper 时 dummyVerify 仍然返回 false 而不是抛（把配置问题伪装成认证结果才是坏的）', async () => {
    setPepper(undefined);
    expect(await dummyVerify('anything')).toBe(false);
  });
});

describe('needsRehash：登录时就地重洗的判据', () => {
  it('低于策略的参数 ⇒ true', () => {
    const weaker = DUMMY_PHC.replace(
      `m=${PASSWORD_PARAMS.memoryCost},t=${PASSWORD_PARAMS.timeCost},p=${PASSWORD_PARAMS.parallelism}`,
      'm=16384,t=1,p=1',
    );
    expect(weaker).not.toBe(DUMMY_PHC);
    expect(needsRehash(weaker)).toBe(true);
  });

  it('解析不了的串 ⇒ true（宁可重洗，也不认它"符合策略"）', () => {
    expect(needsRehash('$argon2id$v=19$not-a-real-hash')).toBe(true);
    expect(needsRehash('bcrypt-looking-prefix')).toBe(true);
  });

  it('当前策略 ⇒ false（否则每次登录都白算一次 19 MiB）', async () => {
    setPepper(GOOD_PEPPER);
    expect(needsRehash(await hashPassword('freshly hashed'))).toBe(false);
  });
});

describe('启动自检（checkPasswordBackend / assertPasswordBackend）', () => {
  it('known-answer 通过 ⇒ 返回 ok，并给出单次耗时', async () => {
    const report = await checkPasswordBackend();
    expect(report.ok).toBe(true);
    expect(Number.isFinite(report.msPerHash)).toBe(true);
    expect(report.msPerHash).toBeGreaterThanOrEqual(0);
  });

  it('pepper 缺失 ⇒ assertPasswordBackend 拒绝，且信息点名 PASSWORD_PEPPER', async () => {
    setPepper(undefined);
    await expect(assertPasswordBackend()).rejects.toThrow(/PASSWORD_PEPPER/);
  });

  it('pepper 太短 ⇒ 拒绝并点名下限', async () => {
    setPepper('nope');
    await expect(assertPasswordBackend()).rejects.toThrow(new RegExp(String(PEPPER_MIN)));
  });

  it('pepper 达标 ⇒ 通过（两道环节都过才算启动可以放行）', async () => {
    setPepper(GOOD_PEPPER);
    await expect(assertPasswordBackend()).resolves.toMatchObject({ ok: true });
  });
});

describe('🔴 口令只有一个哈希真源', () => {
  // 这一组存在的理由是一条**已经踩到的**缺陷：`server/src/test-routes.ts`（TEST_MODE 造号）
  // 过去用 bcrypt 写 `password_hash`，而产品那条登录路径只认 Argon2id。两者的串长得都像
  // 哈希、列类型都是 `string`、写入也不报错 —— 症状是"测试账号能拿到 JWT，却永远输不进密码"，
  // 只在 E2E 里现形，而且最先被怀疑的总是 E2E 脚本。
  it('bcrypt 形状的串在这里一律验不过（不是"兼容旧格式"）', async () => {
    setPepper(GOOD_PEPPER);
    // bcryptjs 的真实产物形状：$2b$<rounds>$<22 位 salt><31 位摘要>
    const bcryptShaped =
      '$2b$12$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
    await expect(verifyPassword('correct-password-123!', bcryptShaped)).resolves.toBe(
      false,
    );
    // 它同时必须被判定为"低于策略" ⇒ 万一真有这种存量数据，登录会就地重洗成 Argon2id，
    // 而不是把它当成符合当前策略的哈希留在库里。
    expect(needsRehash(bcryptShaped)).toBe(true);
  });

  it('本层写出的串一定是 Argon2id PHC（于是任何读写方都只可能遇到这一种格式）', async () => {
    setPepper(GOOD_PEPPER);
    const phc = await hashPassword('anything');
    expect(phc.startsWith('$argon2id$')).toBe(true);
    expect(phc).not.toMatch(/^\$2[aby]\$/);
  });
});
