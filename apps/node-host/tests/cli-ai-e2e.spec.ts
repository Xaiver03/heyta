/**
 * AI 密钥命令的真实子进程端到端测试
 * ====================================
 *
 * 单元测试用假存储，证明的是"逻辑对"。
 * 这里真的 spawn `dist/cli-ai.js`，真的往**临时钥匙串**写，
 * 再**用 `security` 独立查一次** —— 证明的不是"我们的 get 说存了"，
 * 而是"钥匙串里真的有"。
 *
 * ⚠️ 全程 `HEYTA_KEYCHAIN_PATH` 指向临时钥匙串，**绝不碰登录钥匙串**。
 * 有用例在跑完后复查登录钥匙串（见最后一个 describe）。
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const CLI = join(HERE, '..', 'dist', 'cli-ai.js');
const SECURITY = '/usr/bin/security';
const LOGIN = `${process.env['HOME'] ?? ''}/Library/Keychains/login.keychain-db`;

const onMac = process.platform === 'darwin';
const built = existsSync(CLI);
const describeE2e = onMac && built ? describe : describe.skip;

let keychainPath: string;

function makeKeychain(): string {
  const path = join(tmpdir(), `heyta-cli-ai-${String(process.pid)}-${String(Date.now())}.keychain`);
  execFileSync(SECURITY, ['create-keychain', '-p', 'pw', path], { stdio: 'ignore' });
  return path;
}

function destroyKeychain(path: string): void {
  try {
    execFileSync(SECURITY, ['delete-keychain', path], { stdio: 'ignore' });
  } catch {
    /* 已没了 */
  }
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      /* 同上 */
    }
  }
}

/** 数一数登录钥匙串里有几条 heyta 记录 —— 用来证明我们**没**污染它。 */
function loginKeychainHeytaCount(): number {
  try {
    const dump = execFileSync(SECURITY, ['dump-keychain', LOGIN], { encoding: 'utf8' });
    return (dump.match(/"svce"<blob>="heyta/g) ?? []).length;
  } catch {
    return 0;
  }
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** 真的 spawn 一次 CLI。 */
function runCli(
  args: readonly string[],
  stdin = '',
  env: Record<string, string> = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...(process.env as Record<string, string>), ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => {
      stdout += c.toString('utf8');
    });
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString('utf8');
    });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

/** 独立查一次钥匙串（第二事实源）。 */
function readDirect(account: string, kc: string): string | undefined {
  try {
    return execFileSync(SECURITY, ['find-generic-password', '-s', 'heyta.ai', '-a', account, '-w', kc], {
      encoding: 'utf8',
    }).replace(/\n$/, '');
  } catch {
    return undefined;
  }
}

beforeEach(() => {
  if (!onMac || !built) return;
  keychainPath = makeKeychain();
});

afterEach(() => {
  if (!onMac || !built) return;
  destroyKeychain(keychainPath);
});

const env = (): Record<string, string> => ({ HEYTA_KEYCHAIN_PATH: keychainPath });

describeE2e('🔴 真实子进程 + 真实钥匙串', () => {
  it('🔴🔴 密钥真的进了钥匙串（用 security 独立确认）', async () => {
    const secret = 'sk-e2e-real-1';
    const result = await runCli(['key', 'set', 'e1'], secret, env());

    expect(result.code).toBe(0);
    // 🔴 第二事实源：不是"我们的 get 说存了"，是钥匙串里真的有
    expect(readDirect('e1', keychainPath)).toBe(secret);
  });

  it('🔴 输出里不出现密钥，只报长度', async () => {
    const secret = 'sk-e2e-real-2';
    const result = await runCli(['key', 'set', 'e2'], secret, env());
    expect(result.stdout).not.toContain(secret);
    expect(result.stderr).not.toContain(secret);
    expect(result.stdout).toContain(String(secret.length));
  });

  it('🔴🔴 把密钥写在命令行里会被拒绝，且**什么都没写进去**', async () => {
    const secret = 'sk-should-not-be-stored';
    const result = await runCli(['key', 'set', 'e3', secret], '', env());

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('stdin');
    expect(result.stderr).toContain('ps');
    // 🔴 拒绝要彻底 —— 不能"先存了再说"
    expect(readDirect('e3', keychainPath)).toBeUndefined();
  });

  it('🔴 拒绝信息里不回显那个密钥', async () => {
    const secret = 'sk-must-not-echo';
    const result = await runCli(['key', 'set', 'e4', secret], '', env());
    expect(result.stderr).not.toContain(secret);
    expect(result.stdout).not.toContain(secret);
  });

  it('🔴 clear 之后真的没了', async () => {
    await runCli(['key', 'set', 'e5'], 'sk-to-delete', env());
    expect(readDirect('e5', keychainPath)).toBe('sk-to-delete');

    await runCli(['key', 'clear', 'e5'], '', env());
    expect(readDirect('e5', keychainPath)).toBeUndefined();
  });

  it('🔴 重复 set 是更新，不是报错', async () => {
    await runCli(['key', 'set', 'e6'], 'first', env());
    const second = await runCli(['key', 'set', 'e6'], 'second', env());
    expect(second.code).toBe(0);
    expect(readDirect('e6', keychainPath)).toBe('second');
  });

  it('🔴 含空格与特殊字符的密钥原样往返', async () => {
    const tricky = `a b'c\\d"e`;
    await runCli(['key', 'set', 'e7'], tricky, env());
    expect(readDirect('e7', keychainPath)).toBe(tricky);
  });

  it('空 stdin → 失败，且没写进去', async () => {
    const result = await runCli(['key', 'set', 'e8'], '', env());
    expect(result.code).toBe(1);
    expect(readDirect('e8', keychainPath)).toBeUndefined();
  });

  it('`key` 前缀可省（两种写法都行）', async () => {
    const result = await runCli(['set', 'e9'], 'sk-no-prefix', env());
    expect(result.code).toBe(0);
    expect(readDirect('e9', keychainPath)).toBe('sk-no-prefix');
  });
});

describeE2e('🔴🔴 绝不污染用户的登录钥匙串', () => {
  it('🔴🔴 一整套操作跑完，登录钥匙串里的 heyta 记录数不变', async () => {
    const before = loginKeychainHeytaCount();

    await runCli(['key', 'set', 'p1'], 'sk-x', env());
    await runCli(['key', 'set', 'p1', 'sk-in-argv'], '', env());
    await runCli(['key', 'list'], '', env());
    await runCli(['key', 'clear', 'p1'], '', env());
    await runCli(['nonsense'], '', env());

    expect(loginKeychainHeytaCount()).toBe(before);
  });
});
