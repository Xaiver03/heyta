/**
 * 设置页的「个人信息」（R10）：昵称与头像的增删改查判据
 * ====================================================
 *
 * 被测的是**这条链**：界面输入 → `@heyta/app-host` 的窄函数 → `fetch` →
 * 一个**有状态**的假服务端 → 重新挂载后读回来。
 *
 * ## 🔴 为什么假服务端必须有状态
 *
 * 本仓库认"真的存下来了"的最低门槛是 **§8.4 第 5 条：改完刷新还在**。
 * 一个只回 `200 {}` 的桩能让"值只活在组件 state 里"这种缺陷完全通过 ——
 * 而那正是这个功能唯一的失败形态（用户改了昵称，下次开机又是邮箱）。
 * 所以这里的 `state` 是一个真的对象，`PUT` 写它、`GET` 读它，
 * 断言一律在 **`root.unmount()` + 重新 `render`** 之后做。
 *
 * ## 变异（做过的，每条都精确报红）
 *
 * | 拿掉什么 | 红的是哪条 |
 * |---|---|
 * | 保存后不写回 state（桩只回 200） | 「刷新还在」 |
 * | `updateAccountDisplayName` 里 `null → ''` 的分支 | 「清除」那条：请求体变成空串、被契约拒 |
 * | 超长时的本地 guard | 「超长不发请求」 |
 * | `signedIn` 的短路 | 「未登录零请求」 |
 * | 口令缺失时那段陈述句 | 「没有口令时说清原因，不说你没有头像」 |
 *
 * ## ⚠️ 这个文件**没有**覆盖到的两件事（别把它当成全覆盖）
 *
 * 1. **`avatar-encode.ts` 的压缩**（canvas 裁方、边长、字节上限）——
 *    jsdom 的 `<canvas>` 没有 2D 上下文，`new Image()` 也不会真的解码。
 *    所以下面用 `vi.mock` 把这一层换掉，**测的是接线不是算法**。
 *    它自己的判据只能是真浏览器（§6.2 规定一），登记在
 *    `docs/plans/ui-review-fill-zh-timeline.md` §8.7 的"取证"那一行。
 * 2. **服务端真的接受/拒绝**（Bearer 归属、密文形状、`bodyLimit`、
 *    登录响应的白名单投影）—— 那是 `server/tests/account-profile*.spec.ts` 的活。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@heyta/i18n';
import { HOSTED_AUTH_PATHS, decodeAvatarCipher } from '@heyta/app-host';

// 🔴 路径**必须**用 app-host 那枚常量（它自带 `/api` 前缀）。本文件第一版按
// `ACCOUNT_PROFILE_PATHS` 手拼出 `/account/profile` ⇒ 桩一路 404，
// 而症状是"昵称读不出来"，看起来完全像组件的 bug。
// 这条教训就是它自己的判据：路径只有一个来源，**测试也不许另拼一份**。
const PROFILE = HOSTED_AUTH_PATHS.accountProfile;
const AVATAR = HOSTED_AUTH_PATHS.accountAvatar;

// 🔴 必须在 import 组件之前 mock 掉平台层（见文件头"没覆盖到的第一件事"）。
// 它返回的是**固定的** payload，所以断言"上传发出去的东西"其实是断言接线。
// ⚠️ 必须用 `vi.hoisted`：`vi.mock` 的工厂会被提升到模块最前面，
//    直接引用外面的 `let` 会得到 "Cannot access before initialization"。
const ENCODED = { contentType: 'image/png', dataBase64: 'iVBORw0KGgo=' } as const;
const encoder = vi.hoisted(() => ({ fail: null as null | 'bad-type' | 'too-big' | 'undecodable' }));
vi.mock('../src/features/settings/avatar-encode.js', () => ({
  loadAvatarImage: async () =>
    encoder.fail === null
      ? { ok: true, image: { contentType: 'image/png', dataBase64: 'iVBORw0KGgo=' } }
      : { ok: false, error: encoder.fail },
}));

import { ProfilePanel } from '../src/features/settings/ProfilePanel.js';
import { useSyncStore } from '../src/features/sync/store.js';

const SERVER = 'https://sync.example.test';
const TOKEN = 'token-from-login';
const PASSWORD = 'e2ee-passphrase';

/** 有状态的假服务端。它就是"刷新之后还在不在"的那个"在"。 */
const state: { displayName: string | null; avatarHash: string | null; cipher: string | null } = {
  displayName: null,
  avatarHash: null,
  cipher: null,
};
let calls: { method: string; path: string; body: unknown }[] = [];

