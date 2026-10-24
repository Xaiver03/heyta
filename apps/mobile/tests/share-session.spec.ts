/**
 * M6-2 移动端共享会话装配的验收（两半式，本壳惯例）
 * ==================================================
 *
 * · **值导入那半**：`share-session.ts` 是纯装配（不碰 `react-native`：
 *   `db/open-host` 用 `vi.mock` 换成假宿主，密钥/日志/出站端口是内存假件）。
 *   钉三形：① 没登录 / 没配服务端 / 宿主没就绪 / 端口没接 ⇒ **建不出来且不抛**；
 *   ② depKey 变了（换账号）⇒ **先摘后建**，`getState` 不再引用旧实例；
 *   ③ 离场式的 `reset` 之后无条件重问（"删一条、丢一片"的反面）。
 * · **去注释源码那半**：钉反向判据 —— 壳里不许长出第二份"什么算共享的"
 *   （AGENTS §3.5），`setProjectShareId` 的调用点**全壳只许一处**。
 *
 * 路由本体（共享写进 share log / 非共享进个人 log）在同目录
 * `share-routing-assembly.spec.ts`（它要真的 `share/wiring.ts`，本文件把它 mock 掉了）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const slot = vi.hoisted(() => ({
  host: undefined as undefined | {
    clientId: string;
    vaultAsks: number;
    getVaultSession: () => Promise<unknown>;
  },
}));

vi.mock('../src/db/open-host', () => ({
  getOpenTaskHostIfReady: () => slot.host,
  openTaskHost: vi.fn(),
}));
// 装配点在本用例里只当**观察窗**：attach 的顺序（undefined 必须在重建之前）
// 就是"先摘后建"的可观测形状；路由行为由另一份 spec 用真件钉。
vi.mock('../src/share/wiring', () => ({
  attachMobileShareWiring: vi.fn(),
  // `comment-actions` 构造 ctx 时会摸到这三枚 —— 缺席的话 vitest 的 mock 代理直接抛。
  dispatchIntent: vi.fn(async () => undefined),
  dispatchChecked: vi.fn(async () => undefined),
  currentState: vi.fn(() => ({})),
}));

import { clearSyncConfig, writeSyncConfig } from '../src/sync/config';
import { attachMobileShareWiring } from '../src/share/wiring';
import {
  armMobileShareSession,
  ensureMobileShareSession,
  mobileShareSession,
  resetMobileShareSession,
} from '../src/share/share-session';

import { read, stripComments, mobileSources } from './source-reading';

const FAKE_CIPHER = { encrypt: async () => '', decrypt: async () => '' };

const makeHost = (clientId = 'client-1') => {
  const host = {
    clientId,
    vaultAsks: 0,
    getVaultSession: async () => {
      host.vaultAsks += 1;
      return { getPayloadCipher: async () => FAKE_CIPHER };
    },
  };
  return host;
};

const makePorts = () => ({
  keyPort: {
    get: async () => null,
    set: async () => undefined,
    remove: async () => undefined,
  },
  shareLog: {
    load: () => undefined,
    save: () => undefined,
    list: () => [] as readonly string[],
    cursor: () => 0,
    setCursor: () => undefined,
  },
  fetchImpl: (async () => {
    throw new Error('本用例不许发网络请求');
  }) as unknown as typeof fetch,
});

const login = (accountId: string) => {
  writeSyncConfig({
    serverUrl: 'https://sync.example.test',
    token: `token-${accountId}`,
    password: 'x',
    accountId,
  });
};

beforeEach(() => {
  clearSyncConfig();
  slot.host = undefined;
  vi.clearAllMocks();
});

/** 让 `arm` 那一次"问早了"的 in-flight 建轨先落地（真实运行里 effect 之间隔着宏任务）。 */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('① 这一刻没有共享上下文 ⇒ 建不出来，且**不抛**', () => {
  it('端口还没接（M6-1 的落盘端口缺席）⇒ undefined，一个 vault 会话都不催', async () => {
    login('account-1');
    slot.host = makeHost();
    await expect(ensureMobileShareSession()).resolves.toBeUndefined();
    expect(slot.host.vaultAsks).toBe(0);
    expect(attachMobileShareWiring).not.toHaveBeenCalled();
  });

  it('没登录（没配凭据）⇒ undefined，不抛', async () => {
    armMobileShareSession(makePorts());
    await expect(ensureMobileShareSession()).resolves.toBeUndefined();
    expect(mobileShareSession()).toBeUndefined();
  });

  it('宿主还没就绪（clientId 是 share op 的署名）⇒ undefined，不抛', async () => {
    armMobileShareSession(makePorts());
    login('account-1');
    slot.host = undefined;
    await expect(ensureMobileShareSession()).resolves.toBeUndefined();
    expect(mobileShareSession()).toBeUndefined();
  });

  it('vault 没解锁（拿不到 payloadCipher）⇒ undefined，不抛', async () => {
    armMobileShareSession(makePorts());
    login('account-1');
    slot.host = {
      clientId: 'client-1',
      vaultAsks: 0,
      getVaultSession: async () => ({ getPayloadCipher: async () => undefined }),
    };
    await expect(ensureMobileShareSession()).resolves.toBeUndefined();
    expect(mobileShareSession()).toBeUndefined();
  });
});

