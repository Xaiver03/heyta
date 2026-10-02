/**
 * 🔴 G-27 在**移动端**这一侧：改版之后，没补签的账号数据出不去
 * ==========================================================
 *
 * ## 与 web 那两件的**分工**（不是复制）
 *
 * `packages/app-host/tests/legal-recheck.spec.ts` 钉的是**判定**（喂进去的是已经绑好的
 * 端口值），`apps/web/tests/legal-recheck-gate.spec.ts` 钉的是 web 的宿主接缝。
 * 这一份钉的只有移动端才存在的四件事：
 *
 *   1. **凭据来自活配置**（`sync/config.ts`，一个字符一个字符地写），
 *      所以"活取值"在移动端不是理论问题：令牌是在本会话内被换掉无数次的那个值。
 *   2. **拦的是 `syncNow()` 与自动同步的 `ready()` 两条路**，
 *      外加实时通道那一处（`WebSocket` 不走 `fetch`，进程级那道闸罩不到它）。
 *   3. **登出必须忘掉上一个人的答案** —— 移动端没有"刷新页面"这条自愈路径，
 *      面板会一直挂着。
 *   4. **「稍后再说」不放开闸门**（这条在两块面板之间是**相反**的：
 *      隐私面板的"以后再说"是"还没决定"，这里的"稍后再说"是"决定不作、拦着不动"）。
 *
 * ## 判据一律是**底层被调了几次**
 *
 * "报错了"挡不住"先把包发出去、再报错"那种实现，而 G-27 要的是**没发过**。
 * ⚠️ 这里 `openTaskHost` 是**假**的（真它会去开 op-sqlite），
 * 所以"数据没出去"的直接证据是 `host.sync()` 被调了 0 次 ——
 * 那是移动端**唯一**的同步出口，等价于"一个字节都没走"。
 *
 * ## 🔴 为什么每个模块都用 dynamic import
 *
 * `consentFetch` 在**模块求值期**就把当时的 `globalThis.fetch` 绑死了
 * （`consent-gate.ts` 里 `globalThis.fetch.bind(globalThis)`）。静态 import 会被提到
 * 本文件最前面执行，那时计数器还没装上 ⇒ 数出来**永远是 0**，
 * "零请求"就成了一条永远通过的判据（§7 第 50 条）。
 * 所以：先装计数器，再 `await import()`。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AppHost } from '@heyta/app-host';
import type { RealtimeClient } from '@heyta/sync-client';
import type { RealtimeWiringOptions } from '@heyta/app-host';

const CURRENT = 'terms@1.2;privacy@1.0';
const RECORDED = 'terms@1.1;privacy@1.0';

/**
 * 假设备偏好库（隐私闸门 G-12 的后端）。
 *
 * ⚠️ 必须 mock：让它去撞 op-sqlite 的结果是"这台设备记不住同意"，
 * 于是"同意之后问得出去"那条路径在这个进程里**永远测不到**。
 */
const prefs = vi.hoisted(() => ({ store: new Map<string, string>() }));

vi.mock('../src/prefs/device-prefs', () => ({
  PREF_KEY_WELCOME_SEEN: 'welcome.hasSeen',
  DEVICE_PREFS_DB_NAME: 'heyta-device-prefs.sqlite',
  readDevicePref: (key: string): string | undefined => prefs.store.get(key),
  writeDevicePref: (key: string, value: string): boolean => {
    prefs.store.set(key, value);
    return true;
  },
  deleteDevicePref: (key: string): boolean => {
    prefs.store.delete(key);
    return true;
  },
  markWelcomeSeen: () => true,
  hasSeenWelcome: () => false,
  resetDevicePrefsCacheForTests: () => undefined,
}));

/**
 * 假的同步宿主 —— **移动端唯一的出站口**。
 *
 * 所有"数据没出去"的断言都围着 `syncCalls` 转：`syncNow()` 里能真正把 op 推出去的
 * 只有 `host.sync()` 这一条路，所以"0 次"就是"一个字节都没走"。
 */
const host = vi.hoisted(() => ({ syncCalls: 0, resolveCalls: 0 }));

