/**
 * 本机 API 配置命令的测试
 * ==========================
 *
 * 🔴 四条承重断言：
 *   1. 文件权限必须是 0600
 *   2. `show` **永远**打码 token
 *   3. 已存在时**不覆盖**（覆盖会换 token，已配好的客户端会失效）
 *   4. `bindAddress` **只能**是回环，不接受任何外部输入
 *
 * ⚠️ 全程用临时目录，绝不碰用户真实的 `~/.heyta/`。
 */

import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { maskToken, runLocalApiCommand, type LocalApiCommandDeps } from '../src/cli-local-api.js';

const FIXED_TOKEN = 'TESTTOKEN_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345';

let dir: string;
let configPath: string;

const deps = (over: Partial<LocalApiCommandDeps> = {}): LocalApiCommandDeps => ({
  configPath,
  generateToken: () => FIXED_TOKEN,
  ...over,
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'heyta-local-api-'));
  configPath = join(dir, 'local-api.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('🔴 init 写出服务能读的配置', () => {
  it('🔴🔴 文件权限是 0600', () => {
    const result = runLocalApiCommand(['init'], deps());
    expect(result.code).toBe(0);
    const mode = statSync(configPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('🔴 写出来的就是 MCP 服务读的那份（形状对得上）', () => {
    runLocalApiCommand(['init'], deps());
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    expect(config['enabled']).toBe(true);
    expect(config['bindAddress']).toBe('127.0.0.1');
    expect(typeof config['port']).toBe('number');
    expect(config['token']).toBe(FIXED_TOKEN);
    expect(config['grants']).toEqual({ list_tasks: true });
  });

  it('🔴 默认只开一个只读工具（打开就是全开是最糟的默认值）', () => {
    runLocalApiCommand(['init'], deps());
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      grants: Record<string, boolean>;
    };
    expect(Object.keys(config.grants)).toEqual(['list_tasks']);
  });

  it('🔴 --tools 能指定授权哪些工具', () => {
    runLocalApiCommand(['init', '--tools', 'list_tasks,get_task'], deps());
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      grants: Record<string, boolean>;
    };
    expect(Object.keys(config.grants).sort()).toEqual(['get_task', 'list_tasks']);
  });

  it('🔴 不认识的工具名要拒绝，且**什么都不写**', () => {
    const result = runLocalApiCommand(['init', '--tools', 'no_such_tool'], deps());
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('no_such_tool');
    expect(() => statSync(configPath)).toThrow();
  });

  it('🔴 token 只显示一次（init 输出里有），并给出客户端配置片段', () => {
    const result = runLocalApiCommand(['init'], deps());
    expect(result.stdout).toContain(FIXED_TOKEN);
    expect(result.stdout).toContain('只显示这一次');
    // token 走 env，不写进命令行
    expect(result.stdout).toContain('HEYTA_LOCAL_API_TOKEN');
  });
});

describe('🔴🔴 不覆盖已存在的配置', () => {
  it('🔴🔴 第二次 init 拒绝执行（覆盖会换 token，客户端立刻失效）', () => {
    runLocalApiCommand(['init'], deps());
    const result = runLocalApiCommand(['init'], deps({ generateToken: () => 'ANOTHER_TOKEN_value' }));
    expect(result.code).toBe(1);
    // 原文件没被动过
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as { token: string };
    expect(config.token).toBe(FIXED_TOKEN);
  });

  it('🔴 拒绝信息里说明了为什么，并给出 --force', () => {
    runLocalApiCommand(['init'], deps());
    const result = runLocalApiCommand(['init'], deps());
    expect(result.stderr).toContain('--force');
    expect(result.stderr).toContain('token');
  });

  it('🔴 --force 才允许覆盖', () => {
    runLocalApiCommand(['init'], deps());
    const result = runLocalApiCommand(['init', '--force'], deps({ generateToken: () => 'NEW_TOKEN_value_123456' }));
    expect(result.code).toBe(0);
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as { token: string };
    expect(config.token).toBe('NEW_TOKEN_value_123456');
  });

  it('🔴 覆盖之后权限**仍然**是 0600（mode 只在创建时生效）', () => {
    runLocalApiCommand(['init'], deps());
    runLocalApiCommand(['init', '--force'], deps());
    expect(statSync(configPath).mode & 0o777).toBe(0o600);
  });
});

describe('🔴🔴 show 永远不泄漏 token', () => {
  it('🔴🔴 打码，不打全文', () => {
    runLocalApiCommand(['init'], deps());
    const result = runLocalApiCommand(['show'], deps());
    expect(result.stdout).not.toContain(FIXED_TOKEN);
    expect(result.stdout).toContain(maskToken(FIXED_TOKEN));
  });

  it('🔴 maskToken 不泄漏中间内容', () => {
    const masked = maskToken(FIXED_TOKEN);
    expect(masked).not.toBe(FIXED_TOKEN);
    expect(masked).toContain('…');
    // 中间那段绝不能被包含
    expect(masked).not.toContain(FIXED_TOKEN.slice(6, 20));
  });

  it('🔴 很短的 token 直接全打码（不能靠"留头留尾"泄漏掉）', () => {
    expect(maskToken('short')).toBe('****');
  });

  it('🔴 show 会说明哪些工具被授权了', () => {
    runLocalApiCommand(['init', '--tools', 'list_tasks,get_task'], deps());
    const result = runLocalApiCommand(['show'], deps());
    expect(result.stdout).toContain('list_tasks');
    expect(result.stdout).toContain('get_task');
  });

  it('🔴 没有配置时 show 不报错，只提示', () => {
    const result = runLocalApiCommand(['show'], deps());
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('init');
  });
});

