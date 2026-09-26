/**
 * 系统钥匙串支持的自备密钥存储（macOS）
 * =======================================
 *
 * 这是 [`SecretStore`](../../../packages/ai/src/routing.ts) 端口的**原生端实现**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么它在 `apps/` 而不是 `packages/`
 *
 * 这里每一行都是平台差异：调用哪个命令、怎么转义、往哪个钥匙串写。
 * ADR-0003 的判据是"这一行在决定**业务上该怎么做**吗"—— 答案是否。
 * 业务决定（"密钥不能进同步存储"）在 `packages/ai` 里，且已经做完了。
 *
 * 所以本文件只需要做一件事：**把密钥放进操作系统管的地方**。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ## 🔴 为什么是 `/usr/bin/security` 而不是一个钥匙串 npm 包
 *
 * 引进 `keytar` / `@napi-rs/keyring` 要过 AGENTS.md §3.1–3.2 的两道门
 * （可维护性 + 许可证），并新增一份需要逐平台构建的原生依赖。
 * 而 macOS 自带 `/usr/bin/security`，`keytar` 在底层**也是调它**（或 Security.framework）。
 *
 * 代价要写清楚：
 * - ⚠️ **只在 macOS 上有效。** Windows（Credential Manager）与 Linux（libsecret）
 *   需要各自的实现 —— 本文件不为它们假装可用（见 `isKeychainAvailable`）。
 * - ⚠️ 钥匙串被锁住或用户在弹窗上点"拒绝"时，`get` 会失败。
 *   本实现把它退化成 `undefined`（= 没有密钥）而不是抛错：
 *   **一个锁着的钥匙串不该让整个应用崩掉**，AI 功能灰着是可接受的状态。
 *
 * ## 🔴 密钥**绝不走 argv**
 *
 * `security add-generic-password -w <secret>` 会把密钥放进**进程命令行**，
 * 于是一次 `ps` 就能看到它。所以本实现统一走 `security -i`（从 **stdin** 读命令），
 * 密钥只出现在标准输入里。
 *
 * （实测确认：`-w` 不带值时**不会**从 stdin 读密码 —— 它退出码 0 但什么都没写。
 * 那是个"看起来成功、实际没存"的静默失效，所以不能用。）
 */

import { execFile } from 'node:child_process';

import type { SecretStore } from '@heyta/ai';

/** 默认服务名。同一台机器上按 `service + account` 唯一定位一条记录。 */
export const KEYCHAIN_SERVICE = 'heyta.ai';

/**
 * 运行 `security` 一次。
 *
 * 🔴 注入点：测试用它换成**临时钥匙串**上的真实调用，
 * 于是"转义对不对"能在真实实现上被验证，而不是在 mock 上被验证。
 */
export interface KeychainRunner {
  (args: readonly string[], stdin?: string): Promise<{ code: number; stdout: string; stderr: string }>;
}

/** 真实实现：调 `/usr/bin/security`。 */
export function createSecurityCliRunner(securityPath = '/usr/bin/security'): KeychainRunner {
  return (args, stdin) =>
    new Promise((resolve) => {
      const child = execFile(securityPath, [...args], (error, stdout, stderr) => {
        // 退出码非零**不是异常**：`find` 找不到东西也是非零。
        const code = error === null ? 0 : ((error as { code?: number }).code ?? 1);
        resolve({ code, stdout, stderr });
      });
      if (stdin !== undefined) {
        child.stdin?.end(stdin);
      } else {
        child.stdin?.end();
      }
    });
}

/**
 * 把一个值转义成 `security -i` 能安全读的一行参数。
 *
 * 🔴 **实测出来的规则**（在真实临时钥匙串上试过三种写法）：
 *
 * | 写法 | 结果 |
 * |---|---|
 * | 单引号 + `'\''`（shell 惯用） | ❌ `security -i` 的解析器**不认**，值被吞掉 |
 * | 不加引号 | ❌ 空格处被切断 |
 * | **双引号，`\` 与 `"` 各加一个反斜杠** | ✅ 空格 / 单引号 / 反斜杠 / 双引号 / `$;|&` 全部原样往返 |
 *
 * 所以这里是 `"` 包裹 + 转义 `\` 与 `"`。
 *
 * ⚠️ `-i` 是**逐行**读命令的，所以值里不能有换行。含控制字符时**明确拒绝**，
 * 而不是让它被悄悄截断 —— 一个被截断的密钥会在很久以后表现为"认证失败"，
 * 那时候没人会想到是写入时丢的。
 */
