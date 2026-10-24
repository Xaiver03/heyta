/**
 * M6-3a 界面腿的装配判据（两半式，本壳惯例：值导入 + 去注释源码文本）
 * =====================================================================
 *
 * 五形各钉一格，每一条都**能红**（写的时候按"删掉对应代码它会红"逐条对过）：
 *
 * ① 根入口带真实端口调 `arm`：`makeMobileSharePorts()` 的值半 —— 没登录 ⇒ `undefined`；
 *    登录后 ⇒ 交出**三件真端口**，且 `shareLog`/`keyPort` 是记忆化单例（第二份存储
 *    就是第二份真相）。`App.tsx` 那半在 `share-session.spec.ts` 已钉死（不重复）。
 * ② 两张屏里 `window` / `document` / `localStorage` / `navigator` / `setInterval`
 *    一个都不许出现（先剥注释，否则 `not.toMatch` 假绿）。
 * ③ 评论区走**重画通道**而不是自己再拉：`subscribeShareRepaint` 在、重画回调里只有
 *    重读（`setTick`），`pullForTask` 全文件只许出现在"进入那一节"的那一次冷启动。
 * ④ 入群等待态**先登记 roster target 再等信封**（闸门的那一半天；这个形状踩过两次）。
 * ⑤ 无订阅偏好 ⇒ **零打扰**：`deliverShareActivities` 的闸门是 `@heyta/ui` 的
 *    `selectNotifiedActivities`，壳里不许重写"响不响"；投递面真的被入口挂上
 *    （`installMobileShareActivityDelivery` + `bindShareDeliveryDeps`，装配存在
 *    但没有调用点正是"零件都在、线没接"）。
 *
 * ⚠️ 系统横幅那一格今天是**登记在册的做不到**（原因见 `share/share-activity-notify.ts`
 * 文件头），所以这里钉的是"端口可注入 + 缺省不投"，而不是钉它会投。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** 内存版设备偏好（闭包延迟取值 ⇒ 与 `fakeConfig` 同一 TDZ 安全的写法）。 */
const prefStore = new Map<string, string>();
vi.mock('../src/prefs/device-prefs', () => ({
  readDevicePref: (key: string) => prefStore.get(key),
  writeDevicePref: (key: string, value: string) => {
    prefStore.set(key, value);
    return true;
  },
  deleteDevicePref: (key: string) => prefStore.delete(key),
}));

/**
 * 同意闸的替身。⚠️ 闭包只在**调用时**读 `consentGateFetchImpl`：`vi.mock` 的工厂会被
 * 提升，静态引用会在模块初始化序里撞上 TDZ —— 这一格与本壳 `realtime-wiring.spec`
 * 同一写法（延迟到调用点的引用，不在 mock 工厂里取值）。
 */
const consentGateFetchMock = vi.fn();
let consentGateFetchImpl: typeof fetch = () => Promise.reject(new Error('not wired'));
vi.mock('../src/privacy/consent-gate', () => ({
  consentFetch: ((input: RequestInfo | URL, init?: RequestInit) =>
    consentGateFetchImpl(input, init)) as typeof fetch,
}));

/**
 * `getVaultSecureStorage()` 在 node 里会**显式抛**"原生模块不可用"
 * （`vault-secure-storage.ts` 的既有裁决：生产调用点不许假装没有钥）。
 * 值半验的是**装配**（三件套各自接到哪、是不是同一份），不是 Keychain —— 换成假端口。
 */
const fakeKeyPort = { get: vi.fn(), set: vi.fn(), remove: vi.fn() };
vi.mock('../src/lib/share-key-store', () => ({
  getShareKeyStoragePort: () => fakeKeyPort,
}));

let fakeConfig: { serverUrl: string; token: string; password: string; accountId?: string } | undefined;
vi.mock('../src/sync/config', () => ({
  readSyncConfig: () => fakeConfig,
}));

import { DEFAULT_NOTIFICATION_PREFS, type ShareNotificationPrefs } from '@heyta/ui/node';

import { makeMobileSharePorts } from '../src/share/share-ports';
import {
  __resetShareActivityFeedForTests,
  appendShareActivityFeed,
  clearShareActivityFeed,
  deliverShareActivities,
  markShareActivityRead,
  SHARE_ACTIVITY_FEED_LIMIT,
  shareActivityFeed,
  shareActivityUnreadCount,
  subscribeShareActivityFeed,
} from '../src/share/share-activity-notify';

import { read, stripComments } from './source-reading';

const SCREENS = ['apps/mobile/src/screens/ShareSpaceScreen.tsx', 'apps/mobile/src/screens/JoinShareScreen.tsx'];

