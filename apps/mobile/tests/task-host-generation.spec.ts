/**
 * 宿主换代：`resetTaskHostCache()` 之后，界面必须能重新取到宿主
 * ==========================================================================
 *
 * 对应崩溃审计 2026-11-08 · §H.4 第 2 层（U16 那条 P0 的另一半）。
 *
 * ## 病情（修之前是真的会这样）
 *
 * 19 个屏幕原来各自写着
 *
 *     const [host, setHost] = useState<AppHost | null>(null);
 *     useEffect(() => { void openTaskHost().then(setHost); }, []);
 *
 * 依赖数组是空的 ⇒ 那个 effect **一辈子只跑一次**。于是本机明文被销毁之后
 * （主动注销，或**别的设备注销后同步读到信号** —— 后一条路根本不导航），
 * `resetTaskHostCache()` 把单例作废、把 adapter `close()` 掉，而屏幕手里
 * 还攥着那个对象：下一次读/写落到 `AdapterDestroyedError`，**而且不会自己好**。
 *
 * ## 这个文件钉的两件事
 *
 * 1. **换代可被观察**：`resetTaskHostCache()` 必须真的 `notify`，且订阅者抛错
 *    不能把别的订阅者挡在门外（一个坏界面不许让整机不换代）。
 * 2. **不许改回快照写法**：源码门禁扫 `src/screens` 与 `src/ai`，
 *    一旦有人再写 `useState<AppHost`、或在 `[]` 依赖的 effect 里调
 *    `openTaskHost(`，这里立刻红。
 *
 * 🔴 第 2 条不是洁癖：第 1 条只证明"机制在"，而"某个新屏忘了用钩子"才是
 * 这条 P0 真正的复发形态，且它在类型层完全看不出来。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { emptyState } from '@heyta/op-log';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({
  opened: [] as Array<Record<string, unknown>>,
  dispatched: [] as number[],
  failNext: false,
}));

vi.mock('@heyta/app-host', () => ({
  openAppHost: async () => {
    if (platform.failNext) {
      platform.failNext = false;
      throw new Error('open failed');
    }
    const generation = platform.opened.length + 1;
    const host = {
      generation,
      closed: false,
      getState: () => ({ tasks: [], generation }),
      dispatch: async () => {
        // 🔴 关闭之后再写就**抛** —— 这就是真实 adapter 销毁后的行为。
        //    它让"路由绑在旧实例上"这件事**可观测**：真机上那一屏错误就是它的用户形态。
        if ((host as { closed: boolean }).closed) {
          throw new Error('AdapterDestroyedError: 这一代宿主已经销毁');
        }
        platform.dispatched.push(generation);
      },
      dispatchChecked: async () => undefined,
      close() {
        (host as { closed: boolean }).closed = true;
      },
    };
    platform.opened.push(host);
    return host;
  },
}));

// `open-host.ts` 的其余依赖全部替换成静态实现 —— 本文件要验的是**换代协议**，
// 不是这些依赖的行为（它们各自有专门的 spec）。
vi.mock('../src/sync/config', () => ({ readSyncConfig: () => ({}) }));
vi.mock('../src/privacy/consent-gate', () => ({ consentFetch: (() => {}) as unknown }));
vi.mock('../src/sync/write-signal', () => ({ emitLocalWrite: () => {} }));
vi.mock('../src/widgets/publish-source', () => ({ hostPublishSource: () => ({}) }));
vi.mock('../src/widgets/publish', () => ({ publishWidgetSnapshot: async () => {} }));
vi.mock('../src/lib/vault-secure-storage', () => ({
  isVaultRootAutoUnlockDisabled: async () => false,
  loadVaultRootKey: async () => undefined,
}));
/**
 * 捕获 `bindMobileOplogBase(...)` 收到的那个对象 —— 本文件要验的正是
 * **擦除之后路由还是不是可用的、且落没落到新一代**。
 */
const router = vi.hoisted(() => ({ bound: undefined as unknown }));
vi.mock('../src/share/wiring', () => ({
  bindMobileOplogBase: (next: unknown) => {
    router.bound = next;
  },
  currentState: () => ({ tasks: [] }),
  dispatchChecked: async () => undefined,
  dispatchIntent: async () => undefined,
}));
vi.mock('../src/db/op-sqlite-driver', () => ({ opSqliteDriverFactory: () => ({}) }));

const {
  getTaskHostEpoch,
  openTaskHost,
  resetTaskHostCache,
  subscribeTaskHostEpoch,
  getOpenTaskHostIfReady,
} = await import('../src/db/open-host');

/**
 * 换代通知被推到下一个宏任务（理由见 `open-host.ts` 那段「为什么不能同步发」）。
 * ⚠️ 它同时意味着**计时器会跨用例串味**：上一条 `resetTaskHostCache()` 排的那一发，
 * 会在下一条 flush 时落到下一条刚订阅的 listener 上（实测：期望 1 次、实得 2 次）。
 * 所以前后都要排空。
 */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(async () => {
  await flush();
});

