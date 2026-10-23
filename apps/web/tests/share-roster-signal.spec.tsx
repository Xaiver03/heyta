/**
 * ADR-0070 的**接线**判据 —— 各段自己的单元测试在别处：
 *   服务端发哪九条 → `server/tests/share-routes.spec.ts`（'ADR-0070 成员面信号'）
 *   客户端认这条消息 → `packages/sync-client/tests/realtime.spec.ts`
 *   该不该重取、怎么合并 → `packages/app-host/tests/share-roster-signals.spec.ts`
 *
 * 这里钉的是**中间那一段**：壳把不把信号接到宿主，界面重取注册得对不对，
 * 以及两枚轮询撤掉之后有没有被人偷偷装回来。
 *
 * 🔴 最高价值的那一臂是「刚入群那台设备」：它的清单行绑定还没写（那是 `finalize`
 * 成功之后的事），所以闸门只认绑定的话，owner 补发信封那条信号会被丢掉 ——
 * 而这台设备正是这条信号唯一的收件人。这一格在两侧的单测里都测不到
 * （闸门在 app-host 用替身测、对话框在界面层测），只有接起来才看得见。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

vi.mock('../src/lib/oplog.js', () => ({
  hasEngine: () => true,
  requireEngine: () => ({ getClientId: () => 'device-test' }),
  // 由 `bindings` 控制"这台设备绑了哪几份清单"（= 清单行绑定那一支闸门）。
  currentState: () => ({ projects: globalThis.__bindings }),
}));

import { useShareRosterSignal } from '../src/features/share/use-share-roster-signal.js';
import {
  dispatchShareRosterSignal,
  hasShareRosterSink,
  registerShareRosterTarget,
  shareRosterTargetCount,
} from '../src/lib/share-signal-sink.js';
import { useSyncStore } from '../src/features/sync/store.js';

declare global {
  // eslint-disable-next-line no-var
  var __bindings: Record<string, { shareId?: string }>;
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function RosterHost(): null {
  useShareRosterSignal();
  return null;
}

const mount = async () => {
  await act(async () => {
    root = createRoot(container!);
    root.render(<RosterHost />);
  });
};

/** 信号之后那串 await 要走完 ⇒ 冲一个宏任务，不是只排空微任务。 */
const fire = async (shareId: string) => {
  await act(async () => {
    dispatchShareRosterSignal(shareId);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

beforeEach(async () => {
  container = document.createElement('div');
  document.body.append(container);
  globalThis.__bindings = {};
  useSyncStore.setState({
    baseUrl: 'http://sync.test',
    token: 'tok-test',
    accountId: 'acct-test',
    authTransport: 'bearer',
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
});

describe('接线：信号 → 宿主 → 登记的界面', () => {
  it('根一挂载就有唯一的消费者（没注册就等于信号被静默丢掉）', async () => {
    expect(hasShareRosterSink()).toBe(false);
    await mount();
    expect(hasShareRosterSink()).toBe(true);
  });

  it('面板登记着这份清单 ⇒ 一条信号换来一次重取', async () => {
    await mount();
    let reloads = 0;
    const unregister = registerShareRosterTarget('share-1', async () => { reloads += 1; });
    await fire('share-1');
    expect(reloads).toBe(1);
    unregister();
  });

  it('🔴 刚入群那台：清单行还没绑定，但对话框登记着 target ⇒ 重取照跑', async () => {
    await mount();
    let finalizeRuns = 0;
    globalThis.__bindings = {}; // 这台设备此刻还没有任何清单行绑定
    const unregister = registerShareRosterTarget('share-new', async () => { finalizeRuns += 1; });
    await fire('share-new');
    expect(finalizeRuns, '只认清单行绑定的闸门会把这条信号丢掉，人会永远停在等待页').toBe(1);
    unregister();
  });

  it('本机既不认得、也没人登记 ⇒ 零请求（不能让服务端替本机决定取什么）', async () => {
    await mount();
    let runs = 0;
    const unregister = registerShareRosterTarget('share-1', async () => { runs += 1; });
    await fire('share-unknown');
    expect(runs).toBe(0);
    unregister();
  });

  it('在途时连来三条 ⇒ 只跑两次（一次在途 + 一次尾巴），不是三次', async () => {
    await mount();
    const calls: number[] = [];
    let release: (() => void) | undefined;
    const unregister = registerShareRosterTarget('share-1', () => {
      calls.push(calls.length + 1);
      return new Promise<void>((resolve) => {
        if (calls.length === 1) release = resolve;
        else resolve();
      });
    });
    globalThis.__bindings = { 'p-1': { shareId: 'share-1' } };
    await act(async () => {
      dispatchShareRosterSignal('share-1');
      dispatchShareRosterSignal('share-1');
      dispatchShareRosterSignal('share-1');
      await new Promise((resolve) => setTimeout(resolve, 0));
      release?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(calls).toHaveLength(2);
    unregister();
  });

  it('卸载 ⇒ 注销；之后的信号不再敲已经关掉的界面', async () => {
    await mount();
    let runs = 0;
    const unregister = registerShareRosterTarget('share-1', async () => { runs += 1; });
    expect(shareRosterTargetCount('share-1')).toBe(1);
    unregister();
    expect(shareRosterTargetCount('share-1')).toBe(0);
    await fire('share-1');
    expect(runs).toBe(0);
  });

  it('重取炸了不许把消费者带走（下一条信号仍然跑得动）', async () => {
    await mount();
    globalThis.__bindings = { 'p-1': { shareId: 'share-1' } };
    let runs = 0;
    const unregister = registerShareRosterTarget('share-1', async () => {
      runs += 1;
      if (runs === 1) throw new Error('面板炸了');
    });
    await expect(fire('share-1')).resolves.not.toThrow();
    await fire('share-1');
    expect(runs).toBe(2);
    unregister();
  });
});

/**
 * 撤掉的轮询不许被偷偷装回来（ADR-0070 §六）。
 *
 * 这一臂读的是**源码本身**，不是运行时 —— 定时器是"没人红、但电池和流量在付账"
 * 那一类东西：接好信号之后把它加回来的改动，逐条看都是绿的。
 */
describe('常驻形状：那两份共享源码里不许有定时器', () => {
  const sources = ['ShareFeature.tsx', 'JoinSharedListDialog.tsx'] as const;

  for (const file of sources) {
    it(`${file} 里没有 setInterval`, () => {
      const source = readFileSync(join(__dirname, '..', 'src', 'features', 'share', file), 'utf8');
      expect(source.includes('setInterval'), `${file} 又开始了定时重取 —— 成员面走 share_roster_changed`).toBe(false);
    });
  }
});