let container: HTMLDivElement;
let root: Root;

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

/**
 * 等到条件成立（最多 ~200 个宏任务），等不到就带着**它到底在等什么**报错。
 *
 * 🔴 为什么不用 `await flush(); await flush();`：上传那条链有 **≥3 个**异步边界
 *   （读文件 → 加密 → PUT），"固定刷 N 次"只在机器空的时候刚好够用。
 *   实测（2026-10-03）：本机 load average 59 时单跑 2/2 过、全量跑必红，
 *   而红的文件每次还可能不是同一个 —— 那是**探针在猜时长**的形状，
 *   不是产品行为漂了。轮询把"等多久"从猜测变成条件，断言一个字都没松。
 */
const waitUntil = async (label: string, done: () => boolean): Promise<void> => {
  for (let i = 0; i < 200; i += 1) {
    if (done()) return;
    await flush();
  }
  throw new Error(
    `等待「${label}」超时（200 个宏任务）\n当前出站请求：${JSON.stringify(
      calls.map((c) => `${c.method} ${c.path}`),
    )}`,
  );
};

/** 挂载 / 重新挂载。**重新挂载就是"刷新"**：组件 state 全丢，只剩这个假服务端。 */
const mount = async (): Promise<void> => {
  await act(async () => {
    root.render(
      <I18nProvider locale="zh-CN">
        <ProfilePanel />
      </I18nProvider>,
    );
  });
  await flush();
};

const find = <T extends HTMLElement>(testId: string): T | null =>
  container.querySelector<T>(`[data-testid="${testId}"]`);

const text = (testId: string): string => find<HTMLElement>(testId)?.textContent ?? '';

const setInput = async (input: HTMLInputElement, value: string): Promise<void> => {
  await act(async () => {
    // React 的受控 input 只认**原生 setter** 写进去的值：直接赋值 `value`
    // 会被它的 value tracker 当成"没有变化"而吞掉 onChange。
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const click = async (el: HTMLElement | null): Promise<void> => {
  expect(el, '判据要点的那个控件不在 DOM 里').not.toBeNull();
  await act(async () => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
};

beforeEach(() => {
  localStorage.clear();
  state.displayName = null;
  state.avatarHash = null;
  state.cipher = null;
  calls = [];
  encoder.fail = null;

  useSyncStore.setState({
    baseUrl: SERVER,
    token: TOKEN,
    password: PASSWORD,
    email: 'you@example.test',
    status: { kind: 'idle' },
    syncNow: async () => ({ kind: 'idle' as const }),
    startRealtime: () => undefined,
  });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const path = new URL(url).pathname;
      const method = String(init?.method ?? 'GET').toUpperCase();
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ method, path, body });
      const profile = () => Response.json({ displayName: state.displayName, avatarHash: state.avatarHash });
      if (path === PROFILE && method === 'GET') return profile();
      if (path === PROFILE && method === 'PUT') {
        state.displayName = (body as { displayName: string | null }).displayName;
        return profile();
      }
      if (path === AVATAR && method === 'PUT') {
        const cipher = (body as { cipherBase64: string }).cipherBase64;
        state.cipher = cipher;
        state.avatarHash = 'hash-of-' + cipher.slice(0, 8);
        return profile();
      }
      if (path === AVATAR && method === 'GET') {
        if (state.cipher === null) {
          return Response.json({ error: 'No avatar.', code: 'avatar-absent' }, { status: 404 });
        }
        return Response.json({ cipherBase64: state.cipher });
      }
      if (path === AVATAR && method === 'DELETE') {
        state.cipher = null;
        state.avatarHash = null;
        return profile();
      }
      return Response.json({ error: 'not found' }, { status: 404 });
    }),
  );

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
});

