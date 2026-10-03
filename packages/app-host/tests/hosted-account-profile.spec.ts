/**
 * 账号资料客户端（R10）：昵称与头像的**协议层**契约
 * =================================================
 *
 * 这一层是"未登录不发请求""没有口令不上传"这两条规则的**家**。
 * ADR-0038 那轮记过的原话在这儿同样成立：**判据钉错层的症状是
 * "看起来在保护一件事，其实保护的是另一件"** —— 所以把"零出站"钉在这里，
 * 而不是钉在 `apps/web` 的组件上（组件那边拿掉短路时，症状是抛一个
 * `undefined.trim()` 的异常，请求照样是零，于是一条假绿）。
 *
 * ## 覆盖的是**真加密**，不是桩
 *
 * `uploadAccountAvatar` / `decodeAvatarCipher` 走的是 `@heyta/sync-core` 的
 * `encrypt`/`decrypt`（Argon2id + AES-GCM）。这里不 mock 它们，因为本功能最
 * 核心的一句对外承诺是"服务端拿到的是解不开的密文"，而那句话**只有真跑一遍
 * 加密才算被验证过**（mock 会凭空造 API：桩里写 `cipherBase64` 就永远对）。
 *
 * ⚠️ 全程零联网：`fetch` 一律注入。
 */
import { describe, expect, it, vi } from 'vitest';

import {
  HOSTED_AUTH_PATHS,
  decodeAvatarCipher,
  deleteAccountAvatar,
  encodeAvatarCipher,
  fetchAccountAvatar,
  getAccountProfile,
  updateAccountDisplayName,
  uploadAccountAvatar,
  type HostedAuthOptions,
} from '../src/hosted-auth.js';

interface RecordedCall {
  readonly url: string;
  readonly method: string | undefined;
  readonly headers: Record<string, string> | undefined;
  readonly body: unknown;
}

