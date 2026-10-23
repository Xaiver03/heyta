/**
 * 共享入口的**默认态可达**（P-1 翻案之后钉反方向）
 * =================================================
 *
 * ## 这一格为什么存在，而且为什么钉的是"可达"
 *
 * P-1（2026-10-20）把入口按在实验开关后面，理由只有一句：元数据面全在，而**内容面到不了
 * 用户眼前** —— 放出来就是让用户替我们发现"这功能是假的"，而且发生在他把清单交出去之后。
 * 2026-10-23 那一格反过来了：`verify:collab-journey` 的"两台真浏览器互见"验过（owner 写的
 * 任务出现在 bob 那台、反向同一件事，读数见计划 §9.11），翻案条件成立 ⇒ 开关与它的措辞
 * 一起退场。
 *
 * 🔴 门禁与测试**跟着翻方向，不是删掉**。旧那一版钉的是"默认不许出现"，如果今天只是把
 * 测试删了，下一个人就能在没有任何东西拦的情况下把入口整块摘掉 —— 而"入口没了"同样是一格
 * 真坏（共享面板、邀请、成员管理全在，页面上却找不到门）。
 *
 * ## 三条臂，各挡一种坏法
 *
 * | 判据 | 坏法 |
 * |---|---|
 * | 前置齐 ⇒ 入口在 | 有人把入口整块摘掉，或者又把实验开关塞回来 |
 * | 没配同步 ⇒ 入口不在 | 有人把渲染条件整个删了"反正默认可达"—— 那会在未登录/未配置的屏上挂出一枚点了报错的按钮 |
 * | 停在收集箱 ⇒ 入口不在 | 同上，且这一形更隐蔽：智能清单不是"存放位置"，共享无从谈起 |
 * | 设置里没有那枚"实验"开关 | 留着开关而入口不再读它 ⇒ 用户勾一枚什么都不放的复选框（正是旧格 3 反着钉的那一种） |
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@heyta/i18n';
import { emptyState } from '@heyta/op-log';

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
 * 把 App 推到"入口本该出现"的那一状态：停在一条清单上。
 * `syncConfigured` 由参数决定 —— 那一道条件是要**保住**的（未配置同步就没有共享）。
 *
 * 🔴 `syncNow` / `startRealtime` 换成空实现：这里测的是**渲染条件**，不是同步。
 *    留着真实现会让 jsdom 报"op-log 引擎尚未初始化"那种**环境**错误，
 *    症状是用例绿、控制台两个错 —— 比失败还难读（同 `sync-settings-prefill.spec.tsx` 的取舍）。
 */
async function mountOnProject({ syncConfigured }: { syncConfigured: boolean }): Promise<void> {
  await act(async () => {
    await useProjectStore.getState().addProject('家庭装修');
  });
  const projectId = useProjectStore.getState().projects[0]?.id;
  expect(projectId, '前置条件：清单没建出来').toBeDefined();
  useTaskStore.setState({ filter: { kind: 'project', projectId: projectId! } });
  if (syncConfigured) {
    useSyncStore.setState({
      baseUrl: 'https://sync.example.test',
      token: 'token-for-test',
      syncNow: async () => ({ kind: 'idle' }),
      startRealtime: () => undefined,
    });
  }

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

function entry(): Element | null | undefined {
  return container?.querySelector('[data-testid="share-open-button"]');
}

describe('共享入口：默认态可达（P-1 已翻案）', () => {
  it('🔴 停在一条清单上 + 同步已配好 ⇒ 入口就在那儿（不需要任何开关）', async () => {
    await mountOnProject({ syncConfigured: true });
    expect(entry(), '共享入口又藏起来了 —— 内容面已经交付到界面（两台真浏览器互见验过），' +
      '藏起来就是让一个能用的功能在页面上消失').not.toBeNull();
  });

  it('反向臂：没配同步 ⇒ 入口不出现（"可达"不等于"无条件渲染"）', async () => {
    await mountOnProject({ syncConfigured: false });
    expect(
      entry(),
      '未配置同步的屏上挂一枚共享入口 = 点了必然失败。这道条件属于入口的语义，不属于 P-1',
    ).toBeNull();
  });

  it('反向臂：停在收集箱（不是"自己的清单"）⇒ 入口不出现', async () => {
    await mountOnProject({ syncConfigured: true });
    act(() => {
      useTaskStore.setState({ filter: { kind: 'all' } });
    });
    expect(
      entry(),
      '智能清单不是存放位置 —— 共享无从谈起，这一形必须仍然不出现',
    ).toBeNull();
  });
});

describe('那枚「共享清单（实验）」开关已经随翻案退场', () => {
  function mountPanel(): void {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <I18nProvider locale="zh-CN">
          <SyncSettingsPanel />
        </I18nProvider>,
      );
    });
  }

  it('🔴 设置 → 同步 里不许再留一枚什么都不放的复选框', () => {
    mountPanel();
    expect(
      container?.querySelector('[data-testid="share-experimental-toggle"]'),
      '入口不再读那枚开关，而开关还画在设置里 = 用户勾一个没有任何效果的复选框' +
        '（这正是旧 P-1 门禁的格 3 反着钉的那一格）',
    ).toBeNull();
  });

  it('那句"成员之间还看不到彼此改动"的披露也不许留着 —— 今天它是一句假话', () => {
    mountPanel();
    expect(container?.textContent ?? '').not.toMatch(/看不到彼此改动/);
  });
});