describe('个人信息面板（R10）', () => {
  it('未登录时零请求、零未处理异常（短路既挡门也挡崩）', async () => {
    useSyncStore.setState({ token: undefined, baseUrl: '' });
    const errors: unknown[] = [];
    const onError = (e: unknown): void => {
      errors.push(e);
    };
    process.on('unhandledRejection', onError);
    try {
      await mount();
      expect(calls, '未登录却发了请求').toEqual([]);

      await setInput(find<HTMLInputElement>('profile-nickname-input')!, '想改的昵称');
      await click(find<HTMLElement>('profile-nickname-save'));
      expect(calls, '没有令牌也要发请求 = 拿 401 当作用户反馈').toEqual([]);
    } finally {
      process.off('unhandledRejection', onError);
    }
    // 🔴 这一半才是让"短路"这条变异**会红**的原因。
    // 只断言"零请求"的话，拿掉短路也还是零请求 —— 因为 `token.trim()` 在
    // app-to-host 之前先抛了 `TypeError`，请求同样没出去（这条臂第一轮就活了下来，
    // 实测）。而"点设置页就抛一个没人看的异常"是真缺陷：它会让界面永远停在空值，
    // 而控制台之外没有任何人知道。
    // ⚠️ "不发请求"这条规则**本体**住在 app-host，判据在
    // `packages/app-host/tests/hosted-account-profile.spec.ts`（那里能红）。
    expect(errors, `未登录时抛出 ${errors.length} 个未处理异常`).toEqual([]);
  });

  it('挂载时读到当前昵称（不是空框）', async () => {
    state.displayName = '小鹿';
    await mount();
    expect(find<HTMLInputElement>('profile-nickname-input')?.value).toBe('小鹿');
  });

  it('改昵称 → 保存 → **重新挂载后还在**（真的存进服务端，不是组件 state）', async () => {
    await mount();
    await setInput(find<HTMLInputElement>('profile-nickname-input')!, '小鹿鹿');
    await click(find<HTMLElement>('profile-nickname-save'));
    expect(text('profile-nickname-notice')).toContain('已保存');

    act(() => {
      root.unmount();
    });
    root = createRoot(container);
    await mount();
    expect(find<HTMLInputElement>('profile-nickname-input')?.value).toBe('小鹿鹿');
    expect(state.displayName).toBe('小鹿鹿');
  });

  it('清空昵称发的是 `null`（清除），不是空串，并且重挂后回到占位符', async () => {
    state.displayName = '小鹿';
    await mount();
    await setInput(find<HTMLInputElement>('profile-nickname-input')!, '');
    await click(find<HTMLElement>('profile-nickname-save'));

    const put = calls.find((c) => c.method === 'PUT' && c.path === PROFILE);
    expect(put?.body).toEqual({ displayName: null });
    expect(text('profile-nickname-notice')).toContain('已清除');
    expect(state.displayName).toBeNull();

    act(() => {
      root.unmount();
    });
    root = createRoot(container);
    await mount();
    const input = find<HTMLInputElement>('profile-nickname-input')!;
    expect(input.value).toBe('');
    expect(input.getAttribute('placeholder')).toContain('邮箱');
  });

  it('昵称只填空白 ⇒ 与留空同义（发 `null` 清除），**永不**发出空串', async () => {
    // 区分点不在界面上"用户打了几个空格"，而在**线上形状**：
    // 契约里 `''` 是无效输入（400），`null` 才是"清除"。
    // UI 把两者收敛成一个：trim 后为空 ⇒ `null`。所以这条判据钉的是
    // "请求体里绝不会出现 displayName: ''"，而不是"不发请求"。
    state.displayName = '小鹿';
    await mount();
    await setInput(find<HTMLInputElement>('profile-nickname-input')!, '   ');
    await click(find<HTMLElement>('profile-nickname-save'));
    const put = calls.find((c) => c.method === 'PUT' && c.path === PROFILE);
    expect(put?.body).toEqual({ displayName: null });
    expect(state.displayName).toBeNull();
  });

  it('超过 32 个码点 ⇒ 当场说清，并且不发请求', async () => {
    await mount();
    await setInput(find<HTMLInputElement>('profile-nickname-input')!, '一'.repeat(33));
    expect(text('profile-nickname-toolong')).toContain('32');
    await click(find<HTMLElement>('profile-nickname-save'));
    expect(calls.filter((c) => c.method === 'PUT')).toEqual([]);
  });

  it('32 个 emoji（每个两个 UTF-16 单元）不算超长 —— 钉住"按码点数"这条口径', async () => {
    await mount();
    await setInput(find<HTMLInputElement>('profile-nickname-input')!, '👍'.repeat(32));
    expect(find<HTMLElement>('profile-nickname-toolong')).toBeNull();
    await click(find<HTMLElement>('profile-nickname-save'));
    const put = calls.find((c) => c.method === 'PUT');
    expect(put, 'emoji 昵称被误判成超长 ⇒ 计数用的是 .length').toBeTruthy();
  });

  it('有口令 + 上传 ⇒ 发 PUT 头像、预览出现，服务端拿到的是**解不开的密文**', async () => {
    await mount();
    expect(find<HTMLElement>('profile-avatar-img')).toBeNull();

    const fileInput = find<HTMLInputElement>('profile-avatar-file')!;
    await act(async () => {
      Object.defineProperty(fileInput, 'files', {
        value: [new File([new Uint8Array([137, 80, 78, 71])], 'a.png', { type: 'image/png' })],
        configurable: true,
      });
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitUntil('头像 PUT 出站', () =>
      calls.some((c) => c.method === 'PUT' && c.path === AVATAR),
    );

    const put = calls.find((c) => c.method === 'PUT' && c.path === AVATAR);
    expect(put, '换了头像却没有出站 PUT').toBeTruthy();
    const sent = (put?.body as { cipherBase64: string }).cipherBase64;
    expect(typeof sent).toBe('string');
    // 🔴 双向证明，不是"串里找不到原图"那种弱断言（base64 套 base64 本来就不含
    // 子串，明文上传也能把它骗过去 —— 同一个坑在 app-host 那边被变异实测抓出）。
    // 正向：用同步口令能把出站那串解回**原图**。
    const decoded = await decodeAvatarCipher(PASSWORD, sent);
    expect(decoded.ok && decoded.image.dataBase64).toBe(ENCODED.dataBase64);
    // 反向：它的明文里不含图片字节 ⇒ 服务端什么也没拿到。
    expect(Buffer.from(sent, 'base64').toString('utf8')).not.toContain(ENCODED.dataBase64);
    expect(find<HTMLElement>('profile-avatar-img')).not.toBeNull();
  });

  it('移除头像 ⇒ 发 DELETE、预览消失、服务端不再返回 hash', async () => {
    await mount();
    const fileInput = find<HTMLInputElement>('profile-avatar-file')!;
    await act(async () => {
      Object.defineProperty(fileInput, 'files', {
        value: [new File([new Uint8Array([137, 80, 78, 71])], 'a.png', { type: 'image/png' })],
        configurable: true,
      });
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitUntil('头像 PUT 落定（服务端记下 hash）', () => state.avatarHash !== null);
    expect(state.avatarHash).not.toBeNull();

    await click(find<HTMLElement>('profile-avatar-remove'));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
    expect(state.avatarHash).toBeNull();
    expect(find<HTMLElement>('profile-avatar-img')).toBeNull();
  });

  it('本机没有口令时：说明原因，**不**说"你没有头像"，也不去拉密文', async () => {
    useSyncStore.setState({ password: undefined });
    state.avatarHash = 'some-existing-hash';
    await mount();
    expect(text('profile-avatar-need-password')).toContain('端到端加密口令');
    expect(
      calls.some((c) => c.method === 'GET' && c.path === AVATAR),
      '没有口令还去拉密文：拉回来也解不开，白跑一趟还会显示成错误'
    ).toBe(false);
  });

  it('点「换一张」把系统文件框弹出来（隐藏的原生 input 必须仍在 DOM 里）', async () => {
    await mount();
    const fileInput = find<HTMLInputElement>('profile-avatar-file');
    expect(fileInput, '文件输入不在 DOM 里 ⇒ 「换一张」点了没东西').not.toBeNull();
    const clickSpy = vi.spyOn(fileInput!, 'click').mockImplementation(() => undefined);
    await click(find<HTMLElement>('profile-avatar-change'));
    expect(clickSpy).toHaveBeenCalledOnce();
  });
});