export function quoteForSecurity(value: string): string {
  // eslint-disable-next-line no-control-regex -- 这里的意图正是"找出控制字符"
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(
      '密钥里有换行或其他控制字符，无法安全写入系统钥匙串。' +
        'heyta 的 AI 端点密钥应该是一行文本；如果你在填多行私钥，请改用别的接法。',
    );
  }
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** 可写的密钥存储（端口只要求 `get`，写入是壳自己的事）。 */
export interface WritableSecretStore extends SecretStore {
  set(keyRef: string, secret: string): Promise<void>;
  clear(keyRef: string): Promise<void>;
}

export interface KeychainSecretStoreOptions {
  /** 服务名。测试用它隔离，避免污染用户真实记录。 */
  service?: string;
  /**
   * 目标钥匙串文件路径。
   *
   * `undefined` = 用户默认钥匙串（登录钥匙串）。
   * ⚠️ **测试必须传它**，否则会写到用户真实钥匙串里去。
   */
  keychainPath?: string;
  runner?: KeychainRunner;
  /** 平台探测，注入以便在非 macOS 上测"明确不可用"这条分支。 */
  platform?: string;
}

/** 这个平台有没有我们实现过的钥匙串。 */
export function isKeychainAvailable(platform: string = process.platform): boolean {
  return platform === 'darwin';
}

interface FindResult {
  found: boolean;
  secret?: string;
  /** 失败原因，只在"不是找不到"时才有值 —— 用于把锁住/拒绝与"没存过"区分开。 */
  error?: string;
}

/**
 * 读一条记录。
 *
 * `find-generic-password` 找不到时退出码非零（实测 -25300）。
 * 这里把它读成"没有"，其余非零读成 `error`。
 */
function parseFind(result: { code: number; stdout: string; stderr: string }): FindResult {
  if (result.code === 0) {
    // `-w` 只输出密码本身，末尾一个换行
    return { found: true, secret: result.stdout.replace(/\n$/, '') };
  }
  if (result.stderr.includes('could not be found')) {
    return { found: false };
  }
  return { found: false, error: result.stderr.trim() };
}

export function createKeychainSecretStore(
  options: KeychainSecretStoreOptions = {},
): WritableSecretStore {
  const service = options.service ?? KEYCHAIN_SERVICE;
  const runner = options.runner ?? createSecurityCliRunner();
  const platform = options.platform ?? process.platform;

  /** 把可选的目标钥匙串拼成一个尾参。 */
  const keychainArgs = (): string[] =>
    options.keychainPath === undefined ? [] : [options.keychainPath];

  return {
    async get(keyRef) {
      if (!isKeychainAvailable(platform)) return undefined;
      const result = await runner(
        ['find-generic-password', '-s', service, '-a', keyRef, '-w', ...keychainArgs()],
      );
      const parsed = parseFind(result);
      if (parsed.found) return parsed.secret;
      // 🔴 钥匙串锁着 / 用户拒绝 / 条目损坏 —— 一律退化成"没有密钥"。
      // 抛错会让整个 AI 功能不可用，而正确的观感是"灰着"。
      return undefined;
    },

    async set(keyRef, secret) {
      if (!isKeychainAvailable(platform)) {
        throw new Error('这个平台没有实现系统钥匙串支持。');
      }
      // 🔴 命令走 stdin：密钥不进 argv。
      // `-U` = 已存在就更新（幂等，不需要先删）。
      const line = `add-generic-password -U -s ${quoteForSecurity(service)} -a ${quoteForSecurity(keyRef)} -w ${quoteForSecurity(secret)}${options.keychainPath === undefined ? '' : ` ${quoteForSecurity(options.keychainPath)}`}\n`;
      const result = await runner(['-i'], line);
      if (result.code !== 0) {
        throw new Error(`写入系统钥匙串失败：${result.stderr.trim() || `退出码 ${String(result.code)}`}`);
      }
    },

    async clear(keyRef) {
      if (!isKeychainAvailable(platform)) return;
      // 删不存在的条目会非零 —— 那不是错误（清除本来就该幂等）。
      await runner(['delete-generic-password', '-s', service, '-a', keyRef, ...keychainArgs()]);
    },
  };
}
