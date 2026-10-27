/**
 * M6-3a 界面腿的装配判据（两半式，本壳惯例：值导入 + 去注释源码文本）
 * =====================================================================
 *
 * 每一形各钉一格，每一条都**能红**（写的时候按"删掉对应代码它会红"逐条对过）：
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
 *
 * 后两组是 M6-10 补的（产品定义里"按本机偏好打扰用户"那一半在手机上今天得真成立）：
 *
 * ⑦ 一条真信号走到动态里那一句（闸门 ⇒ 正文 ⇒ 内存动态 ⇒ 界面有消费者）。
 * ⑧ 正文挑哪一句（`lib/share-activity-copy.ts` 的三档种类 × 有名/无名两档回落）。
 * ⑨ 同意闸在两屏各自的调用点（判断在 `@heyta/ui`，这里只钉"线接上了"；
 *    摘掉调用点模型那 6 枚一条都不会红 —— 变异臂见 `mutate-collab-consent-gate.mjs`）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import type { MessageKey, MessageVars } from '@heyta/i18n';
import type { ShareActivityKind } from '@heyta/ui';
import { localRowIdForShare, type AppHost } from '@heyta/app-host';
import { emptyState, type MaterializedState } from '@heyta/op-log';
import { OpType } from '@heyta/sync-core';

import { mobileShareActivityBody } from '../src/lib/share-activity-copy';
import { makeMobileSharePorts } from '../src/share/share-ports';
import {
  __resetShareActivityDeliveryForTests,
  __resetShareActivityFeedForTests,
  appendShareActivityFeed,
  bindShareDeliveryDeps,
  clearShareActivityFeed,
  deliverShareActivities,
  installMobileShareActivityDelivery,
  markShareActivityRead,
  SHARE_ACTIVITY_FEED_LIMIT,
  shareActivityFeed,
  shareActivityUnreadCount,
  subscribeShareActivityFeed,
} from '../src/share/share-activity-notify';
import {
  bindShareSignalHost,
  __resetMobileShareSignalsForTests,
  dispatchShareOpsSignal,
  installMobileShareSignals,
  type ShareSignalSession,
} from '../src/share/share-signals';
import { bindMobileOplogBase, currentState } from '../src/share/wiring';

import { mobileSources, read, stripComments } from './source-reading';

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

/**
 * 同意闸的判断只在 `@heyta/ui` 一处，两壳各只有一个调用点 —— 所以模型那 6 枚全绿
 * **不排斥**某一壳的那一行被整行摘掉：摘掉之后那一壳直接进表单/直接建共享，
 * 而纯逻辑判据一条都不会红。这一组钉的是"线接上了"，不是"判断对了"（后者在 `packages/ui`）。
 */
