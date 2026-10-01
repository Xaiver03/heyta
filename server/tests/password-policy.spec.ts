import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 口令**策略**（`src/password/policy.ts`）—— 计划 `docs/plans/email-password-auth.md` W1 判据。
 *
 * 这一组钉的四件事，每一件都对应一个"看起来在拦、其实没拦"的形状：
 *
 * 1. **长度按码点算**，不是 UTF-16 单元。用 256 个 emoji 钉：按单元算是 512，会被误判 `too_long`。
 * 2. 🔴 **本地常见口令表真的在命中**。49 233 条的表如果查错了键（比如只查原样大小写），
 *    它就是一行永远不命中的装饰 —— 而它是这里**唯一确定性**的那道（HIBP 是 fail-open 的）。
 * 3. **顺序**：静态策略在前、网络在后。一个 5 个字符的口令**不该**为了被拒而发一个请求。
 * 4. 🔴 **fail-open 必留 warn**。"检查通过"和"没检查成"在结果上一样，只有日志能区分；
 *    没有那条 warn，一次 HIBP 故障会伪装成"所有新口令都干净"，事后完全无法归因。
 *
 * ⚠️ 全部用例**不出网** —— `globalThis.fetch` 逐个替换。登录路径本来就不调这里
 * （`checkNewPassword` 只在设口令时跑），那条由 `password-auth-flow.spec.ts` 钉。
 */

const spiedLogger = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock('../src/logger', () => ({ Logger: spiedLogger }));

import {
  checkNewPassword,
  checkPasswordStaticPolicy,
  isCommonPassword,
  MAX_PASSWORD_CODE_POINTS,
  MIN_PASSWORD_CODE_POINTS,
  normalizePassword,
} from '../src/password/policy';
import { createHash } from 'crypto';

/** 一个口令在 HIBP 范围应答里的那 35 个十六进制字符（后段）。 */
const hibpSuffix = (value: string): string =>
  createHash('sha1').update(value, 'utf8').digest('hex').toUpperCase().slice(5);

const respond = (body: string, ok = true, status = 200): Response =>
  ({ ok, status, text: async () => body }) as unknown as Response;

type FetchInit = { headers?: Record<string, string>; signal?: AbortSignal };

let fetchMock: ReturnType<typeof vi.fn>;
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  spiedLogger.warn.mockClear();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** 干净放行：应答里只有别人的哈希。 */
const mockNotBreached = (): void => {
  fetchMock.mockResolvedValue(respond(`0A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6E7:12\r\nZZ:0`));
};

describe('归一化：NFC + NFKC，且只有这一个口径', () => {
  it('把 NFD 分解序列折成 NFC —— macOS 键盘给的组合形与 Windows 给的预组合形必须是同一个串', () => {
    expect(normalizePassword('cafe\u0301')).toBe('caf\u00e9');
    expect(normalizePassword('cafe\u0301')).toBe(normalizePassword('caf\u00e9'));
  });

  it('🔴 NFKC 而不是 NFC：连字与全角也要折叠', () => {
    // U+FB01 ﬁ：NFC 不折它，只有 NFKC 会。
    expect(normalizePassword('\uFB01le')).toBe('file');
    // 全角 ＡＢ：看着一样、字节不一样，正是"输入没错却登不进去"的生成方式。
    expect(normalizePassword('\uFF21\uFF22passphrase')).toBe('ABpassphrase');
  });
});

