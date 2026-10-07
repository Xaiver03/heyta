/**
 * 批次 E3 —— 「注销账号」面板（Web 端）
 * =====================================
 *
 * 这里跑的是**真组件 + 真 app-host 协议层**，只 stub `fetch`：
 * 要证的正是"界面状态机 → 协议结论 → 要不要清本机"这一段接线。
 * 把 `closeAccountAndEraseLocal` mock 掉就什么都没测
 * （协议那一层由 `packages/app-host/tests/account-closure.spec.ts` 钉）。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerLocalEraser, lastErasureReports } from '@heyta/app-host';
import type { DbDestroyReport } from '@heyta/storage';
import { I18nProvider, en, zhCN, type MessageKey } from '@heyta/i18n';

import { CloseAccountPanel } from '../src/features/settings/CloseAccountPanel.js';
import { useAuthStore } from '../src/features/auth/store.js';
import { useSyncStore } from '../src/features/sync/store.js';

const SERVER = 'https://sync.example.test';
const TOKEN = 'ui-token';

/** 每条失败句子都必须同时说这两件事（见 CloseAccountPanel 文件头第 3 条）。 */
const FAILS_WITHOUT_DELETING = ['账号还在', '本机数据也没动'];

let container: HTMLDivElement;
let root: Root;
let previousEraser: ReturnType<typeof registerLocalEraser>;
let erased: number;

function response(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as Response;
}

/** 默认桩：记下每一次请求，返回一个**不会被当成成功**的响应。 */
function stubFetch(reply: () => Response): typeof fetch {
  const impl = vi.fn(async (input: string | URL | Request) => {
    void String(input);
    return reply();
  });
  vi.stubGlobal('fetch', impl);
  return impl as unknown as typeof fetch;
}

function render(): void {
  act(() => {
    root.render(
      <I18nProvider locale="zh-CN">
        <CloseAccountPanel />
      </I18nProvider>,
    );
  });
}

function find<T extends Element>(selector: string): T | null {
  return container.querySelector<T>(selector);
}

function must<T extends Element>(selector: string): T {
  const found = find<T>(selector);
  if (found === null) throw new Error(`缺少 ${selector}`);
  return found;
}

