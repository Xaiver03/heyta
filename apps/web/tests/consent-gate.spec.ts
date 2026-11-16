/**
 * 🔴 G-12 的那道进程级闸：`consentFetch` 与 `installConsentGatedFetch`
 * =====================================================================
 *
 * ## 这个文件钉的是"一个字节都不出这个进程"这句话本身
 *
 * `packages/app-host/tests/privacy-consent.spec.ts` 已经在那一侧数过底层次数了，
 * 但它数的是**自己造的假端口**。这里数的是**web 宿主真的会用的那一份**：
 *
 *   · `consentFetch` —— 注入给同步/认证/AI 客户端的那一层；
 *   · `installConsentGatedFetch()` —— 替换 `window.fetch` 的那一层，
 *     它覆盖的是"以后新写的一个调用点忘了传 `fetchImpl`"这一整类失效。
 *
 * 判据一律是**底层被调了几次**，不是"有没有报错"：
 * "报错了"挡不住"先发了请求、再报错"那种实现，而合规要的是**没发过**。
 * （§7 第 50 条：一条永远通过的判据比没有判据更糟。）
 *
 * ## 🔴 为什么用 dynamic import
 *
 * `consentFetch` 在**模块求值期**就把当时的 `globalThis.fetch` 绑好了
 * （`globalThis.fetch.bind(globalThis)`，见 consent-gate.ts:99）。
 * 静态 `import` 会被提到测试文件最前面执行，那时计数器还没装上 ——
 * 于是数出来永远是 0，**看起来完美、实际什么都没测**。
 * 所以这里先装计数器、再 `await import()`，让绑定的那一个就是计数器。
 */

import { act } from 'react';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const pristine = vi.fn(
  async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
    new Response('{"ok":true}', { status: 200 }),
);

/** 底层真实被调的次数 —— 所有断言都围着它转。 */
const pristineCallCount = (): number => pristine.mock.calls.length;

type ConsentModule = typeof import('../src/features/privacy/consent-gate.js');
let mod: ConsentModule;

/**
 * 后加的用例要 `createConsentGatedFetch` / `PrivacyConsentBlockedError` 与
 * 隐私面板 store。它们随 `resetModules()` 一起重新取，所以不能在文件顶部静态 import。
 */
let createConsentGatedFetch: typeof import('@heyta/app-host').createConsentGatedFetch;
let PrivacyConsentBlockedError: typeof import('@heyta/app-host').PrivacyConsentBlockedError;
let usePrivacyStore: typeof import('../src/features/privacy/store.js').usePrivacyStore;
let waitForPrivacyDecision: typeof import('../src/features/privacy/store.js').waitForPrivacyDecision;

async function loadModule(): Promise<ConsentModule> {
  // 每个用例一份干净的模块图：`installed` 那个幂等标记是模块级的。
  vi.resetModules();
  globalThis.fetch = pristine as unknown as typeof fetch;
  return import('../src/features/privacy/consent-gate.js');
}

beforeEach(async () => {
  pristine.mockClear();
  localStorage.clear();
  mod = await loadModule();
  ({ createConsentGatedFetch, PrivacyConsentBlockedError } = await import('@heyta/app-host'));
  const store = await import('../src/features/privacy/store.js');
  usePrivacyStore = store.usePrivacyStore;
  waitForPrivacyDecision = store.waitForPrivacyDecision;
  store.__resetPrivacyDecisionForTests();
  // 起点必须是"没问过"，否则上一条用例留下的会话值会把闸门顶开。
  mod.privacyConsent.revoke();
  expect(mod.privacyConsent.networkAllowed()).toBe(false);
});

