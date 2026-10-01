/**
 * 口令**策略**：归一化、长度、常见口令、泄露口令。只在"设口令"的那一刻跑
 * （注册 / 改密 / 重置完成），🔴 **登录路径一律不跑**（见下 HIBP 那条注释）。
 *
 * ## 立场来自哪里
 *
 * - **NIST SP 800-63B**：允许 ≥64 字符、禁止静默截断、**禁止组成规则**
 *   （"必须含大写/数字/符号"那一套）、**禁止定期强制更换**。所以这里只有一条硬规则：长度。
 * - 🔴 **本仓库有意偏离 NIST 的一处**：Rev 4 说单因子口令 SHALL ≥15 字符，
 *   产品负责人定的下限是 **8**。偏离成立的前提就是**下面那三道补偿控制**（本地常见口令表、
 *   泄露口令检查、账号级失败锁定）必须存在 —— 少了它们，8 位就只是"更弱的口令"，
 *   而不是"可接受的权衡"。这条偏离与它的补偿写进 ADR-0040。
 * - **OWASP Password Storage / Change Authentication Cheat Sheet**：泄露口令检查
 *   用 k-匿名范围接口，且**绝不**把它挂在认证热路径上。
 */
import { createHash } from 'crypto';
import { Logger } from '../logger';

/** 产品负责人拍板的下限（NIST 单因子建议 15；偏离的理由见文件头）。 */
export const MIN_PASSWORD_CODE_POINTS = 8;
/**
 * 上限按**码点**算（不是 UTF-16 单元），否则一个 emoji 占两个单元，
 * 限额会随输入法悄悄变化。256 足够容纳 passphrase，同时挡住"拿 10 MB 字符串来哈希"
 * —— Argon2 对输入长度不敏感，但内存、日志与 HTTP 体敏感。
 */
export const MAX_PASSWORD_CODE_POINTS = 256;

/**
 * 口令**唯一**的归一化口径。
 *
 * 🔴 NFKC 而不是 NFC：把 `ﬁ` / `½` / 全角字符折叠掉，避免"看着一样、字节不一样"。
 * ⚠️ 这条**只覆盖登录口令**。E2EE 口令那条路（`packages/sync-core` 的派生）**没有做任何
 * normalize** —— 实测 `grep normalize(` 在 sync-core / app-host / storage 零命中，
 * 而 `'café'.normalize('NFC') !== 'café'.normalize('NFD')`，所以 iOS 键盘给出 NFD 时
 * 同一句话会派生出**不同密钥**。那是一条涉及存量密文可解性的**独立缺陷**，
 * 按计划 §10 第 11 条单独处理，不在这里顺手改（改了会让用 NFD 写过的设备当场解不开）。
 */
export const normalizePassword = (input: string): string => input.normalize('NFC').normalize('NFKC');

const codePoints = (s: string): number => Array.from(s).length;

export type PasswordPolicyCode = 'too_short' | 'too_long' | 'too_common' | 'breached';

export interface PasswordPolicyRejection {
  ok: false;
  code: PasswordPolicyCode;
}
export interface PasswordPolicyAcceptance {
  ok: true;
  /** 归一化**之后**的口令。落库与后续校验只能用它 —— 各处再 normalize 一次就是第二套规则。 */
  normalized: string;
}
export type PasswordPolicyResult = PasswordPolicyRejection | PasswordPolicyAcceptance;

/**
 * 本地常见口令表：`@zxcvbn-ts/language-common` 的 `passwords-common`（49 233 条，MIT）。
 *
 * 🔴 **只当精确匹配黑名单用，不引入 `@zxcvbn-ts/core`、不把它的"分数"做成门槛**。
 * 两点理由：① 分数门槛本质是**组成规则**的另一种写法（它会因为"含日期/含字典词"拒绝
 * 一个 20 字符的 passphrase），而 NIST 明确禁止组成规则；② 引 core 会多一处依赖，
 * 而我们要的只是它那份表。
 *
 * 惰性构建（首次用到才 `require` 那份 ~1.9 MB JSON）：服务启动路径上不该有这一步,
 * 而且 TEST_MODE 下没人设口令时它永远不该被加载。
 */
let blocklist: Set<string> | null = null;
const commonPasswords = (): Set<string> => {
  if (blocklist) return blocklist;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { dictionary } = require('@zxcvbn-ts/language-common') as {
    dictionary: Record<string, string[]>;
  };
  const list = dictionary['passwords-common'] ?? [];
  const set = new Set<string>();
  for (const entry of list) {
    set.add(entry);
    // 表本身是小写的；用户输入的 `Password` 也算命中（但**不改**他要存的口令）。
    set.add(entry.toLowerCase());
  }
  blocklist = set;
  return set;
};

/** 精确命中常见口令表。导出是为了让测试能钉住"它确实在拦"（而不是一个永远不命中的一行）。 */
export const isCommonPassword = (normalized: string): boolean => {
  const set = commonPasswords();
  return set.has(normalized) || set.has(normalized.toLowerCase());
};

