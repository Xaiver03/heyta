/**
 * 账号资料客户端（R10）：昵称与头像的**协议层**契约
 * =================================================
 *
 * 这一层是"未登录不发请求""头像读写不需要任何钥匙"这两条规则的**家**。
 * ADR-0038 那轮记过的原话在这儿同样成立：**判据钉错层的症状是
 * "看起来在保护一件事，其实保护的是另一件"** —— 所以把"零出站"钉在这里，
 * 而不是钉在 `apps/web` 的组件上（组件那边拿掉短路时，症状是抛一个
 * `undefined.trim()` 的异常，请求照样是零，于是一条假绿）。
 *
 * ## 🔴 2026-11-01：头像**不再是**加密载荷（ADR-0079）
 *
 * 头像与昵称是**基础资料**，明文存储、明文读写；端到端加密只留给任务/便签这类实质内容。
 * ⇒ 这一组判据与旧版**方向相反**：
 *   - 出站 body 里**就该有** `contentType` 与 `dataBase64`（服务端要按白名单与大小校验）；
 *   - `fetchAccountAvatar` / `uploadAccountAvatar` **不接受钥匙参数**；
 *   - 没有"口令不对 / 这台设备解不开"这两种状态。
 *
 * ⚠️ 全程零联网：`fetch` 一律注入。
 */
import { describe, expect, it, vi } from 'vitest';

import {
  HOSTED_AUTH_PATHS,
  deleteAccountAvatar,
  fetchAccountAvatar,
  getAccountProfile,
  resolveAccountAvatarImage,
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
    await uploadAccountAvatar(opts(), '', { contentType: 'image/png', dataBase64: 'iVBORw0KGgo=' });
    await deleteAccountAvatar(opts(), '  ');
    expect(f.calls, '没有令牌时这三个函数都不该出门').toEqual([]);
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

/**
 * 🔴 头像的读写**不接受钥匙**（ADR-0079）。
 *
 * 判据不是"有钥匙时也能用"，而是**函数形状里根本没有钥匙**：
 * 传 `contentType + dataBase64` 就出门、拿回 `{contentType,dataBase64}` 就能显示。
 * 服务端现在能校验格式与大小，所以出站 body 里**必须**有 `contentType` ——
 * 旧版那条"出站只许有一个 cipherBase64 键"的判据方向已被 ADR-0079 推翻。
 */
describe('头像是基础资料：明文读写，不需要任何钥匙', () => {
  const IMAGE = { contentType: 'image/png' as const, dataBase64: 'iVBORw0KGgoAAAANSUhEUg==' };

  it('PUT avatar：出站就是明文载荷，服务端能校验 contentType 与字节数', async () => {
    const f = fetchReturning(200, { avatarHash: 'deadbeef' });
    vi.stubGlobal('fetch', f.impl);
    const out = await uploadAccountAvatar(opts(), TOKEN, IMAGE);
    expect(out).toEqual({ ok: true, avatarHash: 'deadbeef' });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]?.method).toBe('PUT');
    expect(f.calls[0]?.url).toBe(`https://sync.example.com${HOSTED_AUTH_PATHS.accountAvatar}`);
    // 明文的形状**必须**逐键相等：服务端靠这两个键做白名单与大小校验。
    expect(f.calls[0]?.body).toEqual({
      contentType: 'image/png',
      dataBase64: IMAGE.dataBase64,
    });
    vi.unstubAllGlobals();
  });

  it('格式不在白名单 / 压缩后超限 ⇒ **不发请求**（客户端先挡一次，服务端仍会复核）', async () => {
    const f = fetchReturning(200, { avatarHash: 'deadbeef' });
    vi.stubGlobal('fetch', f.impl);
    const badType = await uploadAccountAvatar(opts(), TOKEN, {
      contentType: 'image/svg+xml' as unknown as 'image/png',
      dataBase64: IMAGE.dataBase64,
    });
    expect(badType.ok).toBe(false);

    const tooBig = await uploadAccountAvatar(opts(), TOKEN, {
      contentType: 'image/png',
      dataBase64: Buffer.alloc(512 * 1024 + 3).toString('base64'),
    });
    expect(tooBig.ok).toBe(false);
    expect(f.calls, '本地已判定不可上传却还是出站').toEqual([]);
    vi.unstubAllGlobals();
  });

  it('GET avatar：明文载荷原样读回，形状不对时**不判成功**', async () => {
    const ok = fetchReturning(200, { ...IMAGE, avatarHash: 'deadbeef' });
    vi.stubGlobal('fetch', ok.impl);
    expect(await fetchAccountAvatar(opts(), TOKEN)).toEqual({ ok: true, image: IMAGE });
    expect(ok.calls.map((c) => [c.method, c.url])).toEqual([
      ['GET', `https://sync.example.com${HOSTED_AUTH_PATHS.accountAvatar}`],
    ]);
    vi.unstubAllGlobals();

    vi.stubGlobal('fetch', fetchReturning(200, { nope: 1 }).impl);
    expect(await fetchAccountAvatar(opts(), TOKEN)).toEqual({ ok: false, reason: 'bad-shape' });
    vi.unstubAllGlobals();

    vi.stubGlobal('fetch', fetchReturning(200, { contentType: 'image/svg+xml', dataBase64: 'AA==' }).impl);
    expect(await fetchAccountAvatar(opts(), TOKEN)).toEqual({ ok: false, reason: 'bad-shape' });
    vi.unstubAllGlobals();
  });

  it('没有令牌 ⇒ no-token，且**一个请求都不发**', async () => {
    const f = fetchReturning(200, { ...IMAGE, avatarHash: 'h' });
    vi.stubGlobal('fetch', f.impl);
    expect(await fetchAccountAvatar(opts(), '  ')).toEqual({ ok: false, reason: 'no-token' });
    expect(f.calls, '没有令牌还出站').toEqual([]);
    vi.unstubAllGlobals();
  });

  it('GET profile：2xx 但响应体不是预期形状 ⇒ 不当成功', async () => {
    vi.stubGlobal('fetch', fetchReturning(200, { displayName: 42 }).impl);
    const out = await getAccountProfile(opts(), TOKEN);
    expect(out.ok).toBe(false);
    vi.unstubAllGlobals();
  });
});