describe('consentFetch：闸门关闭时底层一次都不调', () => {
  it('🔴 未同意 ⇒ 底层 0 次，且抛的是 PrivacyConsentBlockedError（不是"网络错误"）', async () => {
    const { consentFetch } = mod;
    const error = await consentFetch('https://sync.example.com/api/sync/ops').then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(pristineCallCount(), '没同意就发了请求').toBe(0);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe('PrivacyConsentBlockedError');
    // 这条不是仪式：上层（`hosted-auth.ts` 的 sendJson）靠 **instanceof** 归类成
    // `consent-required`。改成别的错误名，界面就会说"检查网络"—— 那是假话。
    expect((error as Error).message).toContain('privacy-consent-not-granted');
    // URL 要出现在错误里，否则排查时不知道是哪一处调用被拦的。
    expect((error as Error).message).toContain('/api/sync/ops');
  });

  it('🔴 明确选了「只用本机」同样拦住，而它**不是**"没问过"', async () => {
    const { consentFetch, privacyConsent, privacyConsentActions } = mod;
    privacyConsentActions.localOnly();

    expect(privacyConsent.networkAllowed()).toBe(false);
    // 这一条是那个"两档不是布尔值"的裁决在**宿主侧**的落点：
    // 拦住的方式一样，但界面要不要再问一次不一样（G-11）。
    expect(privacyConsent.undecided()).toBe(false);
    expect(privacyConsent.current()!.decision).toBe('local-only');

    await expect(consentFetch('https://sync.example.com/api/sync/ops')).rejects.toThrow();
    expect(pristineCallCount()).toBe(0);
  });

  it('同意之后照原样放行：参数与返回值都不许被这层改动', async () => {
    const { consentFetch, privacyConsentActions } = mod;
    expect(privacyConsentActions.accept().persisted).toBe(true);

    const init = { method: 'POST' as const, headers: { 'x-a': '1' } };
    const response = await consentFetch('https://sync.example.com/api/sync/ops', init);

    expect(pristineCallCount()).toBe(1);
    expect(pristine.mock.calls[0]![0]).toBe('https://sync.example.com/api/sync/ops');
    expect(pristine.mock.calls[0]![1]).toBe(init);
    expect(response.status).toBe(200);
  });

  it('🔴 写不进 localStorage（Safari 隐私模式）时这一轮仍算同意，且界面知道没落地', async () => {
    const { privacyConsent, privacyConsentActions } = mod;

    // 模拟"不抛、但静默不生效"—— 这正是 Safari 私有模式的行为，
    // 而只测"抛异常"会放过它（端口用的是**读回校验**，不是 try/catch 的结果）。
    //
    // 🔴 必须 spy 在 `Storage.prototype` 上，不能写 `localStorage.setItem = …`：
    // jsdom 的 Storage 是个具名属性代理，给实例赋 `setItem` 会被当成
    // **存了一个叫 `setItem` 的键**，真的那个照写不误（这条用例第一次就是这么假绿的）。
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => undefined);
    try {
      // 🔴 先断言**前提**成立（§7 第 50 条：一条永远通过的判据比没有判据更糟）。
      // 没有这一句，下面那个 `false` 可能是"闸门真的读不到"给的，也可能仍是"写成功了"给的。
      localStorage.setItem('probe-key', 'probe-value');
      expect(
        localStorage.getItem('probe-key'),
        'setItem 的桩没生效 —— 这条用例在测一件不存在的事',
      ).toBeNull();

      expect(privacyConsentActions.accept().persisted).toBe(false);
      // 会话内仍然放行 —— 用户确实同意了，这台设备没记住是另一件事（界面要说出那件事）。
      expect(privacyConsent.networkAllowed()).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('installConsentGatedFetch：把闸装到进程级出口上', () => {
  it('🔴 装上之后，任何**没有**传 fetchImpl 的代码调 `fetch` 也出不去', async () => {
    mod.installConsentGatedFetch();
    // ⚠️ 这里用的是**全局** `fetch`，不是导出的那个 —— 判据要落在"别人不知道有闸"的路径上。
    expect(globalThis.fetch).not.toBe(pristine);

    const error = await fetch('https://sync.example.com/api/login/passkey/options').then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(pristineCallCount(), '裸 fetch 绕过了闸门').toBe(0);
    expect((error as Error).name).toBe('PrivacyConsentBlockedError');
  });

  it('🔴 幂等：装两次不许把闸套两层（否则"底层次数"这个判据会翻倍失真）', async () => {
    mod.installConsentGatedFetch();
    const afterFirst = globalThis.fetch;
    mod.installConsentGatedFetch();
    expect(globalThis.fetch, '第二次安装又包了一层').toBe(afterFirst);

    mod.privacyConsentActions.accept();
    await fetch('https://sync.example.com/api/sync/ops');
    expect(pristineCallCount()).toBe(1);
  });

  it('装上之后同意仍然能放行（闸不是单向门：点了同意要真的能出门）', async () => {
    mod.installConsentGatedFetch();
    mod.privacyConsentActions.accept();
    const response = await fetch('https://sync.example.com/api/sync/ops');
    expect(response.status).toBe(200);
    expect(pristineCallCount()).toBe(1);
  });

  it('🔴 撤回同意之后，同一个已装好的闸立刻重新拦住（会话与磁盘必须同时压住）', async () => {
    mod.installConsentGatedFetch();
    mod.privacyConsentActions.accept();
    await fetch('https://sync.example.com/api/sync/ops');
    expect(pristineCallCount()).toBe(1);

    mod.privacyConsentActions.revoke();
    await expect(fetch('https://sync.example.com/api/sync/ops')).rejects.toThrow();
    // 次数**没有增加**才是判据：撤回之后还发得出去，就是"界面说已撤回、请求照发"。
    expect(pristineCallCount()).toBe(1);
  });
});

describe('🔴 同意之后原样重试那一次（ADR-0086 的第三格）', () => {
  it('面板开着时被拦下的请求会等；点「同意并联网」之后自己发出去', async () => {
    /*
      真实链路：用户点了某个要出门的动作 → `requireNetworkConsent()` 把面板打开
      （`open` = true）→ 那次请求被闸门拦下 → 它**挂起**等同一个决定 →
      用户点同意 → 请求原样重发，用户不需要再点一次。

      这条钉的是"同意之后什么也没发生"那一类静默失效。
    */
    let allowed = false;
    const calls: string[] = [];
    const inner = (async (input: RequestInfo | URL) => {
      calls.push(typeof input === 'string' ? input : String(input));
      return new Response('{"ok":true}', { status: 200 });
    }) as typeof fetch;

    const gated = createConsentGatedFetch(inner, () => allowed, {
      ask: () => waitForPrivacyDecision(),
    });

    // 面板已经由"动作"打开
    usePrivacyStore.getState().openSheet('required-for-action');

    const pending = gated('https://heyta.example/api/sync/ops');
    // 还没决定时不该发出任何东西
    await Promise.resolve();
    expect(calls, '同意之前一个请求都不该发').toHaveLength(0);

    act(() => {
      allowed = true;
      usePrivacyStore.getState().accept();
    });

    const response = await pending;
    expect(response.status).toBe(200);
    expect(calls, '同意之后应当只重试那一次').toEqual(['https://heyta.example/api/sync/ops']);
  });

  it('🔴 冷启动时被拦下的请求**不弹面板**（否则首屏又是一堵墙）', async () => {
    const calls: string[] = [];
    const inner = (async () => {
      calls.push('x');
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const gated = createConsentGatedFetch(inner, () => false, {
      ask: () => waitForPrivacyDecision(),
    });

    // 面板没开（冷启动、没人触发动作）
    await expect(gated('https://heyta.example/api/x')).rejects.toThrow(
      PrivacyConsentBlockedError,
    );
    expect(usePrivacyStore.getState().open, '冷启动被拦下却把面板弹起来了').toBe(false);
    expect(calls).toHaveLength(0);
  });
});
