/**
 * `auth` 命令的判据
 * ===================
 *
 * 这一组用例里**承重**的是四条，其余是配套：
 *
 *   1. 🔴🔴 **每一个本地闸门都排在请求之前** —— 用 fetch 计数证明"一个字节都没发"。
 *      顺序反了的症状不是难看，是**没同意也发了一次注册尝试**、
 *      以及屏幕上那句"缺 --email"其实是在一次枚举尝试**之后**才说的话。
 *   2. 🔴 **注册那句是中性的**，而且不许把服务端的 `message` 原样印出来 ——
 *      邮箱已属于已验证账号时服务端**故意**回成功（防枚举），
 *      任何"账号已创建"都是假话。
 *   3. 🔴 **失败只按机器码分类**（`code` / `policyCode` / `Retry-After`），
 *      不按 `message` 字符串匹配；策略的四种拒绝必须给出**四种不同动作**；
 *      `retryAfterSeconds` 缺失时不许显示"再等 0 秒"。
 *   4. 🔴 **登录口令与端到端加密口令是两个秘密**：认证成功后必须把这一点说出来，
 *      而这一端**没有任何一行协议知识**（端点字符串都不许出现在这里）。
 *
 * ⚠️ 全部用注入的 fetch —— 真服务端那一腿在 `pnpm verify:email-password-chain`，
 *    拿真服务端跑单元测试会把"服务端怎么答"和"CLI 怎么说"两件事混成一条红。
 */

import { PassThrough } from 'node:stream';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { runAuthCommand } from '../src/cli-auth.js';
import { AUTH_PASSWORD_MAX_CODE_POINTS, AUTH_PASSWORD_MIN_CODE_POINTS } from '@heyta/shared-schema';

const SERVER = 'http://127.0.0.1:3199';
const EMAIL = 'you@example.cn';
const PASSWORD = 'correct horse battery staple';
const TOKEN = 'jwt.DEADBEEF';
/** 服务端给的**安全**文案：它是数据，不是可以印到终端上的话。 */
const SERVER_MESSAGE = 'SERVER-MESSAGE-MUST-NOT-PRINT';

function stdinOf(text: string): PassThrough {
  const stream = new PassThrough();
  stream.end(text);
  return stream;
}

interface Call {
  url: string;
  body: Record<string, unknown>;
}

/**
 * 假 fetch：记录每一次请求，返回给定的响应。
 *
 * `responses` 按调用次序取；用完还调就抛 —— 那会让"发了两次请求"
 * 变成一条响亮的红，而不是静默复用第一个响应。
 */
function fakeFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const calls: Call[] = [];
  const impl = (async (input: unknown, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: init?.body === undefined ? {} : (JSON.parse(String(init.body)) as Record<string, unknown>),
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

/** 注册/登录成功用的最小合法响应体。 */
const registerOk = { message: SERVER_MESSAGE };
const loginOk = { token: TOKEN, user: { id: 7, email: EMAIL } };

function authDeps(impl: typeof fetch) {
  return { fetchImpl: impl, env: {} as Record<string, string | undefined> };
}

const registerArgs = ['register', '--server', SERVER, '--email', EMAIL, '--terms'];
const loginArgs = ['login', '--server', SERVER, '--email', EMAIL];

describe('🔴🔴 每一道本地闸门都排在请求之前（用 fetch 计数证明）', () => {
  it('🔴 注册没给 --terms → **一个请求都不发**，并且说不替用户勾', async () => {
    const { impl, calls } = fakeFetch(200, registerOk);
    const result = await runAuthCommand(
      ['register', '--server', SERVER, '--email', EMAIL],
      stdinOf(PASSWORD),
      authDeps(impl),
    );
    expect(calls.length, `未勾同意也发出了 ${String(calls.length)} 次注册请求`).toBe(0);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/不替你勾|不替用户发明/);
    expect(result.stderr).toMatch(/一个请求都没发/);
  });

  it('🔴 缺 --server / 缺 --email → 各零次请求', async () => {
    for (const argv of [
      ['register', '--email', EMAIL, '--terms'],
      ['register', '--server', SERVER, '--terms'],
      ['login'],
      ['login', '--server', SERVER],
      ['login', '--email', EMAIL],
    ]) {
      const { impl, calls } = fakeFetch(200, loginOk);
      const result = await runAuthCommand(argv, stdinOf(PASSWORD), authDeps(impl));
      expect(calls.length, `${argv.join(' ')} 发出去了请求`).toBe(0);
      expect(result.code).toBe(1);
    }
  });

  it('🔴 stdin 读到空口令 → 零次请求（空串是一次没必要的往返）', async () => {
    const { impl, calls } = fakeFetch(200, registerOk);
    const result = await runAuthCommand(registerArgs, stdinOf(''), authDeps(impl));
    expect(calls.length).toBe(0);
    expect(result.stderr).toMatch(/空口令/);
  });

  it('🔴🔴 把口令写在命令行上（多余位置参数）→ 明确拒绝，零次请求，且不回显口令', async () => {
    const { impl, calls } = fakeFetch(200, loginOk);
    const result = await runAuthCommand([...loginArgs, PASSWORD], stdinOf(''), authDeps(impl));
    expect(calls.length).toBe(0);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/不要把口令写在命令行里/);
    // 拒绝本身不许把口令抄回屏幕（那等于把秘密写进终端与可能的日志）。
    expect(result.stderr).not.toContain(PASSWORD);
  });

  it('未知选项响亮报错，而不是被当成"没给"（--term 少一个 s 不能静默变成没同意）', async () => {
    const { impl, calls } = fakeFetch(200, registerOk);
    const result = await runAuthCommand(
      ['register', '--server', SERVER, '--email', EMAIL, '--term'],
      stdinOf(PASSWORD),
      authDeps(impl),
    );
    expect(calls.length).toBe(0);
    expect(result.stderr).toMatch(/未知参数 --term/);
  });

  it('未知子命令也不发请求', async () => {
    const { impl, calls } = fakeFetch(200, loginOk);
    const result = await runAuthCommand(['logout'], stdinOf(PASSWORD), authDeps(impl));
    expect(calls.length).toBe(0);
    expect(result.code).toBe(1);
  });
});

