/**
 * 注册 / 登录的命令行入口（非 Web 宿主）
 * =========================================
 *
 * ```
 * printf '%s' "$口令" | node dist/cli.js auth register --server <url> --email <邮箱> --terms
 * printf '%s' "$口令" | node dist/cli.js auth login    --server <url> --email <邮箱>
 * ```
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ## 为什么这个壳也必须有它
 *
 * 产品负责人的要求是「各个端都能完成全流程，包括所有的端」。此前 `node-host`
 * 的 `sync` 前置校验只接受**已经存在**的 `--token`（cli.ts），也就是说这一端
 * **只能消费凭据、不能生产凭据** —— 用户必须先在有界面的地方注册、拿到令牌，
 * 再回来粘贴。那不是"这一端能走完旅程"，而本仓库的验收恰恰是靠这一端
 * 当"第二台设备"的（`verify:p2` / `verify:multi-end`）。
 *
 * ## 🔴 四条不许违反的口径
 *
 *   1. **口令从 stdin 读，绝不从命令行参数读**（与 `cli-ai.ts` 的密钥同一条理由）：
 *      写在 argv 里的东西会出现在 `ps` 输出和 shell 历史里。多余的位置参数
 *      **明确拒绝**而不是忽略 —— 否则用户以为登录了，实际什么都没发。
 *   2. **没给 `--terms` 时一个请求都不发**：服务端在 `termsAccepted` 上用的是
 *      `z.literal(true)`，我们**不替用户发明同意**。在命令行上"发明"的形式
 *      就是默认勾上 —— 所以这里没有默认值，只有显式。
 *   3. **注册成功那句是中性的**：邮箱已属于已验证账号时服务端**故意**回同一句、
 *      同一个状态码（防枚举），所以这里不出现"账号已创建"。
 *   4. **登录口令与端到端加密口令是两个秘密**：`auth` 收的是前者（要发给服务端
 *      验 Argon2id），`sync --password` 收的是后者（设计上不该离开这台设备）。
 *      认证成功后必须把这一点**说出来** —— 否则"能登录、同步却解不开自己的数据"
 *      会以"这个功能坏了"的形式回来。
 *
 * ## 分层（AGENTS.md §3.5）
 *
 * 端点、请求体、失败归类、`termsAccepted` 的语义**全部**在 `@heyta/app-host` 的
 * `hosted-auth.ts`；这里只做参数解析、把结构化失败翻成终端文本、把令牌写进 stdout。
 * 判据（哪种失败说哪句话）**按 `code`/`policyCode` 而不是 `message` 字符串**分类。
 *
 * ⚠️ 句子**不接词条表**：终端输出本来就不是那三个外壳的本地化范围
 * （同 `cli.ts` 的 `describeSyncStatus` / `describeRestoreFailure`）。
 * 但策略那句里的**数字**取自 `@heyta/shared-schema` 的常量 —— 手打的阈值会在
 * 服务端改掉的那一天变成一句假话。
 */

import {
  loginWithEmailPassword,
  registerWithEmailPassword,
  type HostedAuthFailure,
  type HostedAuthFailureReason,
  type HostedAuthOptions,
} from '@heyta/app-host';
import { AUTH_PASSWORD_MAX_CODE_POINTS, AUTH_PASSWORD_MIN_CODE_POINTS } from '@heyta/shared-schema';

import { readSecretFromStdin } from './cli-ai.js';

export interface AuthCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface AuthCommandDeps {
  /** 网络实现，默认 `globalThis.fetch`。测试一律注入，绝不真发请求。 */
  fetchImpl?: typeof fetch;
  /** 环境变量来源，默认 `process.env`。 */
  env?: Readonly<Record<string, string | undefined>>;
}

const VALUE_OPTIONS = new Set(['server', 'email', 'invite']);
const BOOL_OPTIONS = new Set(['terms', 'json']);