describe('⑨ 入群与开启共享两屏各自真的问一次同意闸（摘掉调用点这一组就红）', () => {
  it('🔴 入群屏先问 `shouldShowConsent(` 决定初始相位：没确认过 ⇒ consent 而不是 input', () => {
    const code = stripComments(read('apps/mobile/src/screens/JoinShareScreen.tsx'));
    const calls = code.match(/shouldShowConsent\(/g) ?? [];
    expect(calls.length, '入群屏没有同意闸调用点 ⇒ 手机上没确认过也直接进凭证表单').toBe(1);
    const phase = code.match(/decision\.show \? \{ kind: 'consent' \} : \{ kind: 'input' \}/);
    expect(phase, '初始相位不再由那一刀决定：判据要按新形状重读').toBeTruthy();
  });

  it('🔴 开启共享前先问 `shouldShowConsent(`，没确认过只弹面不建共享', () => {
    const code = stripComments(read('apps/mobile/src/screens/ShareSpaceScreen.tsx'));
    const calls = code.match(/shouldShowConsent\(/g) ?? [];
    expect(calls.length, '共享主屏没有同意闸调用点 ⇒ 手机上点一下就把它人清单变成共享').toBe(1);
    const gate = code.match(/if \(decision\.show\)[\s\S]{0,120}/);
    expect(gate, '闸门分支形状变了：判据要按新形状重读').toBeTruthy();
    expect(gate![0], 'show=true 那一支没去弹同意面 = 闸形同虚设').toContain('setConsentFor');
  });
});

describe('⑤ 无订阅偏好 ⇒ 零打扰（闸门只有 `@heyta/ui` 那一枚）', () => {
  /** 正文按 `(shareId, kind)` 组装：名字要按 share 查本机那一行，签名不带它就没法查。 */
  const labels = { title: 'heyta', body: (shareId: string, kind: string) => `${shareId}:${kind}` };

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
    expect(inApp.mock.calls[0]![0]).toMatchObject({
      kind: 'added',
      shareId: 'share-1',
      seq: 9,
      projectId: 'p1',
      // 🔴 投递那一刻正文就已经拼好了：界面画的是这条读数，不再自己拼句子。
      body: 'share-1:added',
    });
  });

  it('🔴 壳里不许长出第二份"响不响"：投递文件去注释后不含逐类开关的直读', () => {
    const code = stripComments(read('apps/mobile/src/share/share-activity-notify.ts'));
    expect(code).toContain('selectNotifiedActivities(');
    expect(code, '闸门只有 ui 那一枚；这里再判一次就有两份答案').not.toMatch(/activities\.on(Completed|Added|Deleted)/);
  });

  it('应用内那一格：feed 有上限、未读只有一处真相、登出清空', () => {
    for (let i = 0; i < SHARE_ACTIVITY_FEED_LIMIT + 5; i += 1) {
      appendShareActivityFeed({
        shareId: 's',
        kind: 'added',
        seq: i,
        at: 1000 + i,
        projectId: 'p',
        body: '有人动了共享清单',
      });
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

describe('⑥ 手机上不许画"只在 web 那一格"（第八批逐张肉眼复核抓到的一族）', () => {
  /**
   * 存在的理由：第 26 跑的入群成功那一屏（`06g-加入成功.png`）画的是
   * 「加入成功，清单已出现在侧栏。」—— 手机上**没有侧栏**，加入之后能看见那份清单的地方
   * 叫「已共享的清单」。这条错一条判据都没红：设备腿判的是"有没有走到成功相位"，
   * 文案对账门（`check:verify-script-copy`）判的是"脚本里的句子在不在词表里"，
   * 两句都成立而这句话在手机上仍是谎称界面能力。**只有肉眼看得见它。**
   * 🔴 所以这里判的是**一类**而不是那一枚键：任何被 `apps/mobile/src` 用到的词条，
   *    中/英两档值都不许点名一个只存在于另一壳的界面格子。
   */
  /** 词条表：`键 → 值`。解析形状与 `check:verify-script-copy` 对词表的那把尺同源。 */
  const loadTable = (rel: string): Map<string, string> => {
    const map = new Map<string, string>();
    for (const m of read(rel).matchAll(/^\s*'([a-z0-9][\w.]*)':\s*'((?:[^'\\]|\\.)*)',\s*$/gm)) {
      map.set(m[1], m[2]);
    }
    return map;
  };
  const ZH_REL = 'packages/i18n/src/locales/zh-CN.ts';
  const EN_REL = 'packages/i18n/src/locales/en.ts';
  const ZH = loadTable(ZH_REL);
  const EN = loadTable(EN_REL);
  /** 每一档语言配一枚"只在 web 存在的格子"的名字 —— 两档都要判，判一档留一半洞。 */
  const TABLES: Array<[rel: string, region: RegExp, table: Map<string, string>]> = [
    [ZH_REL, /侧栏/, ZH],
    [EN_REL, /sidebar/i, EN],
  ];

  /**
   * ⚠️ 存量例外，**不是**把判据放轻：这三枚删除/归档回执点名的落点也是「侧栏」，
   *    与 `web.share.join.*` 同一族错。改它们的话术归回收站/归档那条线（那两句被它自己的
   *    用例钉着），本线不代改、更不代判"这样也可以"。逐格登记见计划 §9.14。
   *    🔴 这张表只许变短：任何**新**出现的这一族错都会让下面那条判据红；
   *    而它们被那条线修掉之后，这里留着空名目同样会红（同一条判据的第二句管这件事）。
   */
  const OTHER_LINE_DEBT = [
    'common.organizer.confirm.impactChildren',
    'common.organizer.confirm.impactChildrenArchive',
    'common.trash.confirm.strandChildren',
  ];

  it('对照臂：两档词表都读得到（读不到 ⇒ 反向判据恒真，那是探针坏了）', () => {
    expect(ZH.get('web.share.join.done'), 'zh 探针读不出这一枚键').toContain('侧栏');
    expect(EN.get('web.share.join.done'), 'en 探针读不出这一枚键').toMatch(/sidebar/i);
  });

  it('🔴 移动端源码用到的每一枚词条，两档值都不许含"只在 web 存在的格子"（例外只剩在册那三枚）', () => {
    for (const [rel, region, table] of TABLES) {
      const offenders = new Set<string>();
      for (const src of mobileSources()) {
        for (const m of stripComments(read(src)).matchAll(/\bt\(\s*'([a-z0-9][\w.]*)'/g)) {
          if (region.test(table.get(m[1]) ?? '')) offenders.add(m[1]);
        }
      }
      expect([...offenders].filter((k) => !OTHER_LINE_DEBT.includes(k)), `${rel} 里新长出这一族错`).toEqual([]);
      expect(OTHER_LINE_DEBT.filter((k) => !offenders.has(k)), `${rel}：这几枚已经不含了 ⇒ 把名目从债表里删掉，别留一张会骗人的表`).toEqual([]);
    }
  });

  it('入群那一屏的两句话用的是手机自己的落点，不是 web 那两枚', () => {
    const code = stripComments(read('apps/mobile/src/screens/JoinShareScreen.tsx'));
    expect(code).toContain("t('mobile.share.join.subtitle')");
    expect(code).toContain("t('mobile.share.join.done')");
    expect(code).not.toContain("t('web.share.join.subtitle')");
    expect(code).not.toContain("t('web.share.join.done')");
    // 手机那两条点名的格子，必须就是这一屏之上真存在的那一节（同名同源，不各写一份）。
    for (const table of [ZH, EN]) {
      const region = table.get('mobile.share.space.sharedTitle');
      expect(region, '手机上那一节的标题读不出来 ⇒ 下面两条是恒真').toBeTruthy();
      expect(table.get('mobile.share.join.done'), '成功回执点名的格子要和真存在的那一节同名').toContain(region as string);
      expect(table.get('mobile.share.join.subtitle'), '副标题点名的格子同理').toContain(region as string);
    }
  });
});

/**
 * 词表替身：把"挑了哪一句、往里插了什么"变成可断言的字符串。
 * `vars` 只有 `name` 一枚（ADR-0071 的正文口径），别的键一旦出现这里就看得见。
 */
const fakeT =
  (prefix: string) =>
  (key: MessageKey, vars?: MessageVars): string =>
    vars === undefined ? `${prefix}:${key}` : `${prefix}:${key}:${String(vars.name)}`;

/** 一台假设备的清单行（`name` 缺省 = 那一行还没有名字，回落那一档要的就是这个形状）。 */
type DeviceRow = { readonly shareId: string; readonly name?: string };

/** 把清单行摆成合并视图里那个形状（⑦ 用它绑设备，⑧ 只拿这份状态、不碰单例）。 */
function stateOf(rows: readonly DeviceRow[]): MaterializedState {
  const projects: Record<string, unknown> = {};
  rows.forEach((row, index) => {
    projects[`p${String(index)}`] = {
      id: `p${String(index)}`,
      deletedAt: undefined,
      shareId: row.shareId,
      ...(row.name === undefined ? {} : { name: row.name }),
    };
  });
  return { ...emptyState(), projects } as unknown as MaterializedState;
}

/**
 * 这台假设备照 `share-signals.spec.ts` 的形状：清单行绑定 + `clientId` 各就各位。
 * 🔴 不绑这两件，内容信号在闸门那一关就被丢掉，⑦ 那几条判据会**永远绿** ——
 *    一条永远通过的判据比没有判据更糟。
 */
function bindDevice(rows: readonly DeviceRow[]): void {
  const host = {
    clientId: 'dev-me',
    dispatch: vi.fn(async () => undefined),
    dispatchChecked: vi.fn(async () => undefined),
    getState: () => stateOf(rows),
  } as unknown as AppHost;
  bindMobileOplogBase(host);
  bindShareSignalHost(host);
}

/**
 * ⑦ 从**一条真信号**走到**动态里那一句**（M6-10）。
 *
 * 前面几格各钉一段，这一段把整条腿走一遍：内容信号 ⇒ 拉取 ⇒ 活动差集 ⇒ 偏好闸门 ⇒
 * 按 `(shareId, kind)` 组装正文 ⇒ 落进那份内存动态。之所以要在 node 里跑这一趟：
 * 设备腿量得到"界面上有没有那句话"，量不到"投出去的正文带不带清单名"。
 */
describe('⑦ 一条内容信号 ⇒ 动态里带清单名的那一句', () => {
  function fakeStorage() {
    const ops: { value: unknown[] } = { value: [] };
    return {
      load: () => (ops.value.length === 0 ? undefined : { ops: ops.value, clock: {} }),
      save: vi.fn(),
      list: () => [] as readonly string[],
      cursor: () => 0,
      setCursor: vi.fn(),
      ops,
    };
  }

  /** 拉到一条**别人写的**评论 op ⇒ 活动差集数得出 `added`。 */
  function fakeSession(storage: ReturnType<typeof fakeStorage>) {
    return {
      channel: {
        dispatch: vi.fn(async () => undefined),
        stateFor: () => emptyState() as MaterializedState,
      },
      pullShareOps: vi.fn(async () => {
        storage.ops.value = [
          {
            id: 'op-remote-1',
            clientId: 'dev-other',
            entityType: 'COMMENT',
            opType: OpType.Create,
            timestamp: 1,
            vectorClock: {},
          },
        ];
        return { fetched: 1, added: 1, cursor: 3, pages: 1, rejections: [] };
      }),
      signatureRejections: () => [] as const,
    };
  }

  const prefsOn: ShareNotificationPrefs = {
    ...DEFAULT_NOTIFICATION_PREFS,
    activities: { onCompleted: false, onAdded: true, onDeleted: true },
  };

  /** 把投递装配的垫片换成"用这台假设备真跑信号链"的那一份（不绑 ⇒ 装配那一格会抛）。 */
  function bindShim(session: ReturnType<typeof fakeSession>, storage: ReturnType<typeof fakeStorage>): void {
    bindShareDeliveryDeps({
      installMobileShareSignals: () =>
        installMobileShareSignals({
          ensureSession: async () => session as unknown as ShareSignalSession,
          ensureStorage: async () => storage as never,
        }),
    });
  }

  /** 与 `App.tsx` 那一格同一份装配代码（只把词表换成可断言的替身）。 */
  const ports = {
    readPrefs: () => prefsOn,
    projectIdFor: (shareId: string) => localRowIdForShare(currentState(), shareId) ?? '',
    inApp: appendShareActivityFeed,
  };
  const bodyLabels = (prefix: string) => ({
    title: prefix,
    body: (shareId: string, kind: ShareActivityKind) =>
      mobileShareActivityBody(fakeT(prefix), currentState(), shareId, kind),
  });

  /** 等 sink 里那发 `void (async …)()` 走完（不等是假阴性）。 */
  const settled = async (): Promise<void> => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  };

  afterEach(() => {
    __resetShareActivityDeliveryForTests();
    __resetMobileShareSignalsForTests();
    // base 不由 `bindShareSignalHost` 管（生产里那是 `db/open-host.ts` 一件事），复位也得自己摘。
    bindMobileOplogBase(undefined);
    bindShareSignalHost(undefined);
  });

  it('信号 ⇒ 动态多一条**带清单名**的正文，未读数随之 +1（全程零请求）', async () => {
    bindDevice([{ shareId: 's1', name: '家庭采购' }]);
    const storage = fakeStorage();
    const session = fakeSession(storage);
    bindShim(session, storage);
    installMobileShareActivityDelivery({ labels: bodyLabels('中'), ports });

    dispatchShareOpsSignal('s1', 9);
    await settled();

    const rows = shareActivityFeed();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      shareId: 's1',
      kind: 'added',
      seq: 9,
      projectId: 'p0',
      body: '中:common.share.activityNamed.added:家庭采购',
    });
    expect(shareActivityUnreadCount()).toBe(1);
  });

  it('那一行还没有名字 ⇒ 正文如实说匿名那句，不编名字、不为拼句子发一次请求', async () => {
    bindDevice([{ shareId: 's1' }]);
    const storage = fakeStorage();
    const session = fakeSession(storage);
    bindShim(session, storage);
    installMobileShareActivityDelivery({
      labels: bodyLabels('中'),
      ports,
    });

    dispatchShareOpsSignal('s1', 9);
    await settled();

    expect(shareActivityFeed()[0]).toMatchObject({
      projectId: 'p0',
      body: '中:common.share.activity.added',
    });
  });

  it('🔴 重复装配换的是标签与端口，通道上仍**只有一个**消费者（切语言后的新动态说新语言）', async () => {
    bindDevice([{ shareId: 's1', name: '家庭采购' }]);
    const storage = fakeStorage();
    const session = fakeSession(storage);
    bindShim(session, storage);
    installMobileShareActivityDelivery({ labels: bodyLabels('旧'), ports });
    installMobileShareActivityDelivery({ labels: bodyLabels('新'), ports });

    dispatchShareOpsSignal('s1', 9);
    await settled();

    // 两道都订着 ⇒ 这里会是两条（同一次信号响两遍）；留着旧闭包 ⇒ 那一句还是「旧」。
    expect(shareActivityFeed()).toHaveLength(1);
    expect(shareActivityFeed()[0]?.body).toBe('新:common.share.activityNamed.added:家庭采购');
  });

  it('🔴 那一档真有消费者：通知中心订阅动态 + 打开即已读，入口徽标把未读算进去', () => {
    const screen = stripComments(read('apps/mobile/src/screens/NotificationsScreen.tsx'));
    expect(screen).toContain('subscribeShareActivityFeed(');
    expect(screen).toContain('markShareActivityRead()');
    for (const key of ['mobile.inbox.tab.share', 'mobile.inbox.share.empty', 'mobile.inbox.share.note']) {
      expect(screen, `那一档少了 t('${key}') 这句文案（在册零消费者就是这一格的形状）`).toContain(
        `t('${key}')`,
      );
    }
    expect(screen, '界面画的是投递那一刻组装好的那句，不许在自己这里再拼一遍').toContain('entry.body');

    const profile = stripComments(read('apps/mobile/src/screens/ProfileScreen.tsx'));
    expect(profile, '入口徽标不带上共享动态的未读 ⇒ 那一档没人会去点').toContain('shareActivityUnreadCount');
    // 光"订阅了"不算数：画到屏幕上、念给读屏的那两处必须用的是相加后的数。
    expect(profile).toContain('count: inboxBadge');
    expect(profile).toContain('{inboxBadge}');
    // 🔴 上面那两枚钉的是"引用换了吗"，钉不住"数本身换了吗"：本批真犯过把
    // `inboxBadge` 定义成 `inboxUnread`（只数 inbox）而三处引用照旧 —— 两枚都绿、
    // 徽标却永远不带上共享动态。所以把**相加这个形状**也钉住（#582）。
    expect(profile, '徽标那枚数不是两格未读相加 ⇒ 共享动态来了入口也不动').toContain(
      'inboxUnread + shareUnread',
    );

    const app = stripComments(read('apps/mobile/src/App.tsx'));
    expect(app, '装配点没把当下的合并视图交给正文组装 ⇒ 名字永远是空的').toContain(
      'mobileShareActivityBody(tr, currentState(), shareId, kind)',
    );
    expect(app, '句子不许在装配点手写（口径归 ui + `lib/share-activity-copy.ts`）').not.toContain(
      'shareActivityNotificationBody(',
    );
  });
});

/*
 * ⑧ 正文挑哪一句（`lib/share-activity-copy.ts` 那一格的行为）。
 * 这一组不需要设备：`state` 由调用方交进来，所以"那一行还没有名字""本机认不出这份
 * share"这两档能在 node 里逐格跑到 —— 留在 `App.tsx` 的闭包里就只能靠源码文本判，
 * "永远不带清单名"那种改法量不到（本批变异臂实测抓出）。
 */
describe('⑧ 正文挑哪一句（ADR-0071 那一档口径在壳里的落地形状）', () => {
  it('本机有那一行且有名字 ⇒ 三档种类各挑 `activityNamed.*` 那三句，插的就是那个名字', () => {
    const state = stateOf([{ shareId: 's1', name: '家庭采购' }]);
    for (const [kind, key] of [
      ['added', 'common.share.activityNamed.added'],
      ['deleted', 'common.share.activityNamed.deleted'],
      ['completed', 'common.share.activityNamed.completed'],
    ] as const) {
      expect(mobileShareActivityBody(fakeT('中'), state, 's1', kind), `种类 ${kind} 挑错句`).toBe(
        `中:${key}:家庭采购`,
      );
    }
  });

  it('本机认不出这份 share ⇒ 落 `activity.*` 那句，不编一个名字出来', () => {
    const state = stateOf([{ shareId: 's1', name: '家庭采购' }]);
    expect(mobileShareActivityBody(fakeT('中'), state, 's-没绑定', 'added')).toBe(
      '中:common.share.activity.added',
    );
  });

  it('那一行存在但还没有名字 ⇒ 同样落匿名那句（名字取不到是常态，不是错误）', () => {
    const state = stateOf([{ shareId: 's1' }]);
    expect(mobileShareActivityBody(fakeT('中'), state, 's1', 'deleted')).toBe(
      '中:common.share.activity.deleted',
    );
  });

  it('🔴 正文里只许出现清单名：三句带进来的插值变量**只有** `name`', () => {
    const state = stateOf([{ shareId: 's1', name: '家庭采购' }]);
    const varKeys: string[] = [];
    const spy = (key: MessageKey, vars?: MessageVars): string => {
      // 对照臂：变量一格都不许漏记（漏记了这条就恒真）。
      varKeys.push(...(vars === undefined ? [] : Object.keys(vars)));
      return key;
    };
    for (const kind of ['added', 'deleted', 'completed'] as const) {
      mobileShareActivityBody(spy, state, 's1', kind);
    }
    expect(varKeys, '有名那三句各该带一次插值').toHaveLength(3);
    expect([...new Set(varKeys)].sort(), '正文里塞进了清单名之外的东西（条目内容不许进通知）').toEqual([
      'name',
    ]);
  });
});
