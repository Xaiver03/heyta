/**
 * 密码的**哈希与校验**（ADR-0040 / 计划 `docs/plans/email-password-auth.md` D3）。
 *
 * ## 为什么是 Argon2id + pepper + PHC 串
 *
 * OWASP Password Storage Cheat Sheet 的首选。bcrypt 被排除的理由不是"更旧"，而是它有
 * 72 字节静默截断（与 NIST"允许 ≥64 字符、禁止静默截断"直接冲突），而绕开截断要先做
 * 预哈希 —— 那个组合是已知的 footgun（空字节碰撞 + password shucking）。
 *
 * **pepper 走 Argon2 原生的 `secret` 参数**，不做 HMAC 预哈希：预哈希存在的唯一理由
 * 就是上面那条长度限制，Argon2 对输入长度没有限制。已实测（W0 探针 1）：同一条口令在
 * 带 `secret` 时，原生 musl / 原生 glibc / 纯 JS 三个实现的输出**逐字节相同**。
 *
 * 🔴 后果要写清楚：pepper 是**参与哈希的秘密**，换掉或丢掉 pepper，存量密码哈希
 * **全部验不过**（`verify` 返回 `false`，不是"降级还能登"）。所以它是部署时**必须备份**的项。
 *
 * ## 存的是 PHC 自描述串
 *
 * `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>` 整条进已有的 `User.passwordHash` 列
 * ⇒ 不需要新列、不需要 bump `CURRENT_SCHEMA_VERSION`。算法与成本跟着哈希本身走，
 * 所以将来抬工作因子只要改本文件的 `PASSWORD_PARAMS`，旧串仍然能验（`verifyPassword`
 * 从串里取参数），并在**登录成功时**用 `needsRehash` 决定要不要就地重算。
 */
import { randomBytes } from 'crypto';
import * as argon2 from '@node-rs/argon2';

/** OWASP 2025 的最低推荐值（19 MiB / 2 遍 / 1 线程 / 32 字节输出 / 16 字节 salt）。 */
export const PASSWORD_PARAMS = {
  algorithm: argon2.Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
  saltBytes: 16,
} as const;

const MIN_PEPPER_LENGTH = 32;

/**
 * 与 `JWT_SECRET` **同一条纪律**：缺失或太短 ⇒ 抛，而且抛在能看见的地方。
 *
 * 不在模块顶层求值（那样会让任何 `import` 到这里的测试/脚本先被环境要求绊倒），
 * 而是每次取；启动自检 `assertPasswordBackend()` 会真的调一次，所以生产上
 * "能起来"就等于"pepper 可用"。
 */