describe('🔴 注册那句是中性的（规范 §2-A2：假成功与真成功在服务端同形）', () => {
  it('成功句**不出现**"账号已创建 / 注册成功"，并明说这一步不产出令牌', async () => {
    const { impl, calls } = fakeFetch(200, registerOk);
    const result = await runAuthCommand(registerArgs, stdinOf(PASSWORD), authDeps(impl));
    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toContain('/register/email-password');
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/不产出令牌|还没登录/);
    expect(result.stdout).toMatch(/收件箱|验证邮件/);
    expect(result.stdout).not.toMatch(/账号已创建|注册成功/);
    // 🔴 不读服务端的 message：它本身中性，但"印服务端的话"这个习惯一旦形成，
    // 下一个改动服务端文案的人就会把一句假话带进来。
    expect(result.stdout).not.toContain(SERVER_MESSAGE);
  });

  it('请求体带 termsAccepted:true 与 inviteCode（给了才带），口令原样', async () => {
    const { impl, calls } = fakeFetch(200, registerOk);
    await runAuthCommand(
      ['register', '--server', SERVER, '--email', EMAIL, '--terms', '--invite', 'FRIEND5'],
      stdinOf('p@ss word '),
      authDeps(impl),
    );
    const body = calls[0]!.body;
    expect(body).toMatchObject({ email: EMAIL, password: 'p@ss word ', termsAccepted: true });
    expect(body['inviteCode']).toBe('FRIEND5');
  });

  it('没给 --invite 时请求体里**没有**这个键（空串不是"不带"）', async () => {
    const { impl, calls } = fakeFetch(200, registerOk);
    await runAuthCommand(registerArgs, stdinOf(PASSWORD), authDeps(impl));
    expect('inviteCode' in calls[0]!.body).toBe(false);
  });

  it('JSON 模式：成功但 `tokenIssued` 是 false', async () => {
    const { impl } = fakeFetch(200, registerOk);
    const result = await runAuthCommand(
      [...registerArgs, '--json'],
      stdinOf(PASSWORD),
      authDeps(impl),
    );
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(parsed['ok']).toBe(true);
    expect(parsed['tokenIssued']).toBe(false);
    expect(result.stdout).not.toContain(SERVER_MESSAGE);
  });
});

describe('🔴 登录产出令牌，并把"这是两个秘密"说出来（规范 §3.2 第 ④ 步）', () => {
  it('成功打印令牌，并明说同步还要**另一个**口令', async () => {
    const { impl, calls } = fakeFetch(200, loginOk);
    const result = await runAuthCommand(loginArgs, stdinOf(PASSWORD), authDeps(impl));
    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toContain('/login/email-password');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(TOKEN);
    // 这条不是文案偏好：登录成功 ≠ 同步可用。少了这句，用户会拿**登录口令**去填
    // --password，症状是"能登录、同步却解不开自己的数据"。
    expect(result.stdout).toMatch(/--password/);
    expect(result.stdout).toMatch(/不是|另一个/);
  });

  it('登录请求体只有 email 与 password —— 口令不做任何归一化', async () => {
    const { impl, calls } = fakeFetch(200, loginOk);
    // 结尾换行是管道带进来的（去一个），**中间和开头的空格是口令的一部分**。
    await runAuthCommand(loginArgs, stdinOf(' 双 密 码\n'), authDeps(impl));
    expect(calls[0]!.body).toEqual({ email: EMAIL, password: ' 双 密 码' });
  });

  it('JSON 模式给出 token / userId / email，供脚本直接接 `--token`', async () => {
    const { impl } = fakeFetch(200, loginOk);
    const result = await runAuthCommand([...loginArgs, '--json'], stdinOf(PASSWORD), authDeps(impl));
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      command: 'auth',
      action: 'login',
      token: TOKEN,
      userId: 7,
      email: EMAIL,
    });
  });

  it('🔴 2xx 但没有令牌 ⇒ 判 `malformed-response`，**不算成功**、不打印空令牌', async () => {
    const { impl } = fakeFetch(200, { user: { id: 7, email: EMAIL } });
    const result = await runAuthCommand([...loginArgs, '--json'], stdinOf(PASSWORD), authDeps(impl));
    expect(result.code).toBe(1);
    const parsed = JSON.parse(result.stdout) as { ok: boolean; reason: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toBe('malformed-response');
    expect(result.stdout).not.toContain('"token"');
  });
});