const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range';
/**
 * 从**生产主机**实测（2026-10-01）：6 次全 HTTP 200，耗时 0.94 / 1.03 / 1.41 / 1.83 / 2.05 / 2.71 s,
 * 其中 TLS 握手单独占 1.17 s。原设计的 1 s 超时会让**一半以上**的查询在结果回来前被砍掉,
 * 而 fail-open 会把这种超时伪装成"这口令没泄露"。所以取**覆盖实测上界**的 2 s。
 */
const HIBP_TIMEOUT_MS = 2_000;

export interface BreachCheckOutcome {
  /** `false` = 没查出问题（**包含**"没查成"，见 `delivered`）。调用方据此放行。 */
  breached: boolean;
  /** 🔴 查询是否真的送达并拿到了可解析的回答。 */
  delivered: boolean;
}

/**
 * HIBP k-匿名范围查询：只把 SHA-1 的**前 5 个十六进制字符**发出去。
 *
 * 🔴 三条纪律：
 * 1. **不在登录路径上调用** —— 这是一个 1–3 s 的外部依赖,挂在认证热路径上等于
 *    把"第三方抖动"变成"我们登录不了"。NIST 也不要求在这里查。
 * 2. **fail-open**（查不成就算通过）—— 否则 HIBP 一挂,全站的注册与改密一起停摆。
 * 3. 🔴 但 fail-open **必须留下一条 warn**。没有它,"检查通过"与"根本没检查成"
 *    在日志里长得一模一样,而后者事后完全无法归因。
 *
 * 因为 (2)，**本地常见口令表才是确定性那一道**，HIBP 只是第二层加分。
 */
export const checkPasswordBreached = async (
  normalized: string,
): Promise<BreachCheckOutcome> => {
  const sha1 = createHash('sha1').update(normalized, 'utf8').digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  let response: Response;
  try {
    response = await fetch(`${HIBP_RANGE_URL}/${prefix}`, {
      signal: AbortSignal.timeout(HIBP_TIMEOUT_MS),
      headers: { 'User-Agent': 'heyta-auth', 'Add-Padding': 'true' },
    });
  } catch (err) {
    Logger.warn(
      `Password breach check not delivered (timeout/network): prefix=${prefix} ${
        err instanceof Error ? err.message : 'unknown'
      }`,
    );
    return { breached: false, delivered: false };
  }

  if (!response.ok) {
    Logger.warn(
      `Password breach check not delivered (HTTP ${response.status}): prefix=${prefix}`,
    );
    return { breached: false, delivered: false };
  }

  const body = await response.text().catch(() => '');
  if (body === '') {
    Logger.warn(`Password breach check returned an empty body: prefix=${prefix}`);
    return { breached: false, delivered: false };
  }

  for (const line of body.split('\n')) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    if (line.slice(0, colon).trim() !== suffix) continue;
    // 🔴 **次数要读**。因为我们发了 `Add-Padding: true`，应答里必然混着 `:0` 的填充行
    // —— 那 0 是接口在说"这条没出现过"。只比 suffix 不看次数，就等于拿一个填充行
    // 把好口令判成已泄露，症状是"我的口令明明没人用过却被拒"，事后极难归因。
    const count = Number.parseInt(line.slice(colon + 1).trim(), 10);
    if (!Number.isFinite(count) || count <= 0) continue;
    return { breached: true, delivered: true };
  }
  return { breached: false, delivered: true };
};

/**
 * 静态策略（长度 + 本地表）。**同步、零网络**，所以它必须先跑：
 * 一个 5 字符的口令不该为一个网络往返才被拒。
 */
export const checkPasswordStaticPolicy = (
  normalized: string,
): PasswordPolicyRejection | null => {
  const length = codePoints(normalized);
  if (length < MIN_PASSWORD_CODE_POINTS) return { ok: false, code: 'too_short' };
  if (length > MAX_PASSWORD_CODE_POINTS) return { ok: false, code: 'too_long' };
  if (isCommonPassword(normalized)) return { ok: false, code: 'too_common' };
  return null;
};

/**
 * 设口令时的完整检查：静态策略 → 泄露检查。
 *
 * 返回 `normalized` 而不是原始输入：调用方（注册 / 改密 / 重置）**必须**存与验同一个函数
 * 产出的串。两处各 normalize 一次就是第二套规则，而那正是"NFC/NFD 两边不一致"
 * 这类缺陷的生成方式。
 */
export const checkNewPassword = async (
  raw: string,
): Promise<PasswordPolicyResult> => {
  const normalized = normalizePassword(raw);
  const staticRejection = checkPasswordStaticPolicy(normalized);
  if (staticRejection) return staticRejection;

  const breach = await checkPasswordBreached(normalized);
  if (breach.breached) return { ok: false, code: 'breached' };

  return { ok: true, normalized };
};