/**
 * `resolveAccountAvatarImage` 是"这台设备现在该显示什么"的唯一裁决。
 * 明文之后只剩三种状态；**没有** `needs-password` / `undecryptable`。
 */
describe('头像读侧的三种状态（界面按它出句子）', () => {
  const IMAGE = { contentType: 'image/png' as const, dataBase64: 'iVBORw0KGgoAAAANSUhEUg==' };

  it('服务端说没有头像（hash 为 null）⇒ absent，且**一个请求都不发**', async () => {
    const f = fetchReturning(200, { ...IMAGE, avatarHash: 'unused' });
    vi.stubGlobal('fetch', f.impl);
    expect(await resolveAccountAvatarImage(opts(), TOKEN, null)).toEqual({ state: 'absent' });
    expect(f.calls, 'avatarHash 是 null 还去取图 = 明知没有也要跑一趟').toEqual([]);
    vi.unstubAllGlobals();
  });

  it('取回明文 ⇒ ready，且 dataUri 的字节形状就是契约那一枚', async () => {
    const f = fetchReturning(200, { ...IMAGE, avatarHash: 'some-hash' });
    vi.stubGlobal('fetch', f.impl);
    const out = await resolveAccountAvatarImage(opts(), TOKEN, 'some-hash');
    expect(out).toEqual({
      state: 'ready',
      dataUri: `data:${IMAGE.contentType};base64,${IMAGE.dataBase64}`,
    });
    vi.unstubAllGlobals();
  });

  it('网络失败 / 形状不对 ⇒ unreadable；**没有钥匙相关的状态**', async () => {
    const states: string[] = [];
    const record = async (setup: () => { impl: typeof fetch }): Promise<string> => {
      const f = setup();
      vi.stubGlobal('fetch', f.impl);
      const out = await resolveAccountAvatarImage(opts(), TOKEN, 'h');
      states.push(out.state);
      vi.unstubAllGlobals();
      return out.state;
    };

    expect(await record(() => fetchReturning(200, { ...IMAGE, avatarHash: 'h' }))).toBe('ready');
    expect(await record(() => fetchReturning(500, { error: 'boom' }))).toBe('unreadable');
    expect(await record(() => fetchReturning(200, { nope: 1 }))).toBe('unreadable');
    expect([...new Set(states)].sort()).toEqual(['ready', 'unreadable']);
  });
});