describe('🔴 失败只按机器码分类，句子给出可执行的动作', () => {
  /** 断言输出里既没有服务端 message 原文，也没有把失败说成成功。 */
  function expectClassified(stdout: string, stderr: string): void {
    const text = `${stdout}${stderr}`;
    expect(text).not.toContain(SERVER_MESSAGE);
    expect(text).not.toMatch(/已登录|登录成功|注册成功|账号已创建/);
  }

  it('401 + invalid_credentials ⇒ "邮箱或口令不对"，而且**不区分**三种情况', async () => {
    const { impl } = fakeFetch(
      401,
      { code: 'invalid_credentials', error: SERVER_MESSAGE },
      {},
    );
    const result = await runAuthCommand(loginArgs, stdinOf(PASSWORD), authDeps(impl));
    expectClassified(result.stdout, result.stderr);
    expect(result.stderr).toContain('invalid_credentials');
    expect(result.stderr).toMatch(/邮箱或口令不对/);
    // 这三种在服务端就是同一个码同一句话。终端上必须说清"三者不可区分"，
    // 而不是挑一个说 —— 挑一个说的那句话就是邮箱枚举器的输出。
    expect(result.stderr).toMatch(/三者.*同一句/);
  });

  it('🔴 策略的四种拒绝给出**四种不同动作**（同码同类，动作不同）', async () => {
    const texts: string[] = [];
    for (const policyCode of ['too_short', 'too_long', 'too_common', 'breached']) {
      const { impl } = fakeFetch(
        400,
        { code: 'password_policy_violation', policyCode, error: SERVER_MESSAGE },
        {},
      );
      const result = await runAuthCommand(
        [...registerArgs, '--json'],
        stdinOf(PASSWORD),
        authDeps(impl),
      );
      expect(result.code).toBe(1);
      const parsed = JSON.parse(result.stdout) as { reason: string; policyCode: string };
      expect(parsed.reason).toBe('password-policy');
      expect(parsed.policyCode).toBe(policyCode);
      const human = await runAuthCommand(
        registerArgs,
        stdinOf(PASSWORD),
        authDeps(fakeFetch(400, { code: 'password_policy_violation', policyCode, error: SERVER_MESSAGE }).impl),
      );
      texts.push(human.stderr);
      expectClassified('', human.stderr);
    }
    expect(new Set(texts).size, '四种策略拒绝在终端上说的是同一句话').toBe(4);
    // 数字从共享常量推导，不手打 —— 服务端改掉的那天，手打的数字会变成假话。
    expect(texts[0]).toContain(String(AUTH_PASSWORD_MIN_CODE_POINTS));
    expect(texts[1]).toContain(String(AUTH_PASSWORD_MAX_CODE_POINTS));
  });

  it('`policyCode` 缺失或不认识 ⇒ 落回那句统称，**不猜**一个可能错的动作', async () => {
    for (const body of [
      { code: 'password_policy_violation' },
      { code: 'password_policy_violation', policyCode: 'made_up_by_server' },
    ]) {
      const { impl } = fakeFetch(400, body, {});
      const result = await runAuthCommand(registerArgs, stdinOf(PASSWORD), authDeps(impl));
      expect(result.stderr).toMatch(/策略/);
      expect(result.stderr).not.toMatch(/至少要|最多只能|太常见|泄露库/);
    }
  });

  it('🔴 口令被锁：有 Retry-After 就说秒数并给**换路**出口', async () => {
    const { impl } = fakeFetch(
      429,
      { code: 'account_locked', error: SERVER_MESSAGE },
      { 'retry-after': '42' },
    );
    const result = await runAuthCommand(loginArgs, stdinOf(PASSWORD), authDeps(impl));
    expect(result.stderr).toMatch(/等 42 秒/);
    // 锁的只是"这个账号的口令这一种认证器"，链接与通行密钥照旧能走。
    expect(result.stderr).toMatch(/链接|通行密钥/);
    expect(result.stderr).toContain('account_locked');
  });

  it('🔴 口令被锁但**没有** Retry-After ⇒ 不许显示"再等 0 秒"', async () => {
    const { impl } = fakeFetch(429, { code: 'account_locked', error: SERVER_MESSAGE }, {});
    const result = await runAuthCommand(loginArgs, stdinOf(PASSWORD), authDeps(impl));
    expect(result.stderr).not.toMatch(/等\s*\d+\s*秒|等 undefined 秒|等 NaN 秒/);
    expect(result.stderr).not.toContain('retryAfterSeconds');
  });

  it('邮箱没验证 ⇒ 说清"口令是对的"，否则用户会反复重打同一句正确口令', async () => {
    const { impl } = fakeFetch(403, { code: 'email_not_verified', error: SERVER_MESSAGE }, {});
    const result = await runAuthCommand(loginArgs, stdinOf(PASSWORD), authDeps(impl));
    expect(result.stderr).toMatch(/口令是对的/);
    expect(result.stderr).toMatch(/收件箱|验证邮件/);
  });

  it('连不上服务端 ⇒ 归成 network，而不是把抛错原样抛出去', async () => {
    const impl = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const result = await runAuthCommand(loginArgs, stdinOf(PASSWORD), authDeps(impl));
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/连不上服务端/);
    expect(result.stderr).toContain('reason=network');
  });

  it('JSON 模式把机器码全部原样交出（终端那句话是给人的，这几个字段是给排查的人的）', async () => {
    const { impl } = fakeFetch(
      400,
      { code: 'password_policy_violation', policyCode: 'too_short', error: SERVER_MESSAGE },
      {},
    );
    const result = await runAuthCommand(
      [...registerArgs, '--json'],
      stdinOf(PASSWORD),
      authDeps(impl),
    );
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      command: 'auth',
      action: 'register',
      reason: 'password-policy',
      code: 'password_policy_violation',
      policyCode: 'too_short',
      status: 400,
    });
  });
});