export const getPasswordPepper = (): Uint8Array => {
  const pepper = process.env.PASSWORD_PEPPER;
  if (!pepper) {
    throw new Error(
      'PASSWORD_PEPPER environment variable is required for email+password sign-in. ' +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  if (pepper.length < MIN_PEPPER_LENGTH) {
    throw new Error(
      `PASSWORD_PEPPER must be at least ${MIN_PEPPER_LENGTH} characters for security`,
    );
  }
  return new TextEncoder().encode(pepper);
};

/**
 * PHC 里的 salt/摘要用**标准 base64 字母表、不带 padding**。
 * 换成 URL-safe 会在字节含 `+` / `/` 时产出一个解析不了的串。
 */
const b64NoPad = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString('base64').replace(/=+$/, '');

/**
 * 账号**不存在**时也要跑的那一次校验用的固定串。
 *
 * 🔴 它存在的理由只有一个：**没有它，反枚举就只是文案层面的**。`verify` 一个不存在的
 * 账号如果直接返回 false，响应会快 ~35 ms，而打真实哈希慢 ~35 ms —— 攻击者不需要读
 * 错误信息，拿秒表就能枚举账号。所以"查不到账号"这条路必须**也**做一次同参数的 Argon2。
 *
 * 摘要本身是**故意对不上**的（它是在另一个 pepper 下算出来的）⇒ 永远返回 false。
 * 参数必须与 `PASSWORD_PARAMS` 一致，否则计时不等同一条路；这一条由测试钉住
 * （见 `password-hash.spec.ts` 里"dummy 的参数 == 策略"那条判据）。
 */
const DUMMY_PHC_SALT = new Uint8Array(16).fill(7);
const DUMMY_PHC_DIGEST = new Uint8Array(32).fill(21);
export const DUMMY_PHC = [
  '',
  'argon2id',
  'v=19',
  `m=${PASSWORD_PARAMS.memoryCost},t=${PASSWORD_PARAMS.timeCost},p=${PASSWORD_PARAMS.parallelism}`,
  b64NoPad(DUMMY_PHC_SALT),
  b64NoPad(DUMMY_PHC_DIGEST),
].join('$');

/**
 * 校验一个**永远不可能通过**的哈希，只为把耗时抹平。
 *
 * ⚠️ 不返回结果也不抛错之外的信息：调用方拿到 `false` 就该当"密码不对"处理，
 * 因为这条路上没有账号可归属。
 */
export const dummyVerify = async (password: string): Promise<false> => {
  await argon2
    .verify(DUMMY_PHC, password, { secret: safePepperBytes() })
    .catch(() => undefined);
  return false;
};

/**
 * `dummyVerify` 里的 pepper 取不到时（未配 `PASSWORD_PEPPER`）也必须**照样花时间**。
 *
 * 直接抛在这里的话，"未配 pepper 的实例"上的计时特征是"秒回" —— 那正是本函数要消除的东西，
 * 而且它会把一个配置问题伪装成一次认证结果。所以取不到就用固定字节的 salt/pepper 跑一遍：
 * 时长同形，结果恒为 false。真正该报错的地方是启动自检与写哈希的那两条路。
 */
const safePepperBytes = (): Uint8Array => {
  try {
    return getPasswordPepper();
  } catch {
    return new Uint8Array(32).fill(11);
  }
};

/**
 * 启动自检 —— **known-answer**，不是"能不能 require"。
 *
 * 生产镜像是 `node:24-alpine`（musl）。`@node-rs/argon2` 靠 `optionalDependencies` 里的
 * 平台预编译产物工作，而"包装上了"与"二进制能被 dlopen、算出来的字节是对的"是**三件事**
 * （`AGENTS.md` §7 第 32 条："pod 装了 ≠ 链接了"）。
 * 所以这里钉的不是"跑通了"，而是**一组逐字节的期望值**：固定口令 + 固定 salt + 固定 pepper
 * + OWASP 参数 ⇒ 固定的 PHC 串与固定的裸摘要。这三个值是在
 * macOS(glibc) / 生产容器(musl) / 纯 JS 实现 上**三方对照**实测出来的
 * （计划 `email-password-auth.md` W0-1 那张表）。
 *
 * 🔴 失败 ⇒ 让进程起不来。宁可部署失败，也不要"服务健康、第一个点登录的用户收到 500"，
 * 更不要它静默地把口令存成一个别人解不开的格式。
 */
export const PASSWORD_KAT = {
  password: 'correct horse battery staple',
  salt: new Uint8Array(16).fill(7),
  pepper: new Uint8Array(32).fill(11),
  phc: '$argon2id$v=19$m=19456,t=2,p=1$BwcHBwcHBwcHBwcHBwcHBw$hpjrzf04FKELqgfB1yCxEOWCsgZFlpjf1FKL7O3yu8k',
  digestHex: '8698ebcdfd3814a10baa07c1d720b110e582b206459698dfd4528becedf2bbc9',
} as const;

export interface PasswordBackendReport {
  ok: true;
  /** 一次 `hash` 的实测耗时（ms），只为让日志里能看出"这台机器慢得反常"。 */
  msPerHash: number;
}

/** 跑一次自检。**返回**结果而不是抛错，好让调用方选择"退出"还是"记录"；抛不抛由启动路径决定。 */
export const checkPasswordBackend = async (): Promise<PasswordBackendReport> => {
  const options = {
    algorithm: PASSWORD_PARAMS.algorithm,
    memoryCost: PASSWORD_PARAMS.memoryCost,
    timeCost: PASSWORD_PARAMS.timeCost,
    parallelism: PASSWORD_PARAMS.parallelism,
    outputLen: PASSWORD_PARAMS.outputLen,
    salt: PASSWORD_KAT.salt,
    secret: PASSWORD_KAT.pepper,
  };
  const startedAt = Date.now();
  const phc = await argon2.hash(PASSWORD_KAT.password, options);
  const msPerHash = Date.now() - startedAt;
  if (phc !== PASSWORD_KAT.phc) {
    throw new Error(`Argon2id known-answer mismatch: got ${phc}`);
  }
  const okTrue = await argon2.verify(PASSWORD_KAT.phc, PASSWORD_KAT.password, {
    secret: PASSWORD_KAT.pepper,
  });
  const okFalse = await argon2.verify(PASSWORD_KAT.phc, 'wrong', {
    secret: PASSWORD_KAT.pepper,
  });
  if (!okTrue || okFalse) {
    throw new Error(
      `Argon2id verify self-check failed (accepts=${okTrue} rejects=${okFalse})`,
    );
  }
  return { ok: true, msPerHash };
};

/**
 * 哈希一句口令。
 *
 * 🔴 **必须经 `withHashSlot` 调用**（见 `concurrency.ts`）：一次 ~35 ms 的 19 MiB 内存计算，
 * 在登录洪水中会把进程打成不可用 —— 这就是 OWASP 说"限并发"的原因，也是本函数自己不排队
 * 而把排队留给调用方的原因（ service 层要的是"整条认证流程"串行化，不只是哈希）。
 */
export const hashPassword = async (password: string): Promise<string> =>
  argon2.hash(password, {
    algorithm: PASSWORD_PARAMS.algorithm,
    memoryCost: PASSWORD_PARAMS.memoryCost,
    timeCost: PASSWORD_PARAMS.timeCost,
    parallelism: PASSWORD_PARAMS.parallelism,
    outputLen: PASSWORD_PARAMS.outputLen,
    salt: new Uint8Array(randomBytes(PASSWORD_PARAMS.saltBytes)),
    secret: getPasswordPepper(),
  });

/** 校验口令。参数（含 salt）全部从 `phc` 串里取，所以旧参数下的哈希照样能验。 */
export const verifyPassword = async (
  password: string,
  phc: string,
): Promise<boolean> => {
  try {
    return await argon2.verify(phc, password, { secret: getPasswordPepper() });
  } catch {
    return false;
  }
};

/**
 * 这条哈希是否**低于当前策略** ⇒ 登录成功后该就地重算。
 *
 * 用 `parseOptions()` 而不是自己切字符串：PHC 的参数字段是算法实现写的，
 * 将来它加字段（比如 `keyid=`）时手写解析器是最先坏的那一环。
 */
export const needsRehash = (phc: string): boolean => {
  try {
    const parsed = argon2.parseOptions(phc);
    return (
      parsed.algorithm !== PASSWORD_PARAMS.algorithm ||
      parsed.memoryCost !== PASSWORD_PARAMS.memoryCost ||
      parsed.timeCost !== PASSWORD_PARAMS.timeCost ||
      parsed.parallelism !== PASSWORD_PARAMS.parallelism ||
      parsed.outputLen !== PASSWORD_PARAMS.outputLen
    );
  } catch {
    // 认不出来的串一律算"需要重算"—— 但调用方**不能**因为它 needsRehash 就放行：
    // 口令校验仍然必须为真。这里只回答"存的参数是不是当前策略"。
    return true;
  }
};
