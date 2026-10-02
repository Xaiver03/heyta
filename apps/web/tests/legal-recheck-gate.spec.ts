/**
 * 🔴 补签闸门的**宿主接缝**（G-27）：值怎么进去、什么时候才问得出去
 * ===============================================================
 *
 * `packages/app-host/tests/legal-recheck.spec.ts` 钉的是**判定**（那里给端口喂的是
 * 已经绑好的值）。本文件钉的是只有 web 这一层才存在的四件事 —— 也就是
 * `features/legal-recheck/gate.ts` 文件头自称"承重"的那一条：
 *
 *   1. **没绑定 ⇒ 一个请求都不发**（`askLegalRecheck()` 拿到空令牌空地址时直接判
 *      `anonymous`）。这一条单独存在没意义，它必须和下面第 3 条**一起**才有效：
 *      只测"没绑所以不发"是一种假通过 —— 把 `getToken()` 写死成 `() => undefined`
 *      也照样全绿，而那正是"闸门永远不拦任何人"的实现形状。
 *   2. `bind` **只交值、不问**（冷启动那一步设备级闸门多半还关着，问了是白问）。
 *   3. 绑定之后 `askLegalRecheck()` **问得出去**，而且打的是那个端点、带的是 Bearer。
 *   4. 🔴 换令牌 ⇒ **重问**，且第二次用的是新令牌（"活取值"的全部内容的所在）。
 *      如果这里缓存了启动那一刻的值，症状是"换了账号还在按上一个人的版本判"，
 *      而那是一个**看不见也点不着**的状态。
 *   5. 🔴 设备级同意（链 5）关着的时候，这一问**自己也出不了门** ——
 *      它注入的是带闸的 `consentFetch`，不是一句裸 `fetch`。
 *   6. 登出把**上一个人的答案**一起清掉（闸门不许留着 `currentVersion`）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CURRENT = 'terms@1.2;privacy@1.0';
const RECORDED = 'terms@1.1;privacy@1.0';

interface Sent {
  method: string;
  url: string;
  auth: string | undefined;
}

const sent: Sent[] = [];

/**
 * 🔴 必须在**任何 `src/` 模块被求值之前**装上（`consent-gate.ts` 在模块求值期
 * 绑定 pristine `fetch`）—— 计数器装晚了数到的永远是 0，而"零请求"就变成一条
 * 永远通过的判据（§7 第 50 条）。
 */
globalThis.fetch = vi.fn(
  async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    sent.push({
      method: init?.method ?? 'GET',
      url: typeof input === 'string' ? input : String(input),
      auth: headers.get('authorization') ?? undefined,
    });
    return new Response(
      JSON.stringify({
        needsReconfirm: true,
        reason: 'version-changed',
        currentVersion: CURRENT,
        recordedVersion: RECORDED,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  },
) as unknown as typeof fetch;

const {
  askLegalRecheck,
  bindLegalRecheckCredentials,
  clearLegalRecheckCredentials,
  legalRecheck,
  syncLegalRecheckCredentials,
} = await import('../src/features/legal-recheck/gate.js');
const { privacyConsent, privacyConsentActions } = await import(
  '../src/features/privacy/consent-gate.js'
);

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) await flush();
};

const asked = (baseUrl: string): Sent[] =>
  sent.filter((s) => s.url === `${baseUrl}/api/account/legal-consent`);

beforeEach(() => {
  sent.length = 0;
  clearLegalRecheckCredentials();
  // 「同意并联网」：这一问本身也是出站请求，链 5 的闸开着才问得出去。
  expect(privacyConsentActions.accept().persisted, '测试环境里 localStorage 不可用').toBe(true);
});

afterEach(() => {
  clearLegalRecheckCredentials();
  privacyConsent.revoke();
});