describe('🟡 服务端地址与邮箱可以从环境变量来（脚本用法）', () => {
  it('HEYTA_SERVER_URL + HEYTA_EMAIL 齐了就不用再打参数', async () => {
    const { impl, calls } = fakeFetch(200, loginOk);
    const result = await runAuthCommand(['login'], stdinOf(PASSWORD), {
      fetchImpl: impl,
      env: { HEYTA_SERVER_URL: SERVER, HEYTA_EMAIL: EMAIL },
    });
    expect(calls.length).toBe(1);
    expect(result.code).toBe(0);
  });
});

/**
 * 源码级判据（同 `apps/mobile/tests/auth-screen-password.spec.ts` 的做法）：
 * 这三条都不是"输出对不对"，而是**结构**对不对 —— 结构错了改输出测不出来。
 */
describe('🔴 分层与顺序（AGENTS.md §3.5）', () => {
  const cli = readFileSync(new URL('../src/cli.ts', import.meta.url), 'utf8');
  const cliAuth = readFileSync(new URL('../src/cli-auth.ts', import.meta.url), 'utf8');

  it('🔴 `auth` 的分派排在 **`--db` 检查之前** —— 注册/登录不碰本地库', () => {
    const authBranch = cli.indexOf('runAuthCommand(authArgv)');
    const dbCheck = cli.indexOf("throw new Error('缺少 --db");
    expect(authBranch).toBeGreaterThan(-1);
    expect(dbCheck).toBeGreaterThan(-1);
    expect(authBranch < dbCheck, 'auth 被要求先给一个 SQLite 路径才能注册').toBe(true);
  });

  it('🔴 本壳**没有一行协议知识**：端点、请求体字段、状态码归类都不在这里', () => {
    // 端点字符串只在 `@heyta/app-host` 的 `hosted-auth.ts` 里有一份。
    expect(cliAuth).not.toMatch(/email-password|\/api\/register|\/api\/login/);
    // 状态码 → 原因的归类也在 app-host（`classifyFailure`）。
    expect(cliAuth).not.toMatch(/status\s*===?\s*4\d\d|401|403|409|429|503/);
    // 同意项的语义（`z.literal(true)`）由服务端裁决，这里只决定**发不发**。
    expect(cliAuth).toMatch(/termsAccepted: true/);
  });

  it('🔴 帮助文本列出了这两条命令（少一行的代价是别人选错判据）', () => {
    expect(cli).toMatch(/auth register --server/);
    expect(cli).toMatch(/auth login --server/);
    // 而且必须说清口令从 stdin 来 —— 否则下一个人会加一个 `--login-password`。
    expect(cli).toMatch(/stdin/);
  });
});
