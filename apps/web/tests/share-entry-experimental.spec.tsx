/**
 * 共享入口的实验开关（产品裁决 P-1）
 * ==================================
 *
 * ## 这文件钉的是什么
 *
 * `docs/plans/collaboration-shared-lists.md` §9.2 P-1：共享清单的**元数据面**（邀请 / 角色 /
 * 转让）今天全链都在，而**内容面还没交付到界面上**（下行腿 2026-10-21 的 M1 接上了，
 * 但任务与清单的写路径仍进个人 op-log ⇒ 成员那边看不到这条共享任务，评论区因此点不进去），
 * 也就是说两个人互相看不到对方的改动。入口因此从"看起来可用"降级成"默认不可达 + 一条措辞
 * 明确的实验开关"。
 *
 * 🔴 三层各钉一件事，缺任何一层都会留一格假绿：
 *
 * | 层 | 钉住 | 谁能把它改坏 |
 * |---|---|---|
 * | `lib/share-experimental.ts` | **默认值是关**；只认 `'1'/'0'`；读不到不崩 | 有人把 `DEFAULT_ENABLED` 顺手翻成 `true` |
 * | `SyncSettingsPanel` | 开关**渲染得出、点得动、措辞说得出缺陷** | 有人把那句话精简成"启用共享清单" |
 * | 整个 `<App />` | 前置条件**全齐**时入口仍然不出现 | 有人把第三道条件从那个 `&&` 里删掉 |
 *
 * ## 第三层为什么要先跑"开关打开 ⇒ 入口在"
 *
 * 那是**阳性对照**。没有它，"入口不在"这条永远通过 —— 因为 jsdom 里的 App 很可能根本没
 * 停在清单上（`currentProject === undefined`），于是判据在测一个跟 P-1 无关的东西。
 * 同一条前置下"打开有 / 默认没有"两条一起跑，才证明这条红真的会因为开关而红。
 *
 * （真浏览器里同一条判据在 `e2e/tests/collab-journey.spec.ts`：建好清单、配好同步之后
 * 先断 `share-open-button` 计数为 0，再打开开关往下走。）
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@heyta/i18n';
import { emptyState } from '@heyta/op-log';

import {
  SHARE_EXPERIMENTAL_STORAGE_KEY,
  loadShareExperimentalEnabled,
  saveShareExperimentalEnabled,
} from '../src/lib/share-experimental.js';
import { SyncSettingsPanel } from '../src/features/sync/SyncSettingsPanel.js';
import { LocaleHost } from '../src/lib/locale-host.js';
import { __resetOpLogForTests, initOpLog } from '../src/lib/oplog.js';
import { usePrivacyStore } from '../src/features/privacy/store.js';
import { useProjectStore } from '../src/features/projects/store.js';
import { useSyncStore } from '../src/features/sync/store.js';
import { useTaskStore } from '../src/features/tasks/store.js';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

const { App } = await import('../src/App.js');

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem(
    'privacy.consent',
    JSON.stringify({ decision: 'local-only', decidedAt: new Date().toISOString() }),
  );
  usePrivacyStore.setState({ open: false, reason: 'first-launch', notPersisted: false });
  __resetOpLogForTests();
  await initOpLog(`share-entry-${Math.random().toString(36).slice(2)}`);
  // 模块级单例 —— 不复位就会用例之间互相带状态（同 `app-mount.spec.tsx`）。
  useTaskStore.setState({ entities: emptyState(), filter: { kind: 'all' }, now: Date.now(), ready: false });
  useProjectStore.setState({ projects: [] });
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
  useSyncStore.setState({
    baseUrl: '',
    token: undefined,
    password: undefined,
    email: undefined,
    accountId: undefined,
    status: { kind: 'idle' },
  });
  vi.restoreAllMocks();
});

/**
 * 把 App 推到"入口本该出现"的那一状态：停在一条清单上 + 同步已配置。
 *
 * 🔴 `syncNow` / `startRealtime` 换成空实现：这里测的是**渲染条件**，不是同步。
 *    留着真实现会让 jsdom 报"op-log 引擎尚未初始化"那种**环境**错误，
 *    症状是用例绿、控制台两个错 —— 比失败还难读（同 `sync-settings-prefill.spec.tsx` 的取舍）。
 */
async function mountOnProject({ experimental }: { experimental: boolean }): Promise<void> {
  if (experimental) localStorage.setItem(SHARE_EXPERIMENTAL_STORAGE_KEY, '1');
  await act(async () => {
    await useProjectStore.getState().addProject('家庭装修');
  });
  const projectId = useProjectStore.getState().projects[0]?.id;
  expect(projectId, '前置条件：清单没建出来').toBeDefined();
  useTaskStore.setState({ filter: { kind: 'project', projectId: projectId! } });
  useSyncStore.setState({
    baseUrl: 'https://sync.example.test',
    token: 'token-for-test',
    syncNow: async () => ({ kind: 'idle' }),
    startRealtime: () => undefined,
  });

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <LocaleHost>
        <App />
      </LocaleHost>,
    );
  });
}