const AUTH_USAGE =
  '用法：\n' +
  "  printf '%s' \"$口令\" | node dist/cli.js auth register --server <url> --email <邮箱> --terms [--invite <码>]\n" +
  "  printf '%s' \"$口令\" | node dist/cli.js auth login    --server <url> --email <邮箱>\n" +
  '\n' +
  '🔴 口令只从 stdin 读，不写在命令行上（那会留在 ps 输出与 shell 历史里）。\n';

interface ParsedAuthArgs {
  values: Record<string, string>;
  bools: Set<string>;
  positionals: string[];
}

/**
 * 只解析 `auth` 这一段自己的参数。
 *
 * 🔴 未知选项**报错而不是忽略**：`--term`（少打一个 s）被忽略的结局是
 * "同意项没勾 ⇒ 一个请求都不发"，而屏幕上说的是同意的事 ——
 * 那比崩掉难查得多。
 */
function parseAuthArgs(argv: readonly string[]): ParsedAuthArgs {
  const values: Record<string, string> = {};
  const bools = new Set<string>();
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
    if (BOOL_OPTIONS.has(name)) {
      if (eq >= 0) throw new Error(`--${name} 是开关，不接取值`);
      bools.add(name);
      continue;
    }
    if (VALUE_OPTIONS.has(name)) {
      if (eq >= 0) {
        values[name] = arg.slice(eq + 1);
      } else {
        const value = argv[i + 1];
        if (value === undefined) throw new Error(`--${name} 缺少取值`);
        values[name] = value;
        i += 1;
      }
      continue;
    }
    throw new Error(`未知参数 --${name}`);
  }

  return { values, bools, positionals };
}

/**
 * 失败原因 → 终端上那句话说的是**用户能做的动作**。
 *
 * 🔴 `Record<HostedAuthFailureReason, string>` 是**编译期**的穷尽检查：
 * 服务端以后加一条原因，这里不改就编不过 —— 而不是像词条表那样
 * 落进 `default` 分支、把新失败说成一句旧的假话。
 */
const REASON_TEXT: Record<HostedAuthFailureReason, string> = {
  unconfigured: '没有服务端地址 —— 一个字节都没发出去',
  'invalid-input': '服务端说这次输入不合法（比如邮箱格式）',
  'not-allowed': '这个实例不允许用这个邮箱注册',
  unauthorized: '令牌或链接无效、已过期 —— 重新发起一次',
  'rate-limited': '请求太频繁，过一会儿再试',
  'request-rejected': '服务端拒绝了这个请求',
  network: '连不上服务端（地址、DNS、证书或网络）',
  'server-error': '服务端出错了（5xx）',
  'malformed-response': '服务端回了 2xx 但内容不是预期形状 —— 这不算成功',
  'passkey-unsupported': '这台机器没有通行密钥能力，请求一个都没发 —— 改用口令或链接',
  'passkey-cancelled': '系统弹窗里取消了，再试一次就行',
  'passkey-already-registered': '这台设备已经有这个账号的通行密钥了 —— 改用「用通行密钥登录」',
  'passkey-not-found': '这条通行密钥服务端已经不认了 —— 重新注册或改用口令登录',
  'passkey-rejected': '这条通行密钥这次没验过 —— 再试一次',
  'last-passkey': '这是账号上最后一条通行密钥而且没有可用口令，删掉会被永久锁在门外',
  'passkey-name-too-long': '通行密钥的名字太长了',
  'invalid-credentials': '邮箱或口令不对（账号不存在 / 没设口令 / 口令错，这三者在服务端是同一句）',
  'email-not-verified': '口令是对的，但邮箱还没验证 —— 去收件箱点那封邮件',
  'password-locked': '口令这条路被临时锁住了，但魔法链接与通行密钥照旧能走',
  'password-backend-busy': '服务端现在忙不过来（这是它的问题，不是你发得太猛）',
  'invalid-reset-link': '重置链接查不到 / 已过期 / 已被用过 —— 重新申请一封',
  'no-password-set': '这个账号还没设过登录口令 —— 先走「设置登录密码」',
  'password-already-set': '这个账号已经有登录口令了 —— 该走「修改密码」',
  'password-policy': '新口令不满足这个实例的策略',
  'consent-required': '本机闸门把请求拦下了（还没同意联网，或选的是只用本机）',
};