function fetchReturning(status: number, body: unknown): { impl: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const impl = ((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method,
      headers: init?.headers as Record<string, string> | undefined,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    return Promise.resolve({
      status,
      ok: status >= 200 && status < 300,
      json: () => Promise.resolve(body),
    } as unknown as Response);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const opts = (): HostedAuthOptions => ({ baseUrl: 'https://sync.example.com' });
const TOKEN = 'jwt-from-login';
const PASSWORD = 'e2ee-passphrase';
const PROFILE = { displayName: '小鹿', avatarHash: null };

// 🔴 覆写类型要显式写成**线上的形状**（两个都可空），不能 `Partial<typeof PROFILE>`：
// 字面量推断会把 displayName 收窄成 `string`、avatarHash 收窄成 `null`，
// 于是"传 null 清除昵称""传回真实 hash"这两个用例在类型上就写不出来（TS2322）。
const profileBody = (over: Partial<{ displayName: string | null; avatarHash: string | null }> = {}) => ({
  ...PROFILE,
  ...over,
});

describe('未登录 / 空令牌：一个请求都不发', () => {
  it('getAccountProfile：令牌为空串或纯空白 ⇒ invalid-input，且 fetch 零调用', async () => {
    for (const bad of ['', '   ']) {
      const f = fetchReturning(200, profileBody());
      vi.stubGlobal('fetch', f.impl);
      const out = await getAccountProfile(opts(), bad);
      expect(out.ok).toBe(false);
      expect(f.calls, `空令牌却发了 ${f.calls.length} 个请求`).toEqual([]);
      vi.unstubAllGlobals();
    }
  });

  it('updateAccountDisplayName / uploadAccountAvatar / deleteAccountAvatar：同样零出站', async () => {
    const f = fetchReturning(200, profileBody());
    vi.stubGlobal('fetch', f.impl);
    await updateAccountDisplayName(opts(), '', '昵称');
    await uploadAccountAvatar(opts(), '', PASSWORD, {
      contentType: 'image/png',
      dataBase64: 'iVBORw0KGgo=',
    });
    await deleteAccountAvatar(opts(), '  ');
    expect(f.calls, '没有令牌时这三个函数都不该出门').toEqual([]);
    vi.unstubAllGlobals();
  });

  it('没有口令时 fetchAccountAvatar **不去拉**密文（拉回来也解不开）', async () => {
    const f = fetchReturning(200, { cipherBase64: 'whatever' });
    vi.stubGlobal('fetch', f.impl);
    for (const password of [undefined, '', '  ']) {
      const out = await fetchAccountAvatar(opts(), TOKEN, password);
      expect(out).toEqual({ ok: false, reason: 'no-password' });
    }
    // 🔴 这条抓到过一个**真缺陷**（第一版把口令闸门放在 decodeAvatarCipher 里，
    // 于是没有口令的设备会**先把密文拉回来**再判解不开）。web 界面自己挡过一层，
    // 所以它在界面上看不见 —— 规则要住在这一层，否则每个壳都得各挡一遍。
    expect(f.calls, '口令都没有就出站，是一次纯浪费的往返').toEqual([]);

    // 没登录与没有口令是**两句不同的话**，不许共用一个 reason：
    // 前者要去做登录，后者要在同步设置里补口令。
    const noToken = await fetchAccountAvatar(opts(), '', PASSWORD);
    expect(noToken).toEqual({ ok: false, reason: 'no-token' });
    expect(f.calls, '没有令牌也出站').toEqual([]);
    vi.unstubAllGlobals();
  });
});

describe('打对路径 / 方法 / Bearer / 请求体', () => {
  it('GET profile → PUT profile（改昵称）→ DELETE avatar，三条都用同一个前缀与令牌', async () => {
    const f = fetchReturning(200, profileBody());
    vi.stubGlobal('fetch', f.impl);
    await getAccountProfile(opts(), TOKEN);
    await updateAccountDisplayName(opts(), TOKEN, '  小鹿鹿  ');
    await deleteAccountAvatar(opts(), TOKEN);

    expect(f.calls.map((c) => [c.method, c.url])).toEqual([
      ['GET', `https://sync.example.com${HOSTED_AUTH_PATHS.accountProfile}`],
      ['PUT', `https://sync.example.com${HOSTED_AUTH_PATHS.accountProfile}`],
      ['DELETE', `https://sync.example.com${HOSTED_AUTH_PATHS.accountAvatar}`],
    ]);
    // 🔴 trim 发生在**发出去之前**：服务端也会 trim，但"用户打了尾随空格"
    // 不该变成库里一个看不见的差异（两台设备各 trim 一次就漂了）。
    expect(f.calls[1]?.body).toEqual({ displayName: '小鹿鹿' });
    for (const call of f.calls) {
      // 🔴 键**按小写取**：`sendJson` 就是写的小写 `authorization`（HTTP/1.1 的
      // 头名不区分大小写，但传给 fetch 的是普通对象，所以 `headers.Authorization`
      // 会是 undefined —— 在这里按首字母大写去取，会得到一条"看起来没带令牌"的假红）。
      expect(call.headers?.authorization).toBe(`Bearer ${TOKEN}`);
    }
    vi.unstubAllGlobals();
  });

  it('清除昵称发的是 `null`，而空串是**本地拒绝**（两者不是同一件事）', async () => {
    const f = fetchReturning(200, profileBody({ displayName: null }));
    vi.stubGlobal('fetch', f.impl);
    const cleared = await updateAccountDisplayName(opts(), TOKEN, null);
    expect(cleared.ok).toBe(true);
    expect(f.calls[0]?.body).toEqual({ displayName: null });

    const before = f.calls.length;
    const blank = await updateAccountDisplayName(opts(), TOKEN, '   ');
    expect(blank.ok).toBe(false);
    expect(f.calls.length, '空白昵称发出去了 ⇒ 契约里"空串无效"这条被绕过').toBe(before);
    vi.unstubAllGlobals();
  });
});

describe('头像是密文：上传与读回走同一把口令', () => {
  const IMAGE = { contentType: 'image/png' as const, dataBase64: 'iVBORw0KGgoAAAANSUhEUg==' };

  it('PUT avatar：出站的确实是**用同一把口令解得开的密文**，而且原图不在里面', async () => {
    const f = fetchReturning(200, profileBody({ avatarHash: 'deadbeef' }));
    vi.stubGlobal('fetch', f.impl);
    const out = await uploadAccountAvatar(opts(), TOKEN, PASSWORD, IMAGE);
    expect(out.ok).toBe(true);
    expect(f.calls).toHaveLength(1);
    const body = f.calls[0]?.body as { cipherBase64: string };
    expect(typeof body.cipherBase64).toBe('string');

    // 🔴 这条是这个功能的核心承诺，而它**必须写成双向证明**。
    // 第一版只写了"出站串里找不到原图 base64"，那条是一个**永远为真的弱断言**：
    // base64 套 base64 本来就不含子串（位对齐不同），所以把整条变异成
    // `Buffer.from(JSON.stringify(image)).toString('base64')`（明文上传！）
    // 它照样绿。实测：那条臂存活。
    //
    // 正向：拿口令能把它解回**原图** ⇒ 它是我们那套密文，不是别的。
    const decoded = await decodeAvatarCipher(PASSWORD, body.cipherBase64);
    expect(decoded, '口令解不开出站的那串 ⇒ 它不是 E2EE 密文').toEqual({ ok: true, image: IMAGE });
    // 反向：它的明文里**不含**图片字节 ⇒ 服务端拿到 nothing。
    const asPlain = Buffer.from(body.cipherBase64, 'base64').toString('utf8');
    expect(asPlain, '出站串的明文里出现了原图字节 = 根本没加密').not.toContain(IMAGE.dataBase64);
    vi.unstubAllGlobals();
  });

  it('真往返：上传的密文用**同一口令**能解回原图；用错口令解不开', async () => {
    const cipher = await encodeAvatarCipher(PASSWORD, IMAGE);
    const right = await decodeAvatarCipher(PASSWORD, cipher);
    expect(right).toEqual({ ok: true, image: IMAGE });

    const wrong = await decodeAvatarCipher('another-passphrase', cipher);
    expect(right.ok && wrong.ok).toBe(false);
    // 口令错与密文被截断在这里长得一模一样，所以只断言"不是成功"，不猜原因。
    expect(wrong.ok).toBe(false);
  });

  it('GET avatar：响应形状不对时**不判成功**（服务端只存密文，客户端要兜住形状）', async () => {
    vi.stubGlobal('fetch', fetchReturning(200, { nope: 1 }).impl);
    expect(await fetchAccountAvatar(opts(), TOKEN, PASSWORD)).toEqual({
      ok: false,
      reason: 'bad-shape',
    });
    vi.unstubAllGlobals();
  });

  it('GET profile：2xx 但响应体不是预期形状 ⇒ 不当成功', async () => {
    vi.stubGlobal('fetch', fetchReturning(200, { displayName: 42 }).impl);
    const out = await getAccountProfile(opts(), TOKEN);
    expect(out.ok).toBe(false);
    vi.unstubAllGlobals();
  });
});