describe('② depKey 变了 ⇒ 先摘后建，旧实例不再被引用', () => {
  it('同一登录态问十次也是一份（单例）', async () => {
    armMobileShareSession(makePorts());
    login('account-1');
    slot.host = makeHost();
    await settle();
    const first = await ensureMobileShareSession();
    expect(first).toBeDefined();
    expect(await ensureMobileShareSession()).toBe(first);
    expect(mobileShareSession()).toBe(first);
  });

  it('换账号 ⇒ `attachMobileShareWiring(undefined)` 必须发生在重新挂上之前', async () => {
    armMobileShareSession(makePorts());
    login('account-1');
    slot.host = makeHost();
    await settle();
    const first = await ensureMobileShareSession();
    expect(first).toBeDefined();

    login('account-2');
    await settle();
    const second = await ensureMobileShareSession();
    expect(second).toBeDefined();
    // 旧实例不再被 `getState` 的合并视图引用：读当下就是新的那一份。
    expect(mobileShareSession()).not.toBe(first);
    expect(mobileShareSession()).toBe(second);

    const calls = vi.mocked(attachMobileShareWiring).mock.calls;
    const detachAt = calls.findIndex((c) => c[0] === undefined);
    expect(detachAt, '换账号没有先摘旧实例（隐私窗口：上一个人的共享内容会被并进这个人的界面）').toBeGreaterThanOrEqual(0);
    expect(calls.length).toBeGreaterThan(detachAt);
    expect(calls.at(-1)![0]).not.toBeUndefined();
  });

  it('登出清空凭据 ⇒ 订阅者必须**同步**摘掉实例（不等下一个问的人）', async () => {
    armMobileShareSession(makePorts());
    login('account-1');
    slot.host = makeHost();
    await settle();
    expect(await ensureMobileShareSession()).toBeDefined();
    clearSyncConfig();
    expect(mobileShareSession()).toBeUndefined();
  });

  it('reset（离场/退出登录）⇒ 立刻摘掉，然后重问：在册的**别的**共享清单不丢', async () => {
    armMobileShareSession(makePorts());
    login('account-1');
    slot.host = makeHost();
    await settle();
    const first = await ensureMobileShareSession();
    expect(first).toBeDefined();
    await settle();
    resetMobileShareSession();
    expect(mobileShareSession(), '摘的动作必须同步可见').toBeUndefined();
    const rebuilt = await ensureMobileShareSession();
    expect(rebuilt, '只摘不重建 = 删一条、丢一片').toBeDefined();
  });
});

describe('装配的反向判据（源码那半，先剥注释）', () => {
  const SHELL_FILES = [
    'apps/mobile/src/share/wiring.ts',
    'apps/mobile/src/share/comment-actions.ts',
    'apps/mobile/src/share/share-session.ts',
    'apps/mobile/src/share/project-share.ts',
    'apps/mobile/src/db/open-host.ts',
  ];

  it('🔴 壳里不许长出"什么算共享的"：`.shareId` 属性读取与 `shareId ===` 比较一个都不许有', () => {
    for (const file of SHELL_FILES) {
      const code = stripComments(read(file));
      expect(code, `${file} 里出现了清单共享判断 —— 判据在 app-host`).not.toMatch(/\.shareId\b/);
      expect(code, `${file} 里出现了 shareId 相等判断`).not.toMatch(/shareId\s*[!=]==/);
    }
  });

  it('路由是**装配**：`db/open-host.ts` 必须把原始宿主交进装配点、写入口过同一层', () => {
    const code = stripComments(read('apps/mobile/src/db/open-host.ts'));
    expect(code).toContain('bindMobileOplogBase');
    expect(code).toContain('shareAwareDispatchIntent');
    expect(code).toContain('shareAwareDispatchChecked');
    // 🔴 交出去的必须是**未包装**的 host（包装自己会递归），而三件出口全走装配点。
    expect(code).toContain('shareAwareState');
  });

  it('判据 C 数的构造点：移动端壳里真的调用 `createCommentActions(`', () => {
    expect(stripComments(read('apps/mobile/src/share/comment-actions.ts'))).toContain('createCommentActions(');
  });

  it('🔴 `setProjectShareId` 的调用点全壳**只许一处**（web 同一条纪律）', () => {
    const callSites = ['apps/mobile/src/share/project-share.ts'];
    const code = stripComments(read(callSites[0]!));
    expect(code).toContain('setProjectShareId(');
    const all = mobileShareSourceFilesCalling('setProjectShareId(');
    expect(all, `出现第二处绑定入口：${all.join(', ')}`).toEqual(callSites);
  });

  it('🔴 入口真的被武装**且带着真实端口**：`armMobileShareSession(makeMobileSharePorts())`', () => {
    // 只查 `armMobileShareSession(` 是不够的 —— **不带 ports 的调用一条判据都不会红**，
    // 而它的症状是"共享路由停在个人 log 原路 + 信号全丢"（2026-10-24 现场实测）。
    // 把 `makeMobileSharePorts()` 摘掉 ⇒ 这一条必须红（可失败性在这里是判据本身）。
    expect(stripComments(read('apps/mobile/src/App.tsx'))).toContain('armMobileShareSession(makeMobileSharePorts())');
  });
});

/** 全 `apps/mobile/src` 里含某个调用的文件（仓库相对路径）。 */
function mobileShareSourceFilesCalling(token: string): string[] {
  return mobileSources().filter((file) => stripComments(read(file)).includes(token));
}