describe('长度：按码点，不是 UTF-16 单元；超长明确拒绝', () => {
  it(`${MIN_PASSWORD_CODE_POINTS} 个码点是下限，少一个就拒`, () => {
    expect(checkPasswordStaticPolicy('a'.repeat(MIN_PASSWORD_CODE_POINTS - 1))).toEqual({
      ok: false,
      code: 'too_short',
    });
    expect(checkPasswordStaticPolicy('a'.repeat(MIN_PASSWORD_CODE_POINTS))).toBeNull();
  });

  it('🔴 256 个 emoji（= 512 个 UTF-16 单元）不越界 —— 钉住"数的是码点"', () => {
    const edge = '\u{1F600}'.repeat(MAX_PASSWORD_CODE_POINTS);
    expect(edge.length).toBe(MAX_PASSWORD_CODE_POINTS * 2); // 按单元算会在上面这行就露馅
    expect(checkPasswordStaticPolicy(edge)).toBeNull();
    expect(checkPasswordStaticPolicy('\u{1F600}'.repeat(MAX_PASSWORD_CODE_POINTS + 1))).toEqual({
      ok: false,
      code: 'too_long',
    });
  });

  it('超长**拒绝**而不是静默截断（NIST 800-63B 5.1.1.2）', async () => {
    mockNotBreached();
    const tooLong = 'x'.repeat(MAX_PASSWORD_CODE_POINTS + 10);
    expect(await checkNewPassword(tooLong)).toEqual({ ok: false, code: 'too_long' });
    // 截断的形状是"照样建号，但只存前 256 个字符"—— 那要靠这里连请求都不发来钉。
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('🔴 本地常见口令表确实在命中（不是装饰）', () => {
  it('表里的口令被拒，且大小写不敏感', () => {
    // 'password' 在任何一份常见口令表里都排得上号；这条转红就说明表没加载对。
    expect(isCommonPassword('password')).toBe(true);
    expect(checkPasswordStaticPolicy('password')).toEqual({ ok: false, code: 'too_common' });
    expect(checkPasswordStaticPolicy('Password')).toEqual({ ok: false, code: 'too_common' });
    expect(checkPasswordStaticPolicy('PASSWORD')).toEqual({ ok: false, code: 'too_common' });
  });

  it('不在表里的 passphrase 放行 —— 证明它拦的是"常见"，不是"没看懂"', () => {
    expect(isCommonPassword('seventigersbrewcoffeeatdawn')).toBe(false);
    expect(checkPasswordStaticPolicy('seventigersbrewcoffeeatdawn')).toBeNull();
  });

  it('长度先于常见度：7 个字符报 too_short（顺序可预期，客户端那句提示才有意义）', () => {
    expect(checkPasswordStaticPolicy('password')).toEqual({ ok: false, code: 'too_common' });
    expect(checkPasswordStaticPolicy('passwor')).toEqual({ ok: false, code: 'too_short' });
  });
});

describe('泄露检查：k-匿名、顺序、fail-open', () => {
  it('🔴 只发 SHA-1 的前 5 个十六进制字符，绝不明文或整串散列出网', async () => {
    const password = 'seventigersbrewcoffeeatdawn';
    mockNotBreached();

    expect(await checkNewPassword(password)).toEqual({ ok: true, normalized: password });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    const suffix = hibpSuffix(password);
    expect(url).toMatch(/^https:\/\/api\.pwnedpasswords\.com\/range\/[0-9A-F]{5}$/);
    expect(url).not.toContain(password);
    expect(url).not.toContain(suffix);
    const init = fetchMock.mock.calls[0][1] as FetchInit | undefined;
    expect(init?.headers).toMatchObject({ 'Add-Padding': 'true' });
  });

  it('命中泄露（次数 > 0）⇒ breached', async () => {
    const password = 'winter2026iscomingfast';
    fetchMock.mockResolvedValue(respond(`${hibpSuffix(password)}:9000000`));
    expect(await checkNewPassword(password)).toEqual({ ok: false, code: 'breached' });
  });

  it('🔴 `:0` 的填充行**不算**泄露 —— 因为我们发了 Add-Padding，应答里必然有它', async () => {
    // 只比 suffix 不看次数，就等于把接口那句"这条没出现过"读成"泄露了"：
    // 症状是一个干净口令被拒，而日志里一切正常。
    const password = 'sevenwolvesatmidnight';
    fetchMock.mockResolvedValue(respond(hibpSuffix(password) + ':0'));
    expect(await checkNewPassword(password)).toEqual({ ok: true, normalized: password });
  });

  it('静态策略在前：太短的口令**一个请求都不发**（不为被拒而联网）', async () => {
    expect(await checkNewPassword('abc')).toEqual({ ok: false, code: 'too_short' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('🔴 fail-open 但三种"没查成"各留一条 warn', async () => {
    // 1) 网络异常
    fetchMock.mockRejectedValue(new Error('ENOTFOUND'));
    expect(await checkNewPassword('sevenwolvesatmidnight')).toEqual({
      ok: true,
      normalized: 'sevenwolvesatmidnight',
    });
    expect(spiedLogger.warn).toHaveBeenCalledTimes(1);
    expect(String(spiedLogger.warn.mock.calls[0][0])).toMatch(/not delivered/);

    // 2) 非 2xx
    spiedLogger.warn.mockClear();
    fetchMock.mockResolvedValue(respond('', false, 503));
    expect((await checkNewPassword('sevenwolvesatmidnight')).ok).toBe(true);
    expect(String(spiedLogger.warn.mock.calls[0][0])).toMatch(/HTTP 503/);

    // 3) 空响应体
    spiedLogger.warn.mockClear();
    fetchMock.mockResolvedValue(respond(''));
    expect((await checkNewPassword('sevenwolvesatmidnight')).ok).toBe(true);
    expect(spiedLogger.warn).toHaveBeenCalledTimes(1);
  });

  it('超时上界是从实测推出来的（HIBP 尾延迟 2.7 s，砍太短会把"慢"伪装成"没泄露"）', async () => {
    const real = AbortSignal.timeout.bind(AbortSignal);
    const spy = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => real(ms));
    mockNotBreached();
    await checkNewPassword('sevenwolvesatmidnight');
    expect(spy).toHaveBeenCalledWith(2000);
    spy.mockRestore();
  });

  it('畸形行（无冒号 / 次数不是数字）跳过而不抛 —— 解析器不能被一行装饰数据打断', async () => {
    const password = 'sevenwolvesatmidnight';
    fetchMock.mockResolvedValue(
      respond(['# padding', '   ', 'NOCOLONLINE', `${hibpSuffix(password)}:notanumber`].join('\r\n')),
    );
    expect(await checkNewPassword(password)).toEqual({ ok: true, normalized: password });
  });

  it('行内前后空白容得下（真实应答是 CRLF 分隔，末行没有换行）', async () => {
    const password = 'sevenwolvesatmidnight';
    fetchMock.mockResolvedValue(
      respond(`0A1B:1\r\n  ${hibpSuffix(password)} : 7 \r\n`),
    );
    expect(await checkNewPassword(password)).toEqual({ ok: false, code: 'breached' });
  });
});