afterEach(async () => {
  await flush();
  platform.failNext = false;
});

describe('宿主换代协议', () => {
  it('换代计数在 reset 之后递增（否则订阅者永远不知道要重取）', () => {
    const before = getTaskHostEpoch();
    resetTaskHostCache();
    expect(getTaskHostEpoch()).toBe(before + 1);
  });

  it('reset 必须真的通知订阅者（延后一个宏任务）', async () => {
    const listener = vi.fn();
    const off = subscribeTaskHostEpoch(listener);
    resetTaskHostCache();
    await flush();
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });

  it('🔴 通知必须是**延后**的，不能在同一 tick 里发', async () => {
    // 【为什么单独钉这一条】它防的是一个已经被真机量到的回归：
    // 同步发通知 ⇒ 仍挂载的 4 张 tab 在同一 tick 重开宿主 ⇒ 与 `adapter.destroy()`
    // 的收尾撞上 ⇒ 注销后第一屏报「打开本地数据库失败」（ técnica 见 open-host.ts 注释）。
    // 库本身是好的（integrity ok / ops=0 / 重启正常），所以**任何只测数据的判据都看不见它**。
    const listener = vi.fn();
    const off = subscribeTaskHostEpoch(listener);
    resetTaskHostCache();
    expect(listener, '同步发通知了：teardown 还没退栈就重开，真机上会报「打开本地数据库失败」').not.toHaveBeenCalled();
    await flush();
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });

  it('退订之后不再收到通知', async () => {
    const listener = vi.fn();
    const off = subscribeTaskHostEpoch(listener);
    off();
    resetTaskHostCache();
    await flush();
    expect(listener).not.toHaveBeenCalled();
  });

  it('一个订阅者抛错不许挡住其余订阅者', async () => {
    const good = vi.fn();
    const offBad = subscribeTaskHostEpoch(() => {
      throw new Error('界面自己坏了');
    });
    const offGood = subscribeTaskHostEpoch(good);
    // 换代本身不许因为某个界面坏了而失败。
    expect(() => resetTaskHostCache()).not.toThrow();
    await flush();
    expect(good).toHaveBeenCalledTimes(1);
    offBad();
    offGood();
  });

  it('reset 之后再取宿主拿到的是**新**实例，旧的那个被关掉', async () => {
    const first = await openTaskHost();
    resetTaskHostCache();
    // 作废之后"就绪快照"必须立刻为空，否则界面会从旧值渲染一帧。
    expect(getOpenTaskHostIfReady()).toBeUndefined();
    const second = await openTaskHost();
    expect(second).not.toBe(first);
    // ⚠️ 断言**原始**宿主，不断言 `openTaskHost()` 的返回值：
    //    后者是 `withWriteSignal(host)` 的 `{...host}` 展开，`closed` 是按值抄过去的布尔，
    //    永远不会跟着变（第一版就这么写错，红在"expected false to be true"）。
    expect((platform.opened[0] as { closed: boolean }).closed).toBe(true);
  });

  it('🔴 擦除之后共享写路由**仍然可用**，并落到新一代宿主上', async () => {
    // 【真机依据（2026-11-08 · §H.9.9）】远端擦除之后，任务屏是一整屏
    // 「这个界面出错了 / 移动端宿主尚未打开，写路由无处可落」，
    // 而且**变异版与修复版表现一致** ⇒ 它独立于"屏幕持有旧实例"。
    // 根因：`resetTaskHostCache()` 会把路由 `bindMobileOplogBase(undefined)` 摘掉，
    // 新宿主就绪之前那段窗口里任何一次写都落进守卫。
    const first = await openTaskHost();
    // ⚠️ 用**相对**计数，不用绝对值：`platform.opened` 是跨用例累加的模块状态。
    const rawFirst = platform.opened[platform.opened.length - 1] as { closed: boolean };
    const openedBeforeReset = platform.opened.length;
    expect(router.bound, '打开宿主后必须装配路由').toBeTruthy();

    resetTaskHostCache();
    await flush();

    // ① 路由不许被摘成空 —— 摘掉就是那个窗口。
    expect(router.bound, '擦除把路由摘掉了 ⇒ 新宿主就绪前任何一次写都会报「写路由无处可落」')
      .toBeTruthy();

    const base = router.bound as {
      dispatch: (intent: unknown) => Promise<void>;
      getState: () => { generation?: number };
    };
    // ② **同步读**在窗口里不许抛。真机上那一屏「这个界面出错了 / 写路由无处可落」
    //    就是它抛出来的 —— 而那一刻"这台设备上没有数据"本身就是事实，正确答案是空态。
    //    ⚠️ 必须排在 `dispatch` 之前：dispatch 会把新一代开出来，窗口就没了。
    expect(() => base.getState(), '窗口里同步读抛了 ⇒ 真机上就是一整屏「这个界面出错了」').not.toThrow();
    // 与**规范空态**逐字比对（`MaterializedState` 的各表是映射不是数组，
    // 所以按形状去断言"tasks 是空数组"会写错 —— 第一版就这么写错了）。
    expect(base.getState(), '窗口里读到的不是规范空态 ⇒ 要么还在抛，要么把旧数据漏了出来').toEqual(
      emptyState(),
    );

    // ③ 异步写**不许抛**。修复前 `router.bound` 是 `undefined`（被摘掉）⇒ 这里会
    //    抛 TypeError / 「写路由无处可落」。
    await expect(base.dispatch({ type: 'noop' })).resolves.toBeUndefined();

    // ③ 而且必须落到**新一代**：`dispatch` 里那次 `await openTaskHost()` 应当把新宿主开出来。
    //    ⚠️ 不能靠 `getState().generation` 判 —— 那个 `getState` 已经被写信号包装层
    //    换成 `shareAwareState`（本文件 mock 掉的），读不到原始宿主的字段。
    //    可观测的事实是平台侧"又开了一代"，以及那新一代没被关掉。
    expect(
      platform.opened.length,
      'dispatch 没有把新一代宿主开出来 ⇒ 它还在用旧那一代',
    ).toBe(openedBeforeReset + 1);
    expect((platform.opened[platform.opened.length - 1] as { closed: boolean }).closed).toBe(false);

    // ④ 前提：旧那一代确实被关掉了（否则上面两条可能是因为"旧宿主还活着"才通过的）。
    expect(rawFirst.closed, '旧那一代没被关掉 ⇒ 这条判据的对照不成立').toBe(true);
  });

  it('打开失败不吞：错误会浮到调用方（钩子据此回灌界面的错误态）', async () => {
    resetTaskHostCache();
    platform.failNext = true;
    await expect(openTaskHost()).rejects.toThrow('open failed');
    // 失败之后必须允许重试：`pending` 要被清掉，否则下一次永远拿到同一个 rejected promise。
    const recovered = await openTaskHost();
    expect(recovered).toBeDefined();
  });
});