describe('补签闸门的宿主接缝', () => {
  it('🔴 没绑定凭据时问 ⇒ 一个请求都不发，判成 anonymous（不拦、也不假装判过）', async () => {
    askLegalRecheck();
    await settle();

    expect(sent, '闸门手里没有凭据却发出了询问').toHaveLength(0);
    expect(legalRecheck.current().phase).toBe('anonymous');
    // `anonymous` 不拦 —— 未登录时没有"这个账号"可裁决，拦了只会把本地优先变成不能用。
    expect(legalRecheck.dataEgressAllowed()).toBe(true);
    // 而且不许留着任何版本号：那是上一个人的答案（界面据此展示文本，错了就是骗人）。
    expect(legalRecheck.current().currentVersion).toBeNull();
  });

  it('`bind` 只交值、**不问**（冷启动那一步设备级闸门多半还关着）', async () => {
    bindLegalRecheckCredentials({ token: 'TK-1', baseUrl: 'https://heyta.test' });
    await settle();

    expect(sent, 'bind 把询问发出去了').toHaveLength(0);
    // 值已经交进去了 ⇒ 状态还是 anonymous，但**下一次问**用得到它（下一条钉这个）。
    expect(legalRecheck.current().phase).toBe('anonymous');
  });

  it('🔴 绑定之后问 ⇒ 恰好一次 GET，打的是那个端点、带的是 Bearer', async () => {
    bindLegalRecheckCredentials({ token: 'TK-1', baseUrl: 'https://heyta.test' });
    askLegalRecheck();
    await settle();

    const hits = asked('https://heyta.test');
    expect(hits, `没问到该问的端点：${JSON.stringify(sent)}`).toHaveLength(1);
    expect(hits[0]!.method).toBe('GET');
    expect(hits[0]!.auth).toBe('Bearer TK-1');
    // 答"要补签" ⇒ 拦（这一条把上面那条"没绑所以不拦"从假通过里拉出来：
    // 两件事合起来才说明**拦不拦取决于答案**，而不是取决于有没有人问）。
    expect(legalRecheck.current().phase).toBe('needs-reconfirm');
    expect(legalRecheck.dataEgressAllowed()).toBe(false);
    expect(legalRecheck.current().currentVersion, '界面要展示的版本没带回来').toBe(CURRENT);
  });

  it('🔴 换令牌 ⇒ 重问，且第二次带的是**新**令牌（缓存旧值的症状是"按上一个人的版本判"）', async () => {
    syncLegalRecheckCredentials({ token: 'TK-1', baseUrl: 'https://heyta.test' });
    await settle();
    expect(asked('https://heyta.test')).toHaveLength(1);

    syncLegalRecheckCredentials({ token: 'TK-2', baseUrl: 'https://heyta.test' });
    await settle();

    const hits = asked('https://heyta.test');
    expect(hits, '换令牌后没有重问').toHaveLength(2);
    expect(hits[1]!.auth).toBe('Bearer TK-2');
  });

  it('🔴 换服务端地址 ⇒ 问到**新**那台机器（两台实例的条款版本可以完全不同）', async () => {
    syncLegalRecheckCredentials({ token: 'TK-1', baseUrl: 'https://a.test' });
    await settle();
    syncLegalRecheckCredentials({ token: 'TK-1', baseUrl: 'https://b.test' });
    await settle();

    expect(asked('https://a.test')).toHaveLength(1);
    expect(asked('https://b.test'), '换地址后还在问旧那台').toHaveLength(1);
  });

  it('🔴 链 5 关着时这一问**也出不了门**（它注入的是带闸的 consentFetch）', async () => {
    privacyConsent.revoke();
    expect(privacyConsent.networkAllowed()).toBe(false);

    syncLegalRecheckCredentials({ token: 'TK-1', baseUrl: 'https://heyta.test' });
    await settle();

    expect(sent, '设备级同意还没作出就把"要不要补签"问了出去').toHaveLength(0);
    // 问不到不等于"不用补签"：闸门不许因为自己没问成就把数据放行，
    // 但也不许弹一个可能永远不消失的面板 —— 这里停在 `checking`。
    expect(legalRecheck.shouldShowSheet()).toBe(false);
  });

  it('登出把上一个人的答案一起清掉（留着的症状是界面按旧版本展示文本）', async () => {
    syncLegalRecheckCredentials({ token: 'TK-1', baseUrl: 'https://heyta.test' });
    await settle();
    expect(legalRecheck.dataEgressAllowed(), '前置：这一条要对着"拦着"的状态验').toBe(false);

    clearLegalRecheckCredentials();

    expect(legalRecheck.current().phase).toBe('anonymous');
    expect(legalRecheck.current().currentVersion).toBeNull();
    expect(legalRecheck.current().recordedVersion).toBeNull();
    sent.length = 0;
    askLegalRecheck();
    await settle();
    expect(sent, '清空后又拿旧凭据去问').toHaveLength(0);
  });
});