/**
 * 策略的四种拒绝 → 各自的动作。
 *
 * 🔴 这四种在 HTTP 层**完全同形**（400 + `password_policy_violation`），
 * 只有 `policyCode` 能分开，而用户要做的四件事不同（加长 / 换短 / 换一句 /
 * 这句已经在泄露库里）。所以"不符合要求"而不带 `policyCode` 等于没说。
 *
 * ⚠️ 长度那两句的数字**从共享常量推导**，不手打。
 */
function policyText(policyCode: string | undefined): string | undefined {
  switch (policyCode) {
    case 'too_short':
      return `至少要 ${String(AUTH_PASSWORD_MIN_CODE_POINTS)} 个字符`;
    case 'too_long':
      return `最多只能有 ${String(AUTH_PASSWORD_MAX_CODE_POINTS)} 个字符`;
    case 'too_common':
      return '这句太常见，换一句别的话（长度够也不行）';
    case 'breached':
      return '这句已经在公开的泄露库里出现过了，换一个';
    default:
      // 服务端以后加了新 `policyCode`：落回那句统称，**不猜**一个可能错的动作。
      return undefined;
  }
}

function describeFailure(failure: HostedAuthFailure): string {
  const base = REASON_TEXT[failure.reason];
  const policy =
    failure.reason === 'password-policy' ? policyText(failure.policyCode) : undefined;
  const locked =
    failure.reason === 'password-locked' || failure.reason === 'password-backend-busy';
  const parts = [policy ?? base];
  if (locked && failure.retryAfterSeconds !== undefined) {
    // ⚠️ `undefined` 不等于 0：写成"再等 0 秒"是一句假话（服务端根本没给）。
    parts.push(`等 ${String(failure.retryAfterSeconds)} 秒后再试，或改走登录链接`);
  }
  // 机器码原样带上：终端上的这句话是给**人**看的，而这几个字段是给**排查的人**看的。
  const detail = [
    `reason=${failure.reason}`,
    failure.code === undefined ? undefined : `code=${failure.code}`,
    failure.policyCode === undefined ? undefined : `policyCode=${failure.policyCode}`,
    failure.status === undefined ? undefined : `status=${String(failure.status)}`,
    failure.retryAfterSeconds === undefined
      ? undefined
      : `retryAfterSeconds=${String(failure.retryAfterSeconds)}`,
  ].filter((x): x is string => x !== undefined);
  return `${parts.join('；')}（${detail.join(' ')}）`;
}

/**
 * @param argv `auth` **之后**的参数（子命令在第一个）。
 */