vi.mock('../src/db/open-host', () => ({
  openTaskHost: async () => ({
    engine: { getClientId: () => 'device-under-test' },
    sync: async () => {
      host.syncCalls += 1;
      return { kind: 'synced', at: 1 };
    },
    resolveConflict: async () => {
      host.resolveCalls += 1;
      return { kind: 'synced', at: 1 };
    },
    pendingUploadCount: async () => 0,
  }),
}));

interface Sent {
  method: string;
  url: string;
  auth: string | undefined;
  body: string | undefined;
}

const net = vi.hoisted(() => ({
  sent: [] as Sent[],
  /** 这一问回什么。用例可换成"挂起"以造出 `checking` 那个窗口。 */
  mode: 'needs-reconfirm' as 'needs-reconfirm' | 'current' | 'hanging' | 'network-down',
  /** `hanging` 时由用例放行（答案落地）。 */
  release: null as null | (() => void),
}));

const LEGAL_ENDPOINT = '/api/account/legal-consent';

const pristine = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const headers = new Headers(init?.headers);
  const url = typeof input === 'string' ? input : String(input);
  net.sent.push({
    method: init?.method ?? 'GET',
    url,
    auth: headers.get('authorization') ?? undefined,
    body: typeof init?.body === 'string' ? init.body : undefined,
  });

  if (net.mode === 'hanging') {
    await new Promise<void>((resolveDone) => {
      net.release = resolveDone;
    });
  }
  if (net.mode === 'network-down') throw new TypeError('fetch failed');

  if ((init?.method ?? 'GET') === 'POST') {
    // 写侧的回执：服务端记下的就是它收到的那一版。
    return new Response(JSON.stringify({ recordedVersion: CURRENT }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  return new Response(
    JSON.stringify(
      net.mode === 'current'
        ? { needsReconfirm: false, reason: 'current', currentVersion: CURRENT, recordedVersion: CURRENT }
        : { needsReconfirm: true, reason: 'version-changed', currentVersion: CURRENT, recordedVersion: RECORDED },
    ),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}) as unknown as typeof fetch & { mock: { calls: unknown[][] } };

type GateModule = typeof import('../src/legal-recheck/gate');
type UiModule = typeof import('../src/legal-recheck/reconfirm-ui');
type SyncModule = typeof import('../src/sync/store');
type ConfigModule = typeof import('../src/sync/config');
type PrivacyModule = typeof import('../src/privacy/consent-gate');
type RealtimeModule = typeof import('../src/sync/realtime');

interface H {
  gate: GateModule;
  ui: UiModule;
  sync: SyncModule;
  config: ConfigModule;
  privacy: PrivacyModule;
  realtime: RealtimeModule;
}

const BASE_URL = 'https://heyta.test';

/**
 * 全新的一份模块图（`vi.resetModules()`）+ 装好计数器之后的动态 import。
 *
 * ⚠️ import 顺序有意义：`sync/config` 与 `privacy/consent-gate` 要在
 * `legal-recheck/gate` 之前求值 —— 后者在模块求值期就订阅了"凭据被清空"。
 */
async function load(options: { consented?: boolean; credentials?: boolean } = {}): Promise<H> {
  const consented = options.consented ?? true;
  const credentials = options.credentials ?? true;

  vi.resetModules();
  net.sent.length = 0;
  net.mode = 'needs-reconfirm';
  net.release = null;
  host.syncCalls = 0;
  host.resolveCalls = 0;
  prefs.store.clear();
  globalThis.fetch = pristine;

  const privacy = await import('../src/privacy/consent-gate');
  if (consented) {
    expect(privacy.privacyConsentActions.accept().persisted, '前置：同意没能落盘').toBe(true);
  }
  const config = await import('../src/sync/config');
  if (credentials) config.writeSyncConfig({ serverUrl: BASE_URL, token: 'TK-1', password: 'pw' });

  const gate = await import('../src/legal-recheck/gate');
  const ui = await import('../src/legal-recheck/reconfirm-ui');
  const sync = await import('../src/sync/store');
  const realtime = await import('../src/sync/realtime');

  // 起点：闸门谁都没问过，也没拦任何人（下面每条要"拦着"的用例都得自己把它推过去）。
  expect(gate.legalRecheck.current().phase).toBe('anonymous');
  return { gate, ui, sync, config, privacy, realtime };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await flush();
};

const asked = (baseUrl = BASE_URL): Sent[] => net.sent.filter((s) => s.url === `${baseUrl}${LEGAL_ENDPOINT}`);
/** 除"问补签"之外的所有出站 —— 数据出路的计数器。 */
const nonAskEgress = (): Sent[] => net.sent.filter((s) => !s.url.endsWith(LEGAL_ENDPOINT));

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('补签闸门的宿主接缝（活配置 + 带链 5 闸门的 fetch）', () => {
  it('🔴 没配凭据时问 ⇒ 一个请求都不发，判 anonymous 且**不拦**', async () => {
    const h = await load({ credentials: false });

    h.gate.askLegalRecheck();
    await settle();

    expect(net.sent, '闸门手里没有凭据却发出了询问').toHaveLength(0);
    expect(h.gate.legalRecheck.current().phase).toBe('anonymous');
    expect(h.gate.legalRecheck.dataEgressAllowed()).toBe(true);
    expect(h.gate.legalRecheck.current().currentVersion).toBeNull();
  });

  it('🔴 配好凭据后问 ⇒ 恰好一次 GET、打对端点、带 Bearer；答"要补签"⇒ 拦', async () => {
    const h = await load();

    h.gate.askLegalRecheck();
    await settle();

    const hits = asked();
    expect(hits, `没问到该问的端点：${JSON.stringify(net.sent)}`).toHaveLength(1);
    expect(hits[0]!.method).toBe('GET');
    expect(hits[0]!.auth).toBe('Bearer TK-1');
    expect(h.gate.legalRecheck.current().phase).toBe('needs-reconfirm');
    expect(h.gate.legalRecheck.dataEgressAllowed()).toBe(false);
    expect(h.gate.legalRecheck.current().currentVersion, '界面要展示的版本没带回来').toBe(CURRENT);
    expect(h.ui.legalReconfirmSheetState().open, '答"要补签"却没弹面板').toBe(true);
  });

  it('🔴 服务端答"就是当前这一版" ⇒ 不拦，而且**一个面板都不许出现**', async () => {
    const h = await load();
    net.mode = 'current';

    h.gate.askLegalRecheck();
    await settle();

    expect(h.gate.legalRecheck.dataEgressAllowed(), '版本没变却拦下了同步').toBe(true);
    expect(h.ui.legalReconfirmSheetState().open, '不需要补签也弹了面板').toBe(false);
  });

  it('🔴 换令牌 ⇒ 重问，且第二次带的是**新**令牌（活取值的全部意义）', async () => {
    const h = await load();

    h.gate.askLegalRecheck();
    await settle();
    h.config.writeSyncConfig({ serverUrl: BASE_URL, token: 'TK-2', password: 'pw' });
    h.gate.askLegalRecheck();
    await settle();

    const hits = asked();
    expect(hits, '换令牌后没有重问').toHaveLength(2);
    expect(hits[1]!.auth, '还在用上一个账号的令牌问').toBe('Bearer TK-2');
  });

  it('🔴 换服务端地址 ⇒ 问到**新**那台机器（两台实例的条款版本可以完全不同）', async () => {
    const h = await load();

    h.gate.askLegalRecheck();
    await settle();
    h.config.writeSyncConfig({ serverUrl: 'https://other.test', token: 'TK-1', password: 'pw' });
    h.gate.askLegalRecheck();
    await settle();

    expect(asked(BASE_URL)).toHaveLength(1);
    expect(asked('https://other.test'), '换地址后还在问旧那台').toHaveLength(1);
  });

  it('🔴 设备级同意（链 5）关着时，这一问**自己也出不了门**', async () => {
    const h = await load({ consented: false });
    expect(h.privacy.privacyConsent.networkAllowed()).toBe(false);

    h.gate.askLegalRecheck();
    await settle();

    expect(net.sent, '设备级同意还没作出就把"要不要补签"问了出去').toHaveLength(0);
    // 问不到 = `unavailable`，而按 `app-host` 的裁决它是**放行**的（"读不到"是拿不到答案，
    // 不是"要补签"）。⚠️ 这一档在移动端**不是洞**：设备级闸门此刻正拦着全部出站，
    // 同步那条路自己会给出 `consent-required`；把它读成"拦"反而会把"网络抖一下"
    // 变成"数据永久出不去"（那条文件头的整段推理）。
    expect(h.gate.legalRecheck.current().phase).toBe('unavailable');
    // 但**不许**弹一个可能永远不消失的面板。
    expect(h.gate.legalRecheck.shouldShowSheet()).toBe(false);
    expect(h.ui.legalReconfirmSheetState().open).toBe(false);
  });

  it('🔴 登出清空凭据 ⇒ 忘掉上一个人的答案（版本、面板、拦与不拦一起归零）', async () => {
    const h = await load();

    h.gate.askLegalRecheck();
    await settle();
    expect(h.gate.legalRecheck.dataEgressAllowed(), '前置：这一条要对着"拦着"的状态验').toBe(false);

    h.config.clearSyncConfig();

    expect(h.gate.legalRecheck.current().phase).toBe('anonymous');
    expect(h.gate.legalRecheck.current().currentVersion, '留着上一个人的版本号').toBeNull();
    expect(h.ui.legalReconfirmSheetState().open, '登出后面板还挂着').toBe(false);

    net.sent.length = 0;
    h.gate.askLegalRecheck();
    await settle();
    expect(net.sent, '清空后又拿旧凭据去问').toHaveLength(0);
  });
});

describe('数据出站：拦得住、放得开', () => {
  it('🔴 `checking` 是**拦**的：询问在途那一段时间里数据不许出门', async () => {
    const h = await load();
    net.mode = 'hanging';

    h.gate.askLegalRecheck();
    await flush();

    expect(h.gate.legalRecheck.current().phase).toBe('checking');
    expect(h.gate.legalRecheck.dataEgressAllowed(), '还没问到答案就放行 = 每次冷启动先推出去').toBe(
      false,
    );

    net.release?.();
    await settle();
    expect(h.gate.legalRecheck.current().phase).toBe('needs-reconfirm');
  });

  it('🔴 被拦的 `syncNow()`：新原因 + `host.sync()` **0 次** + 除询问外零出站 + 面板弹起来', async () => {
    const h = await load();

    h.gate.askLegalRecheck();
    await settle();
    expect(h.gate.legalRecheck.shouldShowSheet(), '前置：闸门没被推到"要补签"').toBe(true);

    net.sent.length = 0;
    host.syncCalls = 0;
    const status = await h.sync.syncNow();

    expect(status).toEqual({
      kind: 'error',
      reason: 'legal-reconfirm-required',
      retryable: false,
    });
    // 移动端唯一的同步出口：0 次 = 一个字节都没出去。
    expect(host.syncCalls, '没补签却把 op 推出去了').toBe(0);
    expect(nonAskEgress(), `拦下之前已经有别的出站请求：${JSON.stringify(net.sent)}`).toHaveLength(0);
    // 只写一条错误状态的话，用户读到的是"同步失败了"，而出路界面上没给。
    const sheet = h.ui.legalReconfirmSheetState();
    expect(sheet.open, '点了同步被拦下，却没把补签面板弹出来').toBe(true);
    expect(sheet.reason).toBe('required-for-action');
  });

  it('🔴 解决冲突**也是出站点**：拦下时 `host.resolveConflict()` 0 次（与 web 同两个点）', async () => {
    const h = await load();

    h.gate.askLegalRecheck();
    await settle();

    const status = await h.sync.resolveConflictNow(
      { key: 'k', localOp: {} as never, remoteOp: {} as never } as never,
      'keep-local',
    );

    // `SyncClient.resolveConflict` 会把选定那一边重新派发成一条本地 op 并 sync 一次，
    // 所以它同样是"数据出门"的那一步 —— 只拦「立即同步」按钮会留一条绕过闸门的侧门。
    expect(status).toEqual({
      kind: 'error',
      reason: 'legal-reconfirm-required',
      retryable: false,
    });
    expect(host.resolveCalls, '没补签却把解决结果推出去了').toBe(0);
  });

  it('🔴 **没问过（anonymous）⇒ 不拦**：`syncNow()` 照走（放行的默认值不能反过来变成锁）', async () => {
    const h = await load();

    const status = await h.sync.syncNow();

    expect(host.syncCalls, '没问过就把数据扣下了 —— 移动端凭据不落盘，冷启动永远是 anonymous').toBe(1);
    expect(status.kind).toBe('synced');
    expect(h.ui.legalReconfirmSheetState().open).toBe(false);
  });

  it('🔴 确认 POST 带的是**读侧那一版**（逐字），且带正整数 `acceptedAt`；成功后放开并收面板', async () => {
    const h = await load();

    h.gate.askLegalRecheck();
    await settle();
    expect(h.gate.legalRecheck.dataEgressAllowed(), '前置：这一条要对着"拦着"验').toBe(false);

    net.sent.length = 0;
    await h.ui.confirmLegalReconfirm();

    const posts = net.sent.filter((s) => s.method === 'POST');
    expect(posts, '确认没有 POST 出去').toHaveLength(1);
    const payload = JSON.parse(posts[0]!.body ?? '{}') as {
      documentVersion?: string;
      acceptedAt?: number;
    };
    // 🔴 逐字等于读侧带回来的那一版：本机自己造一个版本号，服务端会 409，
    // 而那条 409 会被记成"提交失败" —— 把"我们还没问过"伪装成"服务端拒绝了"。
    expect(payload.documentVersion).toBe(CURRENT);
    expect(typeof payload.acceptedAt).toBe('number');
    expect(payload.acceptedAt! > 0, 'acceptedAt 必须是正整数（epoch 0 会渲染成 1970 年的收据）').toBe(
      true,
    );

    expect(h.gate.legalRecheck.current().phase).toBe('clear');
    expect(h.gate.legalRecheck.dataEgressAllowed()).toBe(true);
    expect(h.ui.legalReconfirmSheetState().open, '确认成功后面板还挂着').toBe(false);
    expect(h.ui.requireLegalReconfirm()).toBe(true);
  });

  it('🔴 「稍后再说」**只收面板，绝不放开闸门**', async () => {
    const h = await load();

    h.gate.askLegalRecheck();
    await settle();
    expect(h.ui.legalReconfirmSheetState().open, '前置：面板本来就该开着').toBe(true);

    h.ui.deferLegalReconfirm();

    expect(h.ui.legalReconfirmSheetState().open).toBe(false);
    expect(
      h.gate.legalRecheck.dataEgressAllowed(),
      '「稍后再说」把闸门放开了 —— 那句话写的是"继续不同步"',
    ).toBe(false);
    // 而且它不会被"点掉"：再撞一次同步，面板必须回来。
    expect(h.ui.requireLegalReconfirm()).toBe(false);
    expect(h.ui.legalReconfirmSheetState().open).toBe(true);
    expect(h.ui.legalReconfirmSheetState().reason).toBe('required-for-action');
  });

  it('🔴 确认**失败**时不许静默收起面板：仍然拦着 + 结构化原因挂得住', async () => {
    const h = await load();

    h.gate.askLegalRecheck();
    await settle();
    net.mode = 'network-down';

    await h.ui.confirmLegalReconfirm();

    expect(h.gate.legalRecheck.current().confirmFailure).toBe('network');
    expect(h.gate.legalRecheck.dataEgressAllowed(), '提交失败却把数据放开了').toBe(false);
    // 🔴 "点了没反应"是本仓库记过最多次的一类缺陷：失败必须留在用户正看着的这一块上。
    expect(h.ui.legalReconfirmSheetState().open).toBe(true);
    expect(h.ui.legalReconfirmSheetState().submitting, '在途标记没复位').toBe(false);
  });

  it('🔴 没补签时**不建实时连接**（WS 不走 fetch，进程级那道闸罩不到它）', async () => {
    const h = await load();
    const made: RealtimeWiringOptions[] = [];
    const fakeClient = { connect: vi.fn(), dispose: vi.fn() } as unknown as RealtimeClient;
    const deps = {
      openHost: async () => ({ engine: { getClientId: () => 'dev' } }) as unknown as AppHost,
      readConfig: () => ({ serverUrl: BASE_URL, token: 'TK-1', password: 'pw' }),
      makeClient: (options: RealtimeWiringOptions) => {
        made.push(options);
        return fakeClient;
      },
      syncNow: async () => undefined,
      networkAllowed: () => true,
    };

    h.gate.askLegalRecheck();
    await settle();
    expect(h.gate.legalRecheck.shouldShowSheet(), '前置：这一条要对着"要补签"验').toBe(true);

    await h.realtime.startRealtime(deps);
    expect(made, '账号没补签却建了实时连接').toHaveLength(0);

    // 补签之后必须建起来（同一份 deps —— 默认取值器读的就是进程里那个闸门）。
    await h.ui.confirmLegalReconfirm();
    await h.realtime.startRealtime(deps);
    expect(made, '确认之后还是没连上（要等下次切前台才有实时同步）').toHaveLength(1);
    expect(fakeClient.connect).toHaveBeenCalledTimes(1);
  });
});

/*
  ──────────────────────────────────────────────────────────────────────────
  🔴 下面是**源码级**判据：调用点在不在、顺序对不对。

  为什么不写成行为用例：`sync/auto-sync.ts` 在模块顶层就 `AppState.addEventListener`
  （`react-native` 的入口是 Flow 源码，node 里连加载都过不去），`App.tsx` 与
  `LegalReconfirmSheet.tsx` 是 RN 组件而本壳没有 RN 渲染测试栈。
  那些地方**没有**能在纯 node 里跑起来的注入缝，而"有人把那道检查删了 / 挪晚了"
  恰恰是最需要失败的两种改动（与 `privacy-consent-gate.spec.ts` 同一套做法与理由）。
*/
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src');

/** 只留下**会被执行**的东西：块注释（含 JSX 的 `{/* … *\/}`）与行注释一律去掉。 */
function codeOf(file: string): string {
  return readFileSync(join(SRC, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .join('\n');
}

/** 从 `open` 处的 `{` 起做括号配平，返回**不含**外层花括号的内部文本。 */
function braceBalanced(code: string, open: number): string {
  expect(open, '找不到 `{` —— 被匹配的东西不存在').toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    if (code[i] === '}') {
      depth -= 1;
      if (depth === 0) return code.slice(open + 1, i);
    }
  }
  throw new Error('花括号没有闭合');
}

/** 取某个函数/箭头常量的**函数体**（两处坑的理由写在 privacy-consent-gate.spec.ts）。 */
function bodyOf(code: string, name: string): string {
  const at = code.indexOf(`const ${name} =`);
  const from = at >= 0 ? at : code.indexOf(`function ${name}(`);
  expect(from, `找不到 ${name} —— 调用点不存在`).toBeGreaterThanOrEqual(0);
  const afterParams = code.indexOf(')', from);
  expect(afterParams, `${name} 没有参数列表的右括号`).toBeGreaterThan(from);
  return braceBalanced(code, code.indexOf('{', afterParams));
}

/** 断言 `before` 与 `after` 都在 `text` 里，且 `before` **先**出现。 */
function assertOrdered(text: string, before: RegExp, after: RegExp, why: string): void {
  const first = text.search(before);
  const second = text.search(after);
  expect(first, `缺少 ${String(before)}：${why}`).toBeGreaterThanOrEqual(0);
  expect(second, `缺少 ${String(after)}：${why}`).toBeGreaterThanOrEqual(0);
  expect(
    first < second,
    `顺序反了：${why}（先出现的位置 ${String(first)} vs ${String(second)}）`,
  ).toBe(true);
}

describe('调用点与顺序（删掉或挪晚都会红）', () => {
  it('🔴 `ready()`：三道闸的顺序是 设备同意 → 账号补签 → 有没有可说话的对象', () => {
    const body = bodyOf(codeOf('sync/auto-sync.ts'), 'ready');
    assertOrdered(
      body,
      /privacyConsent\.networkAllowed\(\)/,
      /legalRecheck\.dataEgressAllowed\(\)/,
      '设备级同意是更前置的事实：没同意时连"要不要补签"都问不出去',
    );
    assertOrdered(
      body,
      /legalRecheck\.dataEgressAllowed\(\)/,
      /readSyncConfig\(\)/,
      '改版之后自动同步照跑 —— 手点那条有 reconfirmGate 兜住，自动这条只有这里',
    );
  });

  it('🔴 `syncNow()`：补签闸排在设备闸**之后**、`set({ busy: true })` **之前**', () => {
    const body = bodyOf(codeOf('sync/store.ts'), 'syncNow');
    assertOrdered(
      body,
      /consentGate\(\)/,
      /reconfirmGate\(\)/,
      '让一个从没被问过隐私决定的人先去处理账号条款，是在让他做一件此刻不必要的事',
    );
    assertOrdered(
      body,
      /reconfirmGate\(\)/,
      /set\(\{\s*busy:\s*true/,
      '界面会闪一次"正在同步"然后立刻失败，而真正的原因没地方说',
    );
  });

  it('🔴 两个出站点都过了第二道闸（`syncNow()` 与 `resolveConflictNow()`，与 web 同一口径）', () => {
    const code = codeOf('sync/store.ts');
    const body = bodyOf(code, 'resolveConflictNow');
    assertOrdered(
      body,
      /reconfirmGate\(\)/,
      /set\(\{\s*busy:\s*true/,
      '解决冲突会重新派发 op 并同步 —— 只拦「立即同步」等于留一条侧门',
    );
    expect(
      // 只数**调用**：`function reconfirmGate():` 那一行也含 `reconfirmGate()` 这个子串，
      // 按子串数会把定义算成第三个调用点（判据当场虚一格）。
      (code.match(/=\s*reconfirmGate\(\)/g) ?? []).length,
      '出站点只剩一个在过闸（web 是两个：syncNow + resolveConflict）',
    ).toBe(2);
  });

  it('🔴 `notifyConfigured()`：**先问补签，再**建实时通道（与 web 第 4 端口同一条顺序）', () => {
    const body = bodyOf(codeOf('sync/auto-sync.ts'), 'notifyConfigured');
    assertOrdered(
      body,
      /askLegalRecheck\(\)/,
      /startRealtime\(\)/,
      '反过来写就是"每次登录先把数据推出去、再收到要补签" —— 那道闸只剩事后弹个窗',
    );
  });

  it('🔴 `startRealtime`：补签闸排在 `stopRealtime()` **之后**（重问时不留旧连接）', () => {
    const body = bodyOf(codeOf('sync/realtime.ts'), 'startRealtime');
    assertOrdered(
      body,
      /stopRealtime\(\)/,
      /deps\.dataEgressAllowed\(\)/,
      '闸门排在 stop 之前 = 拦下时那条带着旧令牌的 WebSocket 原地留着',
    );
    assertOrdered(
      body,
      /deps\.networkAllowed\(\)/,
      /deps\.dataEgressAllowed\(\)/,
      '两道闸的先后与 `syncNow()` 那边必须一致',
    );
  });

  it('🔴 闸门订阅者两个方向都在：放行要补跑，拦下要关通道', () => {
    const body = bodyOf(codeOf('sync/auto-sync.ts'), 'startAutoSync');
    const at = body.indexOf('legalRecheck.subscribe(');
    expect(at, '没有订阅补签闸门 —— 点了确认之后没人重建实时通道').toBeGreaterThanOrEqual(0);
    const callback = braceBalanced(body, body.indexOf('{', at));
    expect(
      /dataEgressAllowed\(\)/.test(callback),
      '回调没读闸门：那是把"要不要放行"又写了一遍',
    ).toBe(true);
    expect(/startRealtime\(\)/.test(callback), '放行那一支没重建通道').toBe(true);
    expect(/notifyConfigured\(\)/.test(callback), '放行那一支没把拦下期间攒的改动补出去').toBe(true);
    expect(/stopRealtime\(\)/.test(callback), '拦下那一支没关通道').toBe(true);
    // 🔴 不许在这里调**模块那个** `notifyConfigured()`（它会重问一次 ⇒ 死循环）。
    expect(
      /^\s*notifyConfigured\(\)/m.test(callback),
      '订阅者里调了会重问的那个 notifyConfigured() —— checking → 答案 → 再问 → checking',
    ).toBe(false);
  });

  it('🔴 补签面板挂在**两个分支**上（欢迎页期间也要能被拦）', () => {
    const code = codeOf('App.tsx');
    expect(/const legalReconfirmSheet = <LegalReconfirmSheet \/>;/.test(code), '没有创建面板元素').toBe(
      true,
    );
    expect(
      (code.match(/\{legalReconfirmSheet\}/g) ?? []).length,
      '面板没挂满两个分支（首启时用户看不到拦他的那一块）',
    ).toBe(2);
  });

  it('🔴 登出这一侧的接线：清空凭据要真的通知出去', () => {
    const code = codeOf('sync/config.ts');
    const body = bodyOf(code, 'clearSyncConfig');
    expect(/for \(const listener of clearedListeners\)/.test(body), '清空时没有通知订阅者').toBe(true);
    expect(
      /onCredentialsCleared\(\(\) => \{\s*legalRecheck\.reset\(\);/.test(codeOf('legal-recheck/gate.ts')),
      '闸门没有订阅"凭据被清空" —— 上一个人的答案会留在面板上',
    ).toBe(true);
  });
});

describe('补签面板的界面纪律（源码级）', () => {
  const code = codeOf('screens/LegalReconfirmSheet.tsx');

  it('🔴 一个主操作 + 一条**从属**的「稍后再说」，且两者接的是不同的函数', () => {
    const actionAt = code.indexOf("t('common.legal.reconfirm.action')");
    const laterAt = code.indexOf("t('common.legal.reconfirm.later')");
    expect(actionAt, '没有「我已读完并确认」').toBeGreaterThanOrEqual(0);
    expect(laterAt, '没有「稍后再说」').toBeGreaterThanOrEqual(0);
    expect(actionAt < laterAt, '「稍后再说」排在主操作之前（读屏顺序会决定第一下命中谁）').toBe(true);

    const deferBlock = code.slice(laterAt, laterAt + 260);
    expect(
      /onPress=\{deferLegalReconfirm\}/.test(deferBlock),
      '「稍后再说」接的不是 defer（接成 confirm 就是替用户按下确认）',
    ).toBe(true);
    // 🔴 从属：ghost 而不是与主按钮同等的 secondary。
    expect(/tone="ghost"/.test(deferBlock), '「稍后再说」不是从属语气').toBe(true);
    expect(/tone="danger"/.test(code), '把推迟画成了惩罚').toBe(false);
  });

  it('🔴 系统返回手势 = 推迟，不是确认', () => {
    expect(/onRequestClose=\{deferLegalReconfirm\}/.test(code), '返回键没接推迟').toBe(true);
    // 注意不能写成"含 confirm 字样即红"—— `deferLegalReconfirm` 本身就带 Reconfirm。
    expect(/onRequestClose=\{confirmLegalReconfirm\}/.test(code), '返回键被接成了确认').toBe(false);
  });

  it('🔴 链接排在按钮**外面**，且都在 `t(...)` 之后（链在按钮里时"我想先读"会变成"我已同意"）', () => {
    const termsAt = code.indexOf('links.terms');
    const actionAt = code.indexOf("t('common.legal.reconfirm.action')");
    expect(termsAt, '没有条款链接').toBeGreaterThanOrEqual(0);
    expect(termsAt < actionAt, '链接排到了按钮之后/之内').toBe(true);
    expect(/Linking\.openURL\(/.test(code)).toBe(true);
    expect(code, '出现了 canOpenURL 预检 —— 见隐私面板同一条理由').not.toMatch(/canOpenURL/);
  });

  it('🔴 界面里**一个硬编码文案都没有**（词条是 `common.legal.reconfirm.*` 那一族）', () => {
    // 注释已经剥掉 ⇒ 剩下的源码里出现汉字就是绕过 `@heyta/i18n` 的裸文案。
    // ⚠️ 唯一放行 `console.*` 那几行：那是给排查者看的日志，不是给用户看的界面，
    //    `check:ui-language` 拦的是后者（`PrivacyConsentSheet` 同一条口径）。
    const rendered = code
      .split('\n')
      .filter((line) => !/console\./.test(line))
      .join('\n');
    expect(/[一-鿿]/.test(rendered), '面板里有硬编码中文文案').toBe(false);
    for (const key of [
      'common.legal.reconfirm.title',
      'common.legal.reconfirm.intro',
      'common.legal.reconfirm.readFirst',
      'common.legal.reconfirm.localDataSafe',
      'common.legal.reconfirm.later',
      'common.legal.reconfirm.action',
      'common.legal.reconfirm.pending',
      'common.legal.reconfirm.failNetwork',
      'common.legal.reconfirm.failUnauthorized',
      'common.legal.reconfirm.failRejected',
    ]) {
      expect(code.includes(`t('${key}')`), `面板没有用到词条 ${key}`).toBe(true);
    }
  });

  it('🔴 在途时主按钮禁用（连点会打两次 POST，第二次的版本未必还是界面那一版）', () => {
    const actionAt = code.indexOf("t('common.legal.reconfirm.action')");
    const own = code.slice(Math.max(0, actionAt - 500), actionAt + 400);
    expect(/disabled=\{submitting\}/.test(own), '主按钮没有在途禁用').toBe(true);
  });
});