describe('实验开关的读写契约（设备本地偏好）', () => {
  it('🔴 存储里没有记录时是**关**（P-1 的形状就在这一行）', () => {
    expect(loadShareExperimentalEnabled(), '共享入口不许默认放出来').toBe(false);
  });

  it('只认 "1" / "0"，别的值一律退到默认', () => {
    localStorage.setItem(SHARE_EXPERIMENTAL_STORAGE_KEY, '1');
    expect(loadShareExperimentalEnabled()).toBe(true);
    localStorage.setItem(SHARE_EXPERIMENTAL_STORAGE_KEY, '0');
    expect(loadShareExperimentalEnabled()).toBe(false);
    // 坏值退到默认（= 关），而不是"非空就算开"。
    localStorage.setItem(SHARE_EXPERIMENTAL_STORAGE_KEY, 'true');
    expect(loadShareExperimentalEnabled()).toBe(false);
  });

  it('隐私模式下 getItem 会抛 —— 读偏好失败不等于应用起不来', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(loadShareExperimentalEnabled()).toBe(false);
  });

  it('写下去的能读回来；而"关"不落盘（别把老用户钉在旧默认上）', () => {
    saveShareExperimentalEnabled(true);
    expect(localStorage.getItem(SHARE_EXPERIMENTAL_STORAGE_KEY)).toBe('1');
    expect(loadShareExperimentalEnabled()).toBe(true);

    saveShareExperimentalEnabled(false);
    expect(
      localStorage.getItem(SHARE_EXPERIMENTAL_STORAGE_KEY),
      '与默认值相同就不该留一份冗余状态 —— 将来翻案默认值时老用户要能拿到新默认',
    ).toBeNull();
  });

  it('写失败（setItem 抛）也静默，本次会话仍然生效', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => saveShareExperimentalEnabled(true)).not.toThrow();
  });
});

describe('设置 → 同步 里那枚开关', () => {
  function mountPanel(props?: {
    shareExperimental?: boolean;
    onToggleShareExperimental?: () => void;
  }): void {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <I18nProvider locale="zh-CN">
          <SyncSettingsPanel {...props} />
        </I18nProvider>,
      );
    });
  }

  function toggle(): HTMLInputElement | null {
    return container?.querySelector<HTMLInputElement>('[data-testid="share-experimental-toggle"]') ?? null;
  }

  it('不传属性时是关的，且勾选状态跟着属性走（受控，不是第二份本地状态）', () => {
    mountPanel();
    const first = toggle();
    expect(first, '设置里没有这枚开关 ⇒ 实验开关无处打开，P-1 的降级就变成了彻底砍掉功能').toBeDefined();
    expect(first!.checked).toBe(false);
    act(() => root?.unmount());
    root = undefined;

    mountPanel({ shareExperimental: true });
    expect(toggle()!.checked, '开关已经打开但复选框还是空的').toBe(true);
  });

  it('点一次就往上报一次（它只管状态，落盘与生效由 App 那侧做）', () => {
    const onToggleShareExperimental = vi.fn();
    mountPanel({ shareExperimental: false, onToggleShareExperimental });
    act(() => toggle()?.click());
    expect(onToggleShareExperimental).toHaveBeenCalledTimes(1);
  });

  it('🔴 措辞必须把"今天看不到彼此改动"说出来', () => {
    mountPanel();
    const text = container?.textContent ?? '';
    // 这三格是这枚开关的全部内容：少了「看不到」它就成了一个把用户推进假完成态的动词；
    // 少了「这台设备」他会以为手机上也跟着放出来了。
    expect(text, '开关文案不能再只写"启用共享清单" —— 它必须说清今天缺的是哪一半').toMatch(/看不到/);
    expect(text).toMatch(/这台设备/);
  });
});

describe('整个 App：入口的第三道条件', () => {
  it('🔴 阳性对照：前置全齐**且**开关打开 ⇒ 入口出现', async () => {
    await mountOnProject({ experimental: true });
    expect(
      container?.querySelector('[data-testid="share-open-button"]'),
      '开关打开后入口仍不出现 ⇒ 这一格测的根本不是 P-1，下一条的"不出现"也是假绿',
    ).not.toBeNull();
  });

  it('🔴 同样的前置，什么都不动 ⇒ 入口不出现（P-1 的本体）', async () => {
    await mountOnProject({ experimental: false });
    expect(
      container?.querySelector('[data-testid="share-open-button"]'),
      '共享入口又默认放出来了 —— 内容面还没交付到界面上（任务/清单的写路径仍进个人 op-log，那是 M2），' +
        '放出来就是拿用户的信任测进度（见 plans/collaboration-shared-lists.md §9.2 P-1）',
    ).toBeNull();
  });
});