export async function runAuthCommand(
  argv: readonly string[],
  stdin: NodeJS.ReadableStream = process.stdin,
  deps: AuthCommandDeps = {},
): Promise<AuthCommandResult> {
  const env = deps.env ?? process.env;
  const fail = (stderr: string): AuthCommandResult => ({ code: 1, stdout: '', stderr });

  const [sub, ...rest] = argv;
  if (sub === undefined) return fail(AUTH_USAGE);
  if (sub !== 'register' && sub !== 'login') {
    return fail(`未知子命令「${sub}」。\n\n${AUTH_USAGE}`);
  }

  let parsed: ParsedAuthArgs;
  try {
    parsed = parseAuthArgs(rest);
  } catch (error) {
    return fail(`${error instanceof Error ? error.message : String(error)}\n\n${AUTH_USAGE}`);
  }

  // 🔴 位置参数一律拒绝：它唯一的用途就是把口令写在命令行上。
  if (parsed.positionals.length > 0) {
    return fail(
      '不要把口令写在命令行里 —— 那会让它出现在 ps 输出和 shell 历史里。\n' +
        "改用 stdin：printf '%s' \"$口令\" | node dist/cli.js auth " +
        sub +
        ' …\n',
    );
  }

  const json = parsed.bools.has('json');
  const serverUrl = parsed.values['server'] ?? env['HEYTA_SERVER_URL'];
  const email = parsed.values['email'] ?? env['HEYTA_EMAIL'];

  // 下面四条本地检查**全部**发生在任何请求之前。反过来的话，屏幕上说的
  // "缺 --email"就是一次枚举尝试**之后**才说的话。
  if (serverUrl === undefined || serverUrl === '') {
    return fail('缺 --server <url>（或 HEYTA_SERVER_URL）—— 一个请求都没发。\n');
  }
  if (email === undefined || email === '') {
    return fail('缺 --email <邮箱>（或 HEYTA_EMAIL）—— 一个请求都没发。\n');
  }
  if (sub === 'register' && !parsed.bools.has('terms')) {
    return fail(
      '注册要显式同意该服务端提供的服务条款与隐私政策：加 --terms。\n' +
        '我们不替你勾 —— 一个请求都没发。\n',
    );
  }

  const password = await readSecretFromStdin(stdin);
  if (password === '') {
    return fail('从 stdin 读到的是空口令，一个请求都没发。\n');
  }

  const options: HostedAuthOptions = { baseUrl: serverUrl };
  if (deps.fetchImpl !== undefined) options.fetchImpl = deps.fetchImpl;

  if (sub === 'register') {
    const result = await registerWithEmailPassword(options, {
      email,
      password,
      termsAccepted: true,
      ...(parsed.values['invite'] === undefined ? {} : { inviteCode: parsed.values['invite'] }),
    });
    if (!result.ok) {
      if (json) {
        // `result` 自己就带 `ok: false` 与全部机器码字段 —— 不再手写 `ok`，
        // 否则是同一份数据的两个来源（谁覆盖谁取决于键顺序）。
        return {
          code: 1,
          stdout: `${JSON.stringify({ ...result, command: 'auth', action: sub })}\n`,
          stderr: '',
        };
      }
      return fail(`❌ 注册未完成：${describeFailure(result)}\n`);
    }
    // 🔴 中性：不读 `result.message`，也不写"账号已创建"（规范 §2-A2）。
    // ⚠️ `verified` 是**假话**（这一步刚发出邮件），所以这里只有 `sent`。
    if (json) {
      return {
        code: 0,
        stdout: `${JSON.stringify({
          ok: true,
          command: 'auth',
          action: sub,
          email,
          tokenIssued: false,
        })}\n`,
        stderr: '',
      };
    }
    return {
      code: 0,
      stdout:
        '已受理。这一步不产出令牌，所以还没登录：去 ' +
        email +
        ' 的收件箱点那封验证邮件，然后再跑 auth login。\n' +
        '如果这个邮箱此前已经注册过，服务端也回同一句 —— 所以这句话不代表账号是刚建的。\n',
      stderr: '',
    };
  }

  const result = await loginWithEmailPassword(options, { email, password });
  if (!result.ok) {
    if (json) {
      return {
        code: 1,
        stdout: `${JSON.stringify({ ...result, command: 'auth', action: sub })}\n`,
        stderr: '',
      };
    }
    return fail(`❌ 登录未成功：${describeFailure(result)}\n`);
  }

  const { session } = result;
  if (json) {
    return {
      code: 0,
      stdout: `${JSON.stringify({
        ok: true,
        command: 'auth',
        action: sub,
        token: session.token,
        userId: session.user.id,
        email: session.user.email,
      })}\n`,
      stderr: '',
    };
  }
  return {
    code: 0,
    stdout:
      `已登录（${session.user.email}）。\n` +
      `令牌：${session.token}\n` +
      '⚠️ 令牌是凭据，它会留在终端与 shell 历史里；要喂给后续命令就用 auth login --json 管道出去，别复制粘贴。\n' +
      '🔴 这一步只是登录。同步还要另一个秘密（端到端加密口令），它不在这里：\n' +
      `  node dist/cli.js --db <路径> --server ${serverUrl} --token <上面那串> --password <加密口令> sync\n` +
      '没有加密口令时同步会明确失败，不会降级成明文上传。\n',
    stderr: '',
  };
}