describe('🔴🔴 监听地址不接受任何外部输入', () => {
  it('🔴🔴 多传了地址参数也**不会**被采纳', () => {
    runLocalApiCommand(['init', '0.0.0.0'], deps());
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as { bindAddress: string };
    // 暴露到局域网 = 把用户全部任务给同一个网络里的所有人
    expect(config.bindAddress).toBe('127.0.0.1');
  });
});

describe('off', () => {
  it('🔴 关掉开关但保留 token 与授权（不用重配客户端）', () => {
    runLocalApiCommand(['init'], deps());
    const result = runLocalApiCommand(['off'], deps());
    expect(result.code).toBe(0);

    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      enabled: boolean;
      token: string;
      grants: Record<string, boolean>;
    };
    expect(config.enabled).toBe(false);
    expect(config.token).toBe(FIXED_TOKEN);
    expect(config.grants).toEqual({ list_tasks: true });
  });

  it('没有配置时 off 报错', () => {
    expect(runLocalApiCommand(['off'], deps()).code).toBe(1);
  });
});

describe('坏输入不炸', () => {
  it('🔴 配置文件是坏 JSON 时 show 不抛错', () => {
    writeFileSync(configPath, '{ this is not json', 'utf8');
    const result = runLocalApiCommand(['show'], deps());
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('init');
  });

  it('🔴 没有子命令时打印用法', () => {
    const result = runLocalApiCommand([], deps());
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('init');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 🔴🔴 端到端：`init` 写出来的文件，**真实的 MCP 服务**必须能读并跑起来。
//
// 这正是本轮要修的洞：界面能配、服务读不到，中间没人写那个文件。
// 只测"文件写对了"是不够的 —— 要证明**服务真的吃它**。

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const MCP_CLI = join(HERE, '..', 'dist', 'cli-mcp.js');
const built = existsSync(MCP_CLI);

/** 真的 spawn MCP 服务，喂两条请求，收 stdout。 */
function speakToMcp(configPath: string, token: string, dbPath: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [MCP_CLI], {
      env: {
        ...(process.env as Record<string, string>),
        HEYTA_LOCAL_API_CONFIG: configPath,
        HEYTA_LOCAL_API_TOKEN: token,
        HEYTA_DB_PATH: dbPath,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (c: Buffer) => {
      out += c.toString('utf8');
    });
    child.on('close', () => resolve(out));
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
    child.stdin.end();
  });
}

const describeE2e = built ? describe : describe.skip;

describeE2e('🔴🔴 端到端：CLI 写的配置，真实 MCP 服务能读', () => {
  it('🔴🔴 init 之后服务起得来，并列出**已授权**的工具', async () => {
    runLocalApiCommand(['init'], deps());
    const out = await speakToMcp(configPath, FIXED_TOKEN, join(dir, 'heyta.db'));

    const lines = out.split('\n').filter((l) => l.trim() !== '');
    expect(lines.length).toBeGreaterThanOrEqual(2);

    const init = JSON.parse(lines[0]!) as { result?: { serverInfo?: { name: string } } };
    expect(init.result?.serverInfo?.name).toBe('heyta');

    const listed = JSON.parse(lines[1]!) as { result?: { tools: readonly { name: string }[] } };
    // 🔴 默认只授权 list_tasks —— 别的工具必须**看不见**
    expect(listed.result?.tools.map((t) => t.name)).toEqual(['list_tasks']);
  });

  it('🔴🔴 换了 token 的请求会被拒（证明 token 真的生效）', async () => {
    runLocalApiCommand(['init'], deps());
    const out = await speakToMcp(configPath, 'WRONG_TOKEN_entirely', join(dir, 'heyta.db'));
    expect(out).toContain('error');
    expect(out).not.toContain('serverInfo');
  });

  it('🔴 enabled:false 时服务拒绝启动（stderr 报错、无 stdout）', async () => {
    runLocalApiCommand(['init'], deps());
    runLocalApiCommand(['off'], deps());
    const out = await speakToMcp(configPath, FIXED_TOKEN, join(dir, 'heyta.db'));
    expect(out.trim()).toBe('');
  });

  it('🔴 --tools 指定的工具列得出来（配置真的传到服务了）', async () => {
    runLocalApiCommand(['init', '--tools', 'list_tasks,get_task'], deps());
    const out = await speakToMcp(configPath, FIXED_TOKEN, join(dir, 'heyta.db'));
    const lines = out.split('\n').filter((l) => l.trim() !== '');
    const listed = JSON.parse(lines[1]!) as { result?: { tools: readonly { name: string }[] } };
    expect(listed.result?.tools.map((t) => t.name).sort()).toEqual(['get_task', 'list_tasks']);
  });
});