/**
 * 源码门禁。
 *
 * 扫的是"写法"，不是"行为" —— 因为这条缺陷的复发形态是**新写一个屏**时
 * 顺手抄了旁边那个屏的一段 `useEffect`，而类型系统对此完全沉默。
 */
describe('宿主获取的写法门禁', () => {
  const ROOTS = ['src/screens', 'src/ai'];

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...walk(full));
      else if (/\.tsx?$/.test(full)) out.push(full);
    }
    return out;
  }

  const files = ROOTS.flatMap((root) => walk(join(process.cwd(), root)));

  /**
   * 去掉注释再判。
   *
   * 🔴 为什么必须去：这些文件的注释里**引用**了旧写法（"原来这里是
   * `useState<AppHost>()`"）。不去注释的话，一道门禁会因为**说明文字**变红 ——
   * 而"会把正确写法判红的门禁很快会被绕过而不是被遵守"（AGENTS §7 元规则 2 的反面）。
   */
  function stripComments(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  }

  it('扫描面不为空（否则下面两条判据恒真）', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('屏幕不得把宿主存进 useState —— 那是快照，换代后必死', () => {
    const offenders = files.filter((file) =>
      /useState<\s*AppHost/.test(stripComments(readFileSync(file, 'utf8'))),
    );
    expect(
      offenders.map((file) => file.replace(`${process.cwd()}/`, '')),
      '这些文件把 AppHost 存进了 useState：请改用 useTaskHost()（见 src/db/use-task-host.ts）',
    ).toEqual([]);
  });

  it('屏幕不得在空依赖的 effect 里直接调 openTaskHost', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = stripComments(readFileSync(file, 'utf8'));
      // 逐段找 `useEffect(...)`，看它是否同时满足「含 openTaskHost」与「依赖数组为 []」。
      const re = /useEffect\(\s*\(\s*\)\s*=>\s*\{/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(text)) !== null) {
        let depth = 0;
        let end = match.index;
        for (let i = text.indexOf('{', match.index); i < text.length; i += 1) {
          if (text[i] === '{') depth += 1;
          else if (text[i] === '}') {
            depth -= 1;
            if (depth === 0) {
              end = i;
              break;
            }
          }
        }
        const body = text.slice(match.index, end);
        const tail = text.slice(end, end + 40);
        if (body.includes('openTaskHost(') && /^\}\s*,\s*\[\s*\]\s*\)/.test(tail)) {
          offenders.push(file.replace(`${process.cwd()}/`, ''));
          break;
        }
      }
    }
    expect(
      offenders,
      '这些文件在空依赖 effect 里取宿主：宿主换代后不会再跑，请改用 useTaskHost()',
    ).toEqual([]);
  });
});
