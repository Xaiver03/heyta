/**
 * AI 端点密钥的运维命令
 * =========================
 *
 * ```
 * heyta-ai key set <endpointId>     # 从 **stdin** 读密钥
 * heyta-ai key list                 # 列出哪些端点有密钥（**从不打印密钥**）
 * heyta-ai key clear <endpointId>
 * ```
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ## 🔴 密钥从 **stdin** 读，绝不从命令行参数读
 *
 * `heyta-ai key set e1 sk-xxxx` 会把密钥写进**进程命令行**，
 * 于是一次 `ps` 就能看到它，shell 历史里也会留一份。
 *
 * 所以 `set` **只从 stdin 读**。用法：
 *
 * ```sh
 * printf '%s' "$MY_KEY" | heyta-ai key set e1
 * ```
 *
 * 传了参数时**明确报错**而不是忽略 —— 否则用户以为存进去了，
 * 实际存了个空值（这是最容易发生、也最难查的一类"静默失效"）。
 *
 * ## 🔴 密钥只进系统钥匙串，不进任何 heyta 自己的存储
 *
 * 本命令**只**调 `SecretStore`。它不碰配置文件、不碰数据库、不碰 op-log。
 * AI 设置（端点地址、路由）是普通配置；密钥不是。
 * 两者混在一个文件里，那个文件就变成了密钥文件。
 *
 * ## ⚠️ 平台
 *
 * 目前只有 macOS（`/usr/bin/security`）。
 * 其他平台**明确报错**，不假装能用 —— 见 `keychain-secret-store.ts`。
 */

import {
  createKeychainSecretStore,
  isKeychainAvailable,
  type WritableSecretStore,
} from './keychain-secret-store.js';

export interface AiKeyCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** 从 stdin 全部读进来（密钥可能含前后空格，所以**不 trim**）。 */
export async function readSecretFromStdin(
  input: NodeJS.ReadableStream = process.stdin,
): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  }
  // 去掉管道带来的**一个**结尾换行 —— 用户在 shell 里几乎总会带一个。
  // ⚠️ 只去一个，且只去结尾的：中间和开头的空白是密钥的一部分。
  const text = Buffer.concat(chunks).toString('utf8');
  return text.endsWith('\n') ? text.slice(0, -1) : text;
}

/**
 * 跑一条密钥命令。
 *
 * 拆出来而不是直接写 `main()`，是为了**能在测试里喂 stdin 并断言 stdout**。
 */
/**
 * 🔴🔴 **必须可注入。**
 *
 * 默认实现会写**用户的登录钥匙串**。上一轮已经因为这个出过一次事故
 * （注入验证时写坏过真实钥匙串），所以这里从第一天就留出注入点：
 * 测试一律传 `store`，绝不落到真实钥匙串。
 */
export interface AiKeyCommandDeps {
  /** 密钥存储。默认是 macOS 钥匙串。 */
  store?: WritableSecretStore;
  /** 平台是否支持。默认探测。 */
  available?: boolean;
  /**
   * 目标钥匙串文件路径。默认读环境变量 `HEYTA_KEYCHAIN_PATH`，
   * 都没有时用用户的登录钥匙串。
   */
  keychainPath?: string;
}

export async function runAiKeyCommand(
  argv: readonly string[],
  stdin: NodeJS.ReadableStream = process.stdin,
  deps: AiKeyCommandDeps = {},
): Promise<AiKeyCommandResult> {
  const [sub, endpointId] = argv;
  // 🔴 `HEYTA_KEYCHAIN_PATH` 让我们能把 heyta 的密钥放进**专门的钥匙串**，
  // 而不是用户的登录钥匙串。这不是测试专用的 —— 它让"heyta 的密钥
  // 和别的应用的密钥分开"成为可能，本身就是一个正当的运维选项。
  const keychainPath = deps.keychainPath ?? process.env['HEYTA_KEYCHAIN_PATH'];
  const store =
    deps.store ??
    createKeychainSecretStore(keychainPath === undefined ? {} : { keychainPath });
  const available = deps.available ?? isKeychainAvailable();

  switch (sub) {
    case 'set': {
      if (endpointId === undefined || endpointId.trim() === '') {
        return { code: 1, stdout: '', stderr: '用法：key set <endpointId>（密钥从 stdin 读）\n' };
      }
      // 🔴 传了多余参数 = 用户想把密钥写在命令行里 —— 明确拒绝。
      if (argv.length > 2) {
        return {
          code: 1,
          stdout: '',
          stderr:
            '不要把密钥写在命令行里 —— 那会让它出现在 `ps` 和 shell 历史里。\n' +
            '改用 **stdin**：\n' +
            "  printf '%s' \"$KEY\" | heyta-ai key set " +
            endpointId +
            '\n',
        };
      }
      if (!available) {
        return { code: 1, stdout: '', stderr: '这个平台还没有实现系统钥匙串支持。\n' };
      }

      const secret = await readSecretFromStdin(stdin);
      if (secret === '') {
        return { code: 1, stdout: '', stderr: '从 stdin 读到的是空内容，没有存任何东西。\n' };
      }

      await store.set(endpointId, secret);
      // 🔴 只回报长度，**绝不回报内容**。
      return {
        code: 0,
        stdout: `已把密钥存进系统钥匙串（端点 ${endpointId}，${String(secret.length)} 字符）。\n`,
        stderr: '',
      };
    }

    case 'clear': {
      if (endpointId === undefined || endpointId.trim() === '') {
        return { code: 1, stdout: '', stderr: '用法：key clear <endpointId>\n' };
      }
      await store.clear(endpointId);
      return { code: 0, stdout: `已从系统钥匙串删除端点 ${endpointId} 的密钥。\n`, stderr: '' };
    }

    case 'list': {
      // ⚠️ 这里只说明"钥匙串可用不可用"。
      // 真正的"哪些端点有密钥"要拿端点清单去逐个 probe，
      // 而端点清单在 AI 设置里 —— 本命令刻意不读它（见文件头）。
      return {
        code: 0,
        stdout: available
          ? '系统钥匙串可用（macOS）。用 `key set <endpointId>` 逐个存入。\n'
          : '⚠️ 这个平台没有实现系统钥匙串支持，密钥无处可存。\n',
        stderr: '',
      };
    }

    default:
      return {
        code: 1,
        stdout: '',
        stderr:
          '用法：\n' +
          '  key set <endpointId>   # 从 stdin 读密钥\n' +
          '  key clear <endpointId>\n' +
          '  key list\n',
      };
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  // 允许 `heyta-ai key set e1` 与 `heyta-ai set e1` 两种写法。
  const normalized = argv[0] === 'key' ? argv.slice(1) : argv;
  const result = await runAiKeyCommand(normalized);
  if (result.stdout !== '') process.stdout.write(result.stdout);
  if (result.stderr !== '') process.stderr.write(result.stderr);
  process.exit(result.code);
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('cli-ai.js')) {
  void main();
}
