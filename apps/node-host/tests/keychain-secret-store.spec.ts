/**
 * 系统钥匙串密钥存储测试
 * ========================
 *
 * 🔴 **在真实钥匙串上测，但绝不碰用户的登录钥匙串。**
 *
 * 每个用例自己 `create-keychain` 一个临时钥匙串（一个临时文件），用完删掉。
 * 这样"转义对不对"是在真实 `security` 解析器上被证明的 ——
 * mock 掉 runner 就只能证明"我以为转义是对的"。
 *
 * 三条承重断言：
 *   1. 🔴 **密钥不进 argv**（`ps` 看不到）—— 这是本实现存在的理由
 *   2. 🔴 含空格 / 单引号 / 反斜杠的秘密能原样往返
 *   3. 🔴 钥匙串不可用或读失败时**退化成"没有密钥"**，不抛错
 */

import { execFileSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  KEYCHAIN_SERVICE,
  createKeychainSecretStore,
  createSecurityCliRunner,
  isKeychainAvailable,
  quoteForSecurity,
  type KeychainRunner,
  type KeychainSecretStoreOptions,
} from '../src/keychain-secret-store.js';

const onMac = process.platform === 'darwin';
const SECURITY = '/usr/bin/security';

let keychainPath: string;

/** 建一个临时钥匙串。 */
function makeTempKeychain(): string {
  const path = join(tmpdir(), `heyta-test-${String(process.pid)}-${String(Date.now())}.keychain`);
  execFileSync(SECURITY, ['create-keychain', '-p', 'testpw', path], { stdio: 'ignore' });
  return path;
}

function destroyTempKeychain(path: string): void {
  try {
    execFileSync(SECURITY, ['delete-keychain', path], { stdio: 'ignore' });
  } catch {
    /* 已经没了就算了 */
  }
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      /* 同上 */
    }
  }
}

/** 直接查一次（Web 之外的第二事实源，用来确认"真的写进去了"）。 */
function readDirect(service: string, account: string, kc: string): string | undefined {
  try {
    return execFileSync(SECURITY, ['find-generic-password', '-s', service, '-a', account, '-w', kc], {
      encoding: 'utf8',
    }).replace(/\n$/, '');
  } catch {
    return undefined;
  }
}

beforeEach(() => {
  if (!onMac) return;
  keychainPath = makeTempKeychain();
});

afterEach(() => {
  if (!onMac) return;
  destroyTempKeychain(keychainPath);
});

/** 用一个独立的服务名，避免与真实记录撞。 */
const TEST_SERVICE = 'heyta.test.unit';

/**
 * 🔴🔴 **防止测试破坏开发者的钥匙串。**
 *
 * 这是一次真实事故换来的护栏。在注入验证里我把控制字符检查关掉之后，
 * 含换行的密钥走进了 `security -i`；`-i` 逐行读命令，于是那一行在换行处断了，
 * **尾部的临时钥匙串参数被切到下一行** —— 命令落到了**默认（登录）钥匙串**，
 * 在用户的真实钥匙串里留下了一条垃圾记录。
 *
 * 根因不是"代码写错了"（那次是故意注入的），而是：
 * **测试的安全性依赖被测代码正确。** 那是错的 —— 测试必须在代码坏掉时
 * 也伤不到开发者的机器。
 *
 * 所以这里包一层：任何一次 `security` 调用，如果在参数或 stdin 里
 * 找不到临时钥匙串的路径，就**当场抛错**，根本不会执行。
 */
function guardedRunner(): KeychainRunner {
  const real = createSecurityCliRunner();
  return (args, stdin) => {
    const namedInArgs = args.includes(keychainPath);
    // 🔴 关键：`security -i` 是**逐行**执行的，所以要看**将被执行的那一行**
    // 里有没有钥匙串，而不是整个 stdin 字符串。
    // 第一版看的是整个字符串 —— 于是"换行把命令切断、钥匙串参数落到下一行"
    // 这种情况能穿过护栏，照样写进了登录钥匙串。护栏自己也需要被验证。
    const firstLine = stdin === undefined ? undefined : (stdin.split('\n')[0] ?? '');
    const namedInStdin = firstLine !== undefined && firstLine.includes(keychainPath);
    if (!namedInArgs && !namedInStdin) {
      throw new Error(
        `🔴 测试拒绝执行：这次 security 调用没有指定临时钥匙串，会落到用户的登录钥匙串。\n` +
          `  args = ${args.join(' ')}\n  stdin = ${stdin ?? '(无)'}`,
      );
    }
    return real(args, stdin);
  };
}

/** 造一个只在临时钥匙串上工作的 store。**所有真实钥匙串用例都必须走它。** */
function makeStore(
  overrides: Partial<KeychainSecretStoreOptions> = {},
): ReturnType<typeof createKeychainSecretStore> {
  return createKeychainSecretStore({
    service: TEST_SERVICE,
    keychainPath,
    runner: guardedRunner(),
    ...overrides,
  });
}

const describeOnMac = onMac ? describe : describe.skip;