/** React 的受控 checkbox 走 click（不是直接改 `.checked`）。 */
async function click(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function ack(): Promise<void> {
  await click(must('#close-account-ack'));
}

/** 打勾 → 第一段 → 第二段。三段都点一遍是唯一能走到请求的序列。 */
async function confirmClosure(): Promise<void> {
  await ack();
  await click(must('[data-testid="close-account-open"]'));
  await click(must('[data-testid="close-account-confirm"]'));
}

function result(): { disposition: string | null; text: string } {
  const node = find<HTMLElement>('[data-testid="close-account-result"]');
  return { disposition: node?.dataset['disposition'] ?? null, text: node?.textContent ?? '' };
}

function requests(impl: typeof fetch): string[] {
  return vi.mocked(impl).mock.calls.map(([input, init]) => `${String(init?.method ?? 'GET')} ${String(input)}`);
}

/**
 * 重挂一次。
 *
 * ⚠️ 一个用例里跑**两轮**注销时必须重挂：面板自己的 `acknowledged / confirming / done`
 * 是组件内状态，第二轮如果复用同一个实例，勾已经是打上的、再点一次反而是**取消**，
 * 于是"找不到按钮"这种症状看着像产品坏了，实际是探针留下的状态（§7 第 83 条同一课）。
 */
function remount(): void {
  act(() => {
    root.unmount();
  });
  root = createRoot(container);
  render();
}

beforeEach(() => {
  erased = 0;
  previousEraser = registerLocalEraser(async (): Promise<DbDestroyReport[]> => {
    erased += 1;
    return [{ target: 'stub', containerRemoved: true, storesCleared: 4 }];
  });
  useSyncStore.setState({ baseUrl: SERVER, token: TOKEN, signInOpen: false });
  stubFetch(() => response(500, { error: 'unused default' }));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  render();
});

afterEach(() => {
  registerLocalEraser(previousEraser);
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
  useSyncStore.setState({ baseUrl: '', token: undefined, signInOpen: false });
  useAuthStore.getState().reset();
});

describe('CloseAccountPanel', () => {
  it('🔴 未登录时显示可执行的登录入口，不摆注销控件', async () => {
    // 不重挂，只翻 store：面板必须订阅凭据变化，并把账号动作切换成登录入口。
    await act(async () => {
      useSyncStore.setState({ token: undefined });
    });
    expect(find('[data-testid="close-account-panel"]')).not.toBeNull();
    expect(find('[data-testid="close-account-needs-sign-in"]')).not.toBeNull();
    expect(find('[data-testid="close-account-needs-sign-in-action"]')).not.toBeNull();
    expect(find('#close-account-ack')).toBeNull();
    await click(must('[data-testid="close-account-needs-sign-in-action"]'));
    expect(useSyncStore.getState().signInOpen).toBe(true);
  });

  it('🔴 没打那个勾 ⇒ 连"注销"按钮都不存在，更不会发请求', () => {
    expect(find('[data-testid="close-account-open"]')).toBeNull();
    expect(find('[data-testid="close-account-confirm"]')).toBeNull();
    expect(requests(fetch)).toEqual([]);
  });

  it('🔴 两段式：打勾→第一段→确认按钮，**按到第一段时还没发任何请求**', async () => {
    await ack();
    expect(find('[data-testid="close-account-open"]')).not.toBeNull();
    expect(find('[data-testid="close-account-confirm"]')).toBeNull();

    await click(must('[data-testid="close-account-open"]'));
    expect(find('[data-testid="close-account-confirm"]')).not.toBeNull();
    expect(requests(fetch), '第一段就把注销发出去 ⇒ 两段式是装饰').toEqual([]);
  });

  it('确认后：DELETE /api/account + Bearer，说"本地副本也已清除"，本机销毁调用一次，登录态归零', async () => {
    const impl = stubFetch(() => response(200, { success: true }));
    await confirmClosure();

    expect(requests(impl)).toEqual([`DELETE ${SERVER}/api/account`]);
    const shown = result();
    expect(shown.disposition).toBe('closed-and-erased');
    expect(shown.text).toContain('本地副本也已清除');
    // 作用域那句话不许漏：备份与其它设备不在这次动作里。
    expect(shown.text).toContain('备份');
    expect(shown.text).not.toMatch(/彻底销毁|所有设备/);
    expect(erased).toBe(1);
    expect(useAuthStore.getState().status.kind).toBe('signed-out');
  });

  it('🔴 服务端 5xx ⇒ 说"账号还在 / 本机没动"，销毁器一次都不调用', async () => {
    await confirmClosure();

    const shown = result();
    expect(shown.disposition).toBe('not-closed');
    for (const needle of FAILS_WITHOUT_DELETING) expect(shown.text).toContain(needle);
    expect(erased, '服务端没删成却清了本机 = 无声的数据丢失').toBe(0);
  });

  it.each([
    ['unauthorized（401）', () => response(401, { error: 'Token revoked' })],
    ['rate-limited（429）', () => response(429, { error: 'slow down' })],
    ['断网', () => {
      throw new TypeError('Failed to fetch');
    }],
  ])('🔴 失败原因 %s 各有各的句子，且都不许出现"已注销/已清除"', async (_label, reply) => {
    stubFetch(reply);
    await confirmClosure();

    const shown = result();
    expect(shown.disposition).toBe('not-closed');
    expect(shown.text.length, '没有句子 ⇒ 词条表漏了这一支').toBeGreaterThan(0);
    for (const needle of FAILS_WITHOUT_DELETING) expect(shown.text).toContain(needle);
    expect(shown.text).not.toMatch(/已注销|已清除/);
    expect(erased).toBe(0);
  });

  it('🔴 唯一"状态未知"那一支（2xx 但形状不对）不许说成"账号还在"，也不许说成已删', async () => {
    // 这一支服务端回了我们看不懂的东西 —— 账号**可能**已经没了。
    // 把它写成"账号还在"是一句伪装的定心丸，而用户下一步可能是"那我再点一次"
    // 或者"那我先不用管"，两个动作在账号其实已注销时都不对。
    stubFetch(() => response(200, { success: false }));
    await confirmClosure();

    const shown = result();
    expect(shown.disposition).toBe('not-closed');
    expect(shown.text).toContain('可能还在');
    expect(shown.text).toContain('本机数据也没动');
    expect(shown.text).not.toMatch(/已注销|已清除/);
    expect(erased, '状态未知就把本机清了，是最坏的一种"替用户决定"').toBe(0);
  });

  it('本机"全没清"与"部分没清"是两句不同的话', async () => {
    stubFetch(() => response(200, { success: true }));

    registerLocalEraser(async () => {
      erased += 1;
      throw new Error('OPFS 被占着');
    });
    await confirmClosure();
    const failed = result();
    expect(failed.disposition).toBe('closed-erase-failed');
    expect(failed.text).toContain('没能清干净');
    expect(failed.text).toContain('账号已注销');

    remount();
    registerLocalEraser(async () => {
      erased += 1;
      return [
        { target: 'a', containerRemoved: true, storesCleared: 1 },
        { target: 'b', containerRemoved: false, reason: '占着', storesCleared: 0 },
      ];
    });
    await confirmClosure();
    const partial = result();
    expect(partial.disposition).toBe('closed-erase-partial');
    expect(partial.text).toContain('只清掉了一部分');
    expect(partial.text).not.toBe(failed.text);
  });

  it('用到的每个词条在中英两栏都存在（改一边必漏另一边的老账）', () => {
    const keys = (Object.keys(zhCN) as MessageKey[]).filter((k) =>
      k.startsWith('common.accountClosure.'),
    );
    expect(keys.length, '词条一条都没有 ⇒ 上面的断言全在空转').toBeGreaterThan(10);
    for (const key of keys) {
      expect(en[key], `英文漏了 ${key}`).toBeTruthy();
      // 中文句子里有汉字、英文句子纯拉丁：这条挡"只改一栏"的漂移。
      expect(/[\u4e00-\u9fff]/.test(en[key] ?? ''), `英文栏夹了中文：${key}`).toBe(false);
      expect(/[\u4e00-\u9fff]/.test(zhCN[key] ?? ''), `中文栏没写中文：${key}`).toBe(true);
    }
  });

  it('🔴 每一种"没注销成功"都同时说清账号与本机两件事', () => {
    // 这一条是被本轮那次实测逼出来的：八句 `failed.*` 里有七句写了"本机数据也没动"，
    // 唯一没写的那句是"服务端回的内容认不出来" —— 而它恰恰是最需要说清的一档
    // （账号**状态未知**，用户唯一能确定的只能是本机没被碰）。
    // 逐条断言而不是只测那一支：新增一条 `failed.*` 时它会自己进这个集合。
    const failedKeys = (Object.keys(zhCN) as MessageKey[]).filter((k) =>
      k.startsWith('common.accountClosure.failed.'),
    );
    // 前提：空集合上的 for 永远绿，所以先数出分母。
    expect(failedKeys.length, '一条 failed.* 都没有 ⇒ 这条判据在空转').toBeGreaterThanOrEqual(8);
    for (const key of failedKeys) {
      expect(zhCN[key], `${key} 没说账号还在/可能还在`).toMatch(/账号还在|账号可能还在/);
      expect(zhCN[key], `${key} 没说本机数据没动`).toMatch(/本机数据也没动/);
      expect(en[key], `${key} does not state the account is intact`).toMatch(
        /account is intact|account may still exist/i,
      );
      expect(en[key], `${key} does not state nothing on this device changed`).toMatch(
        /nothing on this device changed/i,
      );
    }
  });
});

/**
 * 🔴 **桌面壳那一档存储的销毁，是由这个界面按下去的**（E2 的"macOS 界面级"那一格，页侧半）
 * ================================================================================
 *
 * 为什么单独开这一组：上面每一条都用 `registerLocalEraser` 塞了一个**替身销毁器**，
 * 所以它们证的是"界面 → 页侧那个 realm 的账"。而 macOS / Windows 壳里，用户那份可读明文
 * **住在壳自己的库里**（`resolveStorageBackend() === 'shell'`），页侧要拿销毁凭据只有一条路：
 * 往宿主注入的端口发那一发 `oplog-destroy`。
 *
 * 那个 seam 以前没有一条判据跨过：
 * · `packages/app-host/tests/host-storage-erasure.spec.ts` ①–⑨ 用**手造的端口替身**直接调
 *   `eraseHostStoragePortData()`，它不知道有没有人按下注销；
 * · `apps/desktop-macos/Sources/heyta-smoke/main.swift` 的 b 段证明的是**壳收到那一发会把文件删掉**，
 *   它发的是硬编码字符串。
 * ⇒ 两头各自成立，中间那段"用户点了注销 ⇒ 那一发真的出去了 ⇒ 壳的回答真的进了用户读到的那句话"
 *   没有任何一层在守。下面三条钉的就是这段：
 *   ① 按下确认后端口**恰好收到一发** `oplog-destroy`，且壳报的凭据原样进账；
 *   ② 壳说"删不掉"时界面**不许**说两件事都成了（要走 `closed-erase-partial`）；
 *   ③ 服务端没删成时**端口一条都不许收到** —— "无声数据丢失"那条不变量对壳那一档同样成立。
 */
describe('CloseAccountPanel × 宿主存储端口（桌面壳那一档明文）', () => {
  const SHELL_FILE = 'fake-shell/heyta.sqlite';
  let sent: unknown[];

  /** 壳侧端口的替身：收到 `oplog-destroy` 就按 `reply` 回一包（微任务，模拟异步边界）。 */
  function installPort(reply: () => unknown): void {
    sent = [];
    const listeners: ((event: { data: unknown }) => void)[] = [];
    const port = {
      postMessage: (message: unknown) => {
        sent.push(message);
        queueMicrotask(() => {
          for (const listener of [...listeners]) listener({ data: reply() });
        });
      },
      addEventListener: (_type: string, listener: (event: { data: unknown }) => void) => {
        listeners.push(listener);
      },
    };
    Object.defineProperty(window, '__heytaHostStoragePort', {
      value: port,
      configurable: true,
      writable: true,
    });
  }

  afterEach(() => {
    delete (window as unknown as { __heytaHostStoragePort?: unknown }).__heytaHostStoragePort;
  });

  it('① 按下确认 ⇒ 端口恰好收到一发 oplog-destroy，壳报的凭据原样进账', async () => {
    installPort(() => ({
      type: 'oplog-destroyed',
      report: { target: SHELL_FILE, containerRemoved: true, storesCleared: 7 },
    }));
    const impl = stubFetch(() => response(200, { success: true }));
    await confirmClosure();

    // 🔴 这一发必须是**恰好一发**：发两次会在壳里第二次报"库不存在"，把那一档的账污染成 false。
    expect(sent, `端口收到的不是恰好一发 oplog-destroy`).toEqual([{ type: 'oplog-destroy' }]);
    expect(requests(impl)).toEqual([`DELETE ${SERVER}/api/account`]);

    const targets = lastErasureReports().map((r) => r.target);
    expect(targets, `销毁账上缺档：${targets.join(', ')}`).toEqual(expect.arrayContaining(['stub', SHELL_FILE]));
    // 壳那句话不许被折叠成布尔：库路径与清了几个 store 都得留着。
    const shell = lastErasureReports().find((r) => r.target === SHELL_FILE);
    expect(shell).toEqual({ target: SHELL_FILE, containerRemoved: true, storesCleared: 7 });
    expect(result().disposition).toBe('closed-and-erased');
  });

  it('🔴 ② 壳说"文件被占着删不掉" ⇒ 界面不许说两件事都成了', async () => {
    installPort(() => ({
      type: 'oplog-destroyed',
      report: {
        target: SHELL_FILE,
        containerRemoved: false,
        reason: 'database-delete-failed: file-in-use',
        storesCleared: 0,
      },
    }));
    stubFetch(() => response(200, { success: true }));
    await confirmClosure();

    expect(sent).toEqual([{ type: 'oplog-destroy' }]);
    expect(
      result().disposition,
      `壳没删成却被判成 ${String(result().disposition)} —— 页侧替身那档的成功把壳那一档盖掉了`,
    ).toBe('closed-erase-partial');
    expect(result().text).not.toContain('本地副本也已清除');
  });

  it('🔴 ③ 服务端 5xx ⇒ 端口一条都不许收到（注销没成的设备不该被清）', async () => {
    installPort(() => ({
      type: 'oplog-destroyed',
      report: { target: SHELL_FILE, containerRemoved: true, storesCleared: 7 },
    }));
    stubFetch(() => response(500, { error: 'boom' }));
    await confirmClosure();

    expect(sent, '服务端没删成却向壳要了一次销毁 = 账号还在而明文被清掉').toEqual([]);
    expect(lastErasureReports().map((r) => r.target)).not.toContain(SHELL_FILE);
    expect(result().disposition).not.toBe('closed-and-erased');
  });
});