beforeEach(() => {
  __resetShareActivityFeedForTests();
  fakeConfig = undefined;
  // 出站必须走同意闸那个替身，而不是 `globalThis.fetch`（绕过闸门的形状）。
  consentGateFetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
    consentGateFetchMock(input, init);
    return Promise.reject(new Error('blocked in tests'));
  }) as typeof fetch;
});

describe('① 端口三件套：值导入那半', () => {
  it('没登录 / 没配服务端 ⇒ undefined（停在"这一刻没有共享上下文"，不抛、不猜）', () => {
    expect(makeMobileSharePorts()).toBeUndefined();
    fakeConfig = { serverUrl: '', token: 't', password: 'p', accountId: 'a' };
    expect(makeMobileSharePorts()).toBeUndefined();
    fakeConfig = { serverUrl: 'https://sync.example.test', token: '', password: 'p', accountId: 'a' };
    expect(makeMobileSharePorts(), '空令牌必须规整成"没有上下文"（与 readSyncConfig 同一口径）').toBeUndefined();
    fakeConfig = { serverUrl: 'https://sync.example.test', token: 't', password: 'p', accountId: '' };
    expect(makeMobileSharePorts(), '没有 accountId 就没有 Keychain 槽位').toBeUndefined();
  });

  it('登录后 ⇒ 交出真实端口，且 `shareLog` / `keyPort` 是记忆化单例（第二份存储 = 第二份真相）', () => {
    fakeConfig = { serverUrl: 'https://sync.example.test', token: 't', password: 'p', accountId: 'acct-1' };
    const first = makeMobileSharePorts();
    const second = makeMobileSharePorts();
    expect(first).toBeDefined();
    // 三件都是**真件**：不是占位，出站也不是 `globalThis.fetch`（绕过同意闸的形状）。
    expect(typeof first!.fetchImpl).toBe('function');
    first!.fetchImpl('https://x.example', {}).catch(() => undefined);
    expect(consentGateFetchMock, 'fetchImpl 没有走 consent-gate 那枚闸门').toHaveBeenCalledTimes(1);
    expect(first!.keyPort).toBe(fakeKeyPort);
    expect(typeof first!.shareLog.load).toBe('function');
    expect(typeof first!.shareLog.setCursor).toBe('function');
    expect(second!.shareLog).toBe(first!.shareLog);
    expect(second!.keyPort).toBe(first!.keyPort);
  });

  it('盘上键名与 web 逐字同名（`heyta.share-log.` 三族；同一份数据两端只许有一个名字）', () => {
    fakeConfig = { serverUrl: 'https://sync.example.test', token: 't', password: 'p', accountId: 'acct-1' };
    const { shareLog } = makeMobileSharePorts()!;
    shareLog.setCursor('share-42', 7);
    shareLog.save('share-42', shareLog.load('share-42') ?? ([] as unknown as Parameters<typeof shareLog.save>[1]));
    const code = read('apps/mobile/src/lib/share-local-store.ts');
    for (const prefix of ['heyta.share-log.', '.index', '.cursor.']) {
      expect(code, `落盘前缀少了 "${prefix}" 那一族`).toContain(prefix);
    }
    expect(shareLog.cursor('share-42')).toBe(7);
    expect(shareLog.list()).toContain('share-42');
  });
});

describe('② 两张屏：宿主全局与轮询一个都不许出现（去注释源码文本）', () => {
  for (const file of SCREENS) {
    it(`${file} 里没有 window / document / localStorage / navigator / setInterval`, () => {
      const code = stripComments(read(file));
      for (const banned of ['window', 'document', 'localStorage', 'navigator', 'setInterval', 'setTimeout']) {
        expect(code, `${file} 里出现了 ${banned} —— RN 屏不许碰 DOM 全局，面板不许有定时器轮询`).not.toContain(banned);
      }
    });
  }
});