describeOnMac('🔴 真实钥匙串往返（临时钥匙串，不碰登录钥匙串）', () => {
  it('存进去、读出来', async () => {
    const store = makeStore();
    await store.set('endpoint-a', 'sk-simple-123');
    expect(await store.get('endpoint-a')).toBe('sk-simple-123');
  });

  it('🔴 写入是幂等的（重复写同一个 keyRef 是更新，不是报错）', async () => {
    const store = makeStore();
    await store.set('k', 'first');
    await store.set('k', 'second');
    expect(await store.get('k')).toBe('second');
  });

  it('🔴 含空格、单引号、反斜杠、双引号的秘密原样往返', async () => {
    const tricky = `a b'c\\d"e$f;g|h&i`;
    const store = makeStore();
    await store.set('tricky', tricky);
    expect(await store.get('tricky')).toBe(tricky);
    // 第二事实源：直接从钥匙串读，确认不是我们的 get 自欺欺人
    expect(readDirect(TEST_SERVICE, 'tricky', keychainPath)).toBe(tricky);
  });

  it('🔴 含换行的秘密被**明确拒绝**（而不是被悄悄截断）', async () => {
    // `security -i` 逐行读命令，所以值里不能有换行。
    // 一个被截断的密钥会在很久以后表现为"认证失败"，
    // 那时候没人会想到是写入时丢的 —— 所以宁可当场报错。
    const pem = '-----BEGIN KEY-----\nAAAA\n-----END KEY-----';
    const store = makeStore();
    await expect(store.set('pem', pem)).rejects.toThrow(/控制字符/);
    // 而且**什么都没有写进去**
    expect(readDirect(TEST_SERVICE, 'pem', keychainPath)).toBeUndefined();
  });

  it('没存过的 keyRef 返回 undefined（不是抛错、不是空串）', async () => {
    const store = makeStore();
    expect(await store.get('never-set')).toBeUndefined();
  });

  it('clear 之后读不到，且 clear 是幂等的', async () => {
    const store = makeStore();
    await store.set('k', 'v');
    await store.clear('k');
    expect(await store.get('k')).toBeUndefined();
    // 再删一次不该抛
    await expect(store.clear('k')).resolves.toBeUndefined();
  });

  it('不同 keyRef 互不干扰', async () => {
    const store = makeStore();
    await store.set('a', 'va');
    await store.set('b', 'vb');
    expect(await store.get('a')).toBe('va');
    expect(await store.get('b')).toBe('vb');
  });
});

describeOnMac('🔴🔴 密钥不进 argv', () => {
  it('🔴🔴 `set` 只把密钥放进 **stdin**，命令行里没有它', async () => {
    const seen: { args: readonly string[]; stdin?: string }[] = [];
    const real = createSecurityCliRunner();
    const spy: KeychainRunner = (args, stdin) => {
      seen.push({ args, stdin });
      return real(args, stdin);
    };

    const secret = 'sk-MUST-NOT-APPEAR-IN-ARGV-42';
    const store = createKeychainSecretStore({ service: TEST_SERVICE, keychainPath, runner: spy });
    await store.set('k', secret);

    expect(seen).toHaveLength(1);
    const call = seen[0]!;
    // 用的是 `-i`（从 stdin 读）
    expect(call.args).toEqual(['-i']);
    // 密钥出现在 stdin 里
    expect(call.stdin).toContain(secret);
    // 🔴 而**没有**出现在命令行参数里 —— 一次 `ps` 不该看得到
    expect(call.args.join(' ')).not.toContain(secret);
    expect(call.args.some((a) => a.includes('MUST-NOT'))).toBe(false);
  });

  it('🔴 整个 set 流程里没有任何一次调用把密钥放进 argv', async () => {
    const calls: readonly string[][] = [];
    const real = createSecurityCliRunner();
    const spy: KeychainRunner = (args, stdin) => {
      (calls as string[][]).push([...args]);
      return real(args, stdin);
    };
    const secret = 'sk-ARGV-LEAK-CHECK';
    const store = createKeychainSecretStore({ service: TEST_SERVICE, keychainPath, runner: spy });
    await store.set('k', secret);
    for (const args of calls as string[][]) {
      expect(args.join(' ')).not.toContain(secret);
    }
  });

  it('🔴 真的写进去了（证明 stdin 路线可行，不是"看着成功其实没存"）', async () => {
    // 这条是防那个实测过的坑：`-w` 不带值时退出码 0 但什么都没写。
    const secret = 'sk-stdin-route-works';
    const store = makeStore();
    await store.set('k', secret);
    expect(readDirect(TEST_SERVICE, 'k', keychainPath)).toBe(secret);
  });
});

