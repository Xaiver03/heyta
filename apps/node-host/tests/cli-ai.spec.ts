/**
 * AI 密钥命令测试
 * ==================
 *
 * 🔴 两条承重断言：
 *   1. 🔴🔴 **密钥只能从 stdin 进，不能从 argv 进**
 *   2. 🔴🔴 **任何输出里都不出现密钥内容**
 *
 * ⚠️ `set` 会真的写系统钥匙串，所以这一组用**注入的 runner**
 * 指向临时钥匙串 —— 绝不碰用户的登录钥匙串（见上一轮的教训）。
 */

import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import type { WritableSecretStore } from '../src/keychain-secret-store.js';
import { runAiKeyCommand } from '../src/cli-ai.js';

/**
 * 🔴🔴 **假存储，绝不落到真实钥匙串。**
 *
 * `runAiKeyCommand` 的默认实现会写用户的登录钥匙串 ——
 * 上一轮已经因为这个出过一次真实事故。测试一律注入这个。
 */
function fakeStore(): WritableSecretStore & { readonly written: Map<string, string> } {
  const written = new Map<string, string>();
  return {
    written,
    get: (keyRef) => Promise.resolve(written.get(keyRef)),
    set: (keyRef, secret) => {
      written.set(keyRef, secret);
      return Promise.resolve();
    },
    clear: (keyRef) => {
      written.delete(keyRef);
      return Promise.resolve();
    },
  };
}

/** 默认 deps：可用 + 假存储。 */
function deps(store = fakeStore()): {
  store: WritableSecretStore;
  available: boolean;
} {
  return { store, available: true };
}

/** 把一段文本变成一个可读流。 */
function stdinOf(text: string): PassThrough {
  const stream = new PassThrough();
  stream.end(text);
  return stream;
}

const SECRET = 'sk-MUST-NOT-LEAK-9f3a';

describe('🔴🔴 密钥不从命令行来', () => {
  it('🔴🔴 多传了参数（= 想把密钥写在命令行里）→ 明确拒绝', async () => {
    const result = await runAiKeyCommand(['set', 'e1', SECRET], stdinOf(''), deps());
    expect(result.code).toBe(1);
    // 🔴 拒绝理由要说清楚为什么
    expect(result.stderr).toContain('ps');
    expect(result.stderr).toContain('shell 历史');
    // 🔴 而且**不能**把那个密钥回显出来
    expect(result.stdout).not.toContain(SECRET);
    expect(result.stderr).not.toContain(SECRET);
  });

  it('🔴 拒绝信息给出正确用法', async () => {
    const result = await runAiKeyCommand(['set', 'e1', SECRET], stdinOf(''), deps());
    expect(result.stderr).toContain('stdin');
    expect(result.stderr).toContain('printf');
  });

  it('没有端点 id → 拒绝', async () => {
    expect((await runAiKeyCommand(['set'], stdinOf(SECRET), deps())).code).toBe(1);
  });
});

describe('🔴 输出里不出现密钥', () => {
  it('🔴 set 的自我介绍只报长度，不报内容', async () => {
    const result = await runAiKeyCommand(['set', 'e1'], stdinOf(SECRET), deps());
    // 平台不支持时会失败；支持时成功 —— 两种都不该泄漏
    expect(result.stdout).not.toContain(SECRET);
    expect(result.stderr).not.toContain(SECRET);
    if (result.code === 0) {
      expect(result.stdout).toContain(String(SECRET.length));
      expect(result.stdout).toContain('字符');
    }
  });

  it('🔴 list 不打印任何密钥', async () => {
    const result = await runAiKeyCommand(['list'], stdinOf(''), deps());
    expect(result.stdout).not.toContain(SECRET);
    expect(result.code).toBe(0);
  });

  it('🔴 用了错的子命令 → 帮助里不含密钥', async () => {
    const result = await runAiKeyCommand(['nonsense', SECRET], stdinOf(''), deps());
    expect(result.code).toBe(1);
    expect(result.stderr).not.toContain(SECRET);
  });
});

describe('stdin 读取的边界', () => {
  it('🔴 去掉结尾的**一个**换行（shell 管道几乎总带一个）', async () => {
    const result = await runAiKeyCommand(['set', 'e1'], stdinOf(`${SECRET}\n`), deps());
    if (result.code === 0) {
      // 长度必须与不带换行时一致
      const withoutNewline = await runAiKeyCommand(['set', 'e1'], stdinOf(SECRET), deps());
      expect(result.stdout).toBe(withoutNewline.stdout);
    }
  });

  it('🔴 **不 trim** —— 密钥里的空格是它的一部分', async () => {
    const withSpaces = '  sk-a b c  ';
    const result = await runAiKeyCommand(['set', 'e1'], stdinOf(withSpaces), deps());
    if (result.code === 0) {
      // 长度应当保留前后空格（只去掉结尾换行）
      expect(result.stdout).toContain(String(withSpaces.length));
    }
  });

  it('🔴 空 stdin → 拒绝，不静默存一个空值', async () => {
    const result = await runAiKeyCommand(['set', 'e1'], stdinOf(''), deps());
    expect(result.code).toBe(1);
    // 无论平台是否支持，空密钥都不该被当成成功
    if (result.stderr.includes('空内容')) {
      expect(result.stdout).toBe('');
    } else {
      // 平台不支持时是另一条理由
      expect(result.stderr).toContain('钥匙串');
    }
  });

  it('🔴 只有一个换行的 stdin 也算空（不能存一个空串）', async () => {
    const result = await runAiKeyCommand(['set', 'e1'], stdinOf('\n'), deps());
    expect(result.code).toBe(1);
  });
});

describe('clear 与帮助', () => {
  it('clear 需要端点 id', async () => {
    expect((await runAiKeyCommand(['clear'], stdinOf(''), deps())).code).toBe(1);
  });

  it('没有子命令 → 打印用法并失败', async () => {
    const result = await runAiKeyCommand([], stdinOf(''), deps());
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('key set');
    expect(result.stderr).toContain('key clear');
  });
});