describe('③ 评论区走重画通道，不自己再拉', () => {
  const code = stripComments(read('apps/mobile/src/screens/ShareSpaceScreen.tsx'));

  it('🔴 订阅了 `subscribeShareRepaint`，重画回调只做"重读"（setTick），里面没有第二次拉取', () => {
    expect(code).toContain('subscribeShareRepaint(');
    const match = code.match(/subscribeShareRepaint\(\(\) => \{([\s\S]*?)\}\)/);
    expect(match, '重画订阅的形状变了，判据需要按新形状重读').toBeTruthy();
    expect(match![1]).toContain('setTick');
    expect(match![1], '重画回调里再拉一次只会拿到 fetched = 0（游标每份 share 全局一份）').not.toContain('pullForTask');
  });

  it('`pullForTask` 全文件只出现一次调用点 = 进入那一节的冷启动那一趟', () => {
    const calls = code.match(/pullForTask\(/g) ?? [];
    expect(calls.length, '评论区出现了第二次拉取点').toBe(1);
  });
});

describe('④ 入群等待态真的登记了 roster target', () => {
  it('🔴 `JoinShareScreen`：等待信封之前先 `registerShareRosterTarget`（闸门 = 清单行绑定 ∪ 登记中的 target）', () => {
    const code = stripComments(read('apps/mobile/src/screens/JoinShareScreen.tsx'));
    expect(code).toContain('registerShareRosterTarget(');
    expect(code).toContain('waiting-key');
    // 登记的回调必须是 finalize 本身 —— 登记一个空转的 target 等于没登记。
    const match = code.match(/registerShareRosterTarget\(phase\.shareId,[\s\S]*?\}\)/);
    expect(match, '登记形状变了：判据要按新形状重读').toBeTruthy();
    expect(match![0]).toContain('finalize');
    // 共享主屏那一侧同样要在面板打开时登记（成员面信号驱动的落点）。
    expect(stripComments(read('apps/mobile/src/screens/ShareSpaceScreen.tsx'))).toContain('registerShareRosterTarget(');
  });
});

describe('⑤ 无订阅偏好 ⇒ 零打扰（闸门只有 `@heyta/ui` 那一枚）', () => {
  const labels = { title: 'heyta', body: () => '有人动了共享清单' };

  it('默认偏好（三类全关）⇒ delivered = 0、reason = prefs-off，一个回调都不发起', () => {
    const inApp = vi.fn();
    const reading = deliverShareActivities({
      shareId: 'share-1',
      latestSeq: 9,
      kinds: ['added', 'deleted'],
      labels,
      ports: { readPrefs: () => DEFAULT_NOTIFICATION_PREFS, projectIdFor: () => 'p1', inApp },
    });
    expect(reading).toEqual({ delivered: 0, reason: 'prefs-off' });
    expect(inApp).not.toHaveBeenCalled();
  });

  it('开了 `added` ⇒ 只响 added 那一条（去重与逐类过滤都是 `selectNotifiedActivities` 给的，壳没参与）', () => {
    const prefs: ShareNotificationPrefs = {
      ...DEFAULT_NOTIFICATION_PREFS,
      activities: { onCompleted: false, onAdded: true, onDeleted: false },
    };
    const inApp = vi.fn();
    const reading = deliverShareActivities({
      shareId: 'share-1',
      latestSeq: 9,
      kinds: ['added', 'added', 'deleted'],
      labels,
      ports: { readPrefs: () => prefs, projectIdFor: () => 'p1', inApp },
    });
    expect(reading.delivered).toBe(1);
    expect(inApp).toHaveBeenCalledTimes(1);
    expect(inApp.mock.calls[0]![0]).toMatchObject({ kind: 'added', shareId: 'share-1', seq: 9, projectId: 'p1' });
  });

  it('🔴 壳里不许长出第二份"响不响"：投递文件去注释后不含逐类开关的直读', () => {
    const code = stripComments(read('apps/mobile/src/share/share-activity-notify.ts'));
    expect(code).toContain('selectNotifiedActivities(');
    expect(code, '闸门只有 ui 那一枚；这里再判一次就有两份答案').not.toMatch(/activities\.on(Completed|Added|Deleted)/);
  });

  it('应用内那一格：feed 有上限、未读只有一处真相、登出清空', () => {
    for (let i = 0; i < SHARE_ACTIVITY_FEED_LIMIT + 5; i += 1) {
      appendShareActivityFeed({ shareId: 's', kind: 'added', seq: i, at: 1000 + i, projectId: 'p' });
    }
    expect(shareActivityFeed()).toHaveLength(SHARE_ACTIVITY_FEED_LIMIT);
    expect(shareActivityUnreadCount()).toBe(SHARE_ACTIVITY_FEED_LIMIT + 5);
    let notified = 0;
    const off = subscribeShareActivityFeed(() => {
      notified += 1;
    });
    markShareActivityRead();
    expect(shareActivityUnreadCount()).toBe(0);
    expect(notified).toBe(1);
    clearShareActivityFeed();
    expect(shareActivityFeed()).toHaveLength(0);
    off();
  });

  it('投递面真的被入口挂上（装配存在**且有调用点**）+ 登出摘掉应用内动态', () => {
    const code = stripComments(read('apps/mobile/src/App.tsx'));
    expect(code).toContain('installMobileShareActivityDelivery(');
    expect(code, '不 bind 依赖垫片，投递装配默认会抛"共享投递依赖未装配"').toContain('bindShareDeliveryDeps(');
    expect(code, '登出必须清共享动态（换归属）').toContain('clearShareActivityFeed');
  });
});