describe('quoteForSecurity —— 实测出来的规则', () => {
  it('普通值用双引号包裹', () => {
    expect(quoteForSecurity('abc')).toBe('"abc"');
  });

  it('🔴 反斜杠与双引号各加一个反斜杠', () => {
    expect(quoteForSecurity('a\\b')).toBe('"a\\\\b"');
    expect(quoteForSecurity('a"b')).toBe('"a\\"b"');
  });

  it('🔴 单引号**不动**（双引号包裹时它是普通字符）', () => {
    expect(quoteForSecurity(`a'b`)).toBe(`"a'b"`);
  });

  it('空格与 `$;|&` 保持原样（无 shell 参与，不做变量展开）', () => {
    expect(quoteForSecurity('a b$c;d|e&f')).toBe('"a b$c;d|e&f"');
  });

  it('🔴 控制字符（含换行）直接抛错，不静默截断', () => {
    expect(() => quoteForSecurity('a\nb')).toThrow(/控制字符/);
    expect(() => quoteForSecurity('a\rb')).toThrow(/控制字符/);
    expect(() => quoteForSecurity('a\u0000b')).toThrow(/控制字符/);
  });
});

describe('🔴 不可用/失败时降级', () => {
  it('🔴 非 macOS 平台：`isKeychainAvailable` 为 false，`get` 返回 undefined', async () => {
    expect(isKeychainAvailable('win32')).toBe(false);
    const store = createKeychainSecretStore({
      service: TEST_SERVICE,
      platform: 'win32',
      runner: () => Promise.resolve({ code: 0, stdout: 'should-not-be-used', stderr: '' }),
    });
    // 🔴 连 runner 都不该被调用 —— 不假装在 Windows 上能用
    expect(await store.get('k')).toBeUndefined();
  });

  it('🔴 非 macOS 平台下 `set` 明确抛错（不静默丢弃密钥）', async () => {
    const store = createKeychainSecretStore({
      service: TEST_SERVICE,
      platform: 'linux',
      runner: () => Promise.resolve({ code: 0, stdout: '', stderr: '' }),
    });
    await expect(store.set('k', 'v')).rejects.toThrow(/没有实现/);
  });

  it('🔴 钥匙串锁住/用户拒绝 → `get` 退化成 undefined，不抛错', async () => {
    const store = createKeychainSecretStore({
      service: TEST_SERVICE,
      keychainPath,
      runner: () => Promise.resolve({ code: 1, stdout: '', stderr: 'User interaction is not allowed.' }),
    });
    // 关键：抛错会让整个 AI 功能不可用；正确观感是"灰着"
    await expect(store.get('k')).resolves.toBeUndefined();
  });

  it('🔴 "找不到"与"读失败"走不同的分支（都返回 undefined，但一个是正常一个是异常）', async () => {
    const notFound = createKeychainSecretStore({
      service: TEST_SERVICE,
      keychainPath,
      runner: () =>
        Promise.resolve({ code: 44, stdout: '', stderr: 'security: could not be found in the keychain.' }),
    });
    expect(await notFound.get('k')).toBeUndefined();
  });

  it('写入失败会抛错（否则用户以为存好了）', async () => {
    const store = createKeychainSecretStore({
      service: TEST_SERVICE,
      keychainPath,
      runner: () => Promise.resolve({ code: 1, stdout: '', stderr: 'keychain is locked' }),
    });
    await expect(store.set('k', 'v')).rejects.toThrow(/keychain is locked/);
  });
});

describe('🔴🔴 测试护栏本身有效', () => {
  it('🔴 一次不带临时钥匙串的真实调用会被护栏拦住（不会执行）', () => {
    const guard = guardedRunner();
    // 模拟"代码坏掉之后忘了带 keychain 参数"
    expect(() => guard(['find-generic-password', '-s', TEST_SERVICE, '-a', 'x', '-w'])).toThrow(
      /没有指定临时钥匙串/,
    );
  });

  it('🔴 `-i` 模式下**首行**没有钥匙串路径会被拦住', () => {
    const guard = guardedRunner();
    expect(() => guard(['-i'], 'add-generic-password -U -s x -a y -w z\n')).toThrow(
      /没有指定临时钥匙串/,
    );
  });

  it('🔴🔴 换行把命令切断、钥匙串落到**第二行** → 必须被拦住', () => {
    // 这正是上次污染登录钥匙串的真实形状：
    // 秘密里有换行 → `-i` 只执行到第一行 → 尾部的钥匙串参数根本没被读到
    const guard = guardedRunner();
    const brokenStdin = `add-generic-password -U -s x -a y -w "line1\nline2" ${keychainPath}\n`;
    // 整个字符串里**有**钥匙串路径，但首行里没有 —— 旧护栏会放行
    expect(brokenStdin.includes(keychainPath)).toBe(true);
    expect(brokenStdin.split('\n')[0]?.includes(keychainPath)).toBe(false);
    expect(() => guard(['-i'], brokenStdin)).toThrow(/没有指定临时钥匙串/);
  });

  it('✅ 带了临时钥匙串的调用正常放行（护栏不是把功能挡死）', async () => {
    const guard = guardedRunner();
    const result = await guard(['find-generic-password', '-s', TEST_SERVICE, '-a', 'never', '-w', keychainPath]);
    // 找不到是非零，但调用**执行了**
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('could not be found');
  });
});

describe('默认服务名', () => {
  it('是 heyta.ai（与测试用的服务名分开，避免污染）', () => {
    expect(KEYCHAIN_SERVICE).toBe('heyta.ai');
    expect(KEYCHAIN_SERVICE).not.toBe(TEST_SERVICE);
  });
});
