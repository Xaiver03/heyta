/**
 * ADR-0071「共享清单的通知正文」的**接线**判据 —— 逐形覆盖那五条：
 *  ① 有同意 + 偏好开 ⇒ 句子带清单名
 *  ② 无同意 ⇒ 零打扰
 *  ③ 偏好关 ⇒ 零打扰
 *  ④ 拿不到清单名 ⇒ 回落到不带名字那句，而且**不为此多发一次请求**
 *  ⑤ 🔴 正文里出现任务标题 / 评论正文 ⇒ 红（这一条是口径的牙齿）
 *
 * ## 为什么这一枚必须存在，而不是把五条都写进 `share-activity-notify.spec.ts`
 *
 * 投递件那一份钉的是**接口形状**（拿不到内容、tag 怎么拼）。而"名字从哪儿来、
 * 同意从哪儿来、闸门走没走"全在接线那一段：闸门在 `@heyta/ui` 测过、清单行在
 * `@heyta/app-host` 测过、措辞在 `@heyta/i18n` 里 —— **三段各自都绿**，
 * 只有接起来才会出现"正文里躺着一条评论的原文"这种谁都没测的形状。
 *
 * 🔴 夹具故意往本机状态里塞了任务标题与评论正文两句哨兵。它们出现在最终正文里
 *    就是口径被破 —— 这一枚断言的是**不在**，不是"在得对不对"。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_NOTIFICATION_PREFS, type ShareNotificationPrefs } from '@heyta/ui';
import { DEFAULT_LOCALE, translate } from '@heyta/i18n';

vi.mock('../src/lib/oplog.js', () => ({
  hasEngine: () => true,
  requireEngine: () => ({ getClientId: () => 'device-test' }),
  // 本机状态由 `globalThis.__state` 控制：清单行绑定（决定认不认得 + 名字）与
  // 条目内容（决定⑤有没有牙）都从这一枚喂进来。
  currentState: () => globalThis.__state,
}));

const LIST_NAME = '家庭采购清单';
const TASK_TITLE = '这条任务的标题不许进通知';
const COMMENT_BODY = '这条评论的正文不许进通知';

/**
 * 一次信号拉回两条活动（`CRT` + `DEL`）。评论正文就住在 `payload` 里 ——
 * 端到端加密在本机解得开，所以"解得开"不是假设，夹具里就是明文。
 * ⚠️ 必须住在 `vi.hoisted`：mock 工厂在 import 阶段就执行。
 */
const rig = vi.hoisted(() => {
  const incoming = [
    {
      id: 'op-c-1',
      clientId: 'device-other',
      timestamp: 1_700_000_000_000,
      vectorClock: { 'device-other': 1 },
      actionType: 'add comment',
      opType: 'CRT',
      entityType: 'COMMENT',
      entityId: 'comment-1',
      schemaVersion: 1,
      payload: { body: '这条评论的正文不许进通知' },
    },
    {
      id: 'op-c-2',
      clientId: 'device-other',
      timestamp: 1_700_000_000_001,
      vectorClock: { 'device-other': 2 },
      actionType: 'delete comment',
      opType: 'DEL',
      entityType: 'COMMENT',
      entityId: 'comment-0',
      schemaVersion: 1,
      payload: {},
    },
  ];
  return { log: { ops: [] as unknown[] }, pulled: 0, incoming };
});

vi.mock('../src/features/share/comment-actions.js', () => ({
  createStorageShareLog: () => ({
    load: () => rig.log,
    save: (_id: string, state: { ops: unknown[] }) => void (rig.log = state),
    // 落盘索引那一支由 `globalThis.__indexed` 控制：④ 用它把"闸门放行"与
    // "本机有清单行（名字拿得到）"这两件事分开钉。
    list: () => globalThis.__indexed,
    cursor: () => 0,
    setCursor: () => undefined,
  }),
}));

vi.mock('../src/features/share/share-session.js', () => ({
  ensureWebShareSession: async () => ({
    actions: {},
    channel: { dispatch: async () => undefined, stateFor: () => ({}) },
    commentsForTask: () => [],
    pullForTask: async () => undefined,
    pullShareOps: async () => {
      rig.pulled += 1;
      const fresh = rig.incoming.filter(
        (op) => !rig.log.ops.some((e) => (e as { id: string }).id === op.id),
      );
      rig.log = { ops: [...rig.log.ops, ...fresh] };
      return { fetched: fresh.length, added: fresh.length, cursor: 7, pages: 1 };
    },
  }),
}));

import { CONSENT_STORAGE_KEY } from '../src/features/share/share-consent-store.js';
import { PREFS_STORAGE_KEY } from '../src/features/share/share-notif-prefs.js';
import { useShareActivitySignal } from '../src/features/share/use-share-activity-signal.js';
import { dispatchShareSignal } from '../src/lib/share-signal-sink.js';
import { useSyncStore } from '../src/features/sync/store.js';

declare global {
  // eslint-disable-next-line no-var
  var __state: {
    projects: Record<string, { id: string; name: string; shareId?: string; deletedAt?: Date }>;
    tasks: Record<string, { id: string; title: string }>;
  };
  // eslint-disable-next-line no-var
  var __indexed: string[];
}

type Recorded = { title: string; options?: { body?: string; tag?: string } };

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let sent: Recorded[] = [];

class FakeNotification {
  static permission: NotificationPermission = 'granted';
  constructor(title: string, options?: { body?: string; tag?: string }) {
    sent.push({ title, options });
  }
}

function SignalHost(): null {
  useShareActivitySignal();
  return null;
}

const setPrefs = (prefs: Partial<ShareNotificationPrefs>) => {
  localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
};

const acceptConsent = () => {
  localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ consentAcceptedAt: 1_700_000_000_000 }));
};

/** 本机有一条清单行绑定着这份 share（= 名字是**现成**的，不需要任何请求）。 */
const bindRow = () => {
  globalThis.__state = {
    projects: { 'p-1': { id: 'p-1', name: LIST_NAME, shareId: 'share-1' } },
    tasks: { 't-1': { id: 't-1', title: TASK_TITLE } },
  };
};

/** 清单行还没绑定：靠落盘索引那一支让闸门仍然放行（于是"没名字"与"没拉过"分得开）。 */
const bindNothing = () => {
  globalThis.__state = { projects: {}, tasks: { 't-1': { id: 't-1', title: TASK_TITLE } } };
  globalThis.__indexed = ['share-1'];
};

const fireSignal = async (shareId: string, latestSeq: number) => {
  await act(async () => {
    dispatchShareSignal(shareId, latestSeq);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

beforeEach(() => {
  rig.log = { ops: [] };
  rig.pulled = 0;
  globalThis.__indexed = [];
  sent = [];
  localStorage.clear();
  (globalThis as unknown as { Notification: unknown }).Notification = FakeNotification;
  useSyncStore.setState({
    baseUrl: 'http://sync.test',
    token: 'tok-test',
    accountId: 'acct-test',
    authTransport: 'bearer',
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
  delete (globalThis as unknown as { Notification: unknown }).Notification;
});

describe('ADR-0071 正文口径 · 接线', () => {
  it('① 有同意 + 偏好开 ⇒ 正文带这份共享清单的名字', async () => {
    acceptConsent();
    bindRow();
    setPrefs({
      ...DEFAULT_NOTIFICATION_PREFS,
      activities: { ...DEFAULT_NOTIFICATION_PREFS.activities, onAdded: true },
    });
    await act(async () => {
      root?.render(<SignalHost />);
    });
    await fireSignal('share-1', 7);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.options?.body, `正文要说得出是哪一份清单：${LIST_NAME}`).toContain(LIST_NAME);
  });

  it('② 从没同意过 ⇒ 零打扰（拉取照做，偏好全开也不响）', async () => {
    bindRow();
    setPrefs({
      ...DEFAULT_NOTIFICATION_PREFS,
      activities: { onCompleted: true, onAdded: true, onDeleted: true },
    });
    await act(async () => {
      root?.render(<SignalHost />);
    });
    await fireSignal('share-1', 7);
    expect(rig.pulled, '同意挡的是通知，不是同步 —— 内容照样要落到本机').toBe(1);
    expect(sent, '没同意过就是零打扰').toHaveLength(0);
  });

  it('③ 同意过但偏好关 ⇒ 零打扰（闸门仍是 `selectNotifiedActivities` 那一枚）', async () => {
    acceptConsent();
    bindRow();
    setPrefs(DEFAULT_NOTIFICATION_PREFS);
    await act(async () => {
      root?.render(<SignalHost />);
    });
    await fireSignal('share-1', 7);
    expect(rig.pulled).toBe(1);
    expect(sent).toHaveLength(0);
  });

  it('④ 拿不到清单名 ⇒ 回落到不带名字那句，而且不为此多发一次请求', async () => {
    acceptConsent();
    bindNothing();
    // 落盘索引那一支放行 ⇒ 会拉一次（这是数据腿，不是为名字发的）。
    setPrefs({
      ...DEFAULT_NOTIFICATION_PREFS,
      activities: { ...DEFAULT_NOTIFICATION_PREFS.activities, onAdded: true },
    });
    await act(async () => {
      root?.render(<SignalHost />);
    });
    await fireSignal('share-1', 7);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.options?.body).toBe(translate(DEFAULT_LOCALE, 'common.share.activity.added'));
    expect(sent[0]?.options?.body).not.toContain(LIST_NAME);
    expect(rig.pulled, '一次信号只许换来数据腿那一次拉取 —— 名字不是请求来的').toBe(1);
  });

  it('🔴 ⑤ 本机状态里躺着任务标题与评论正文 ⇒ 它们一句都不许进通知', async () => {
    acceptConsent();
    bindRow();
    setPrefs({
      ...DEFAULT_NOTIFICATION_PREFS,
      activities: { onCompleted: true, onAdded: true, onDeleted: true },
    });
    await act(async () => {
      root?.render(<SignalHost />);
    });
    await fireSignal('share-1', 7);
    expect(sent.length, '两类活动 ⇒ 两条通知').toBeGreaterThan(0);
    for (const record of sent) {
      const body = record.options?.body ?? '';
      expect(body, `正文不许出现任务标题：${TASK_TITLE}`).not.toContain(TASK_TITLE);
      expect(body, `正文不许出现评论正文：${COMMENT_BODY}`).not.toContain(COMMENT_BODY);
      expect(body, `这一句只许是「清单名 + 活动种类」：${body}`).toContain(LIST_NAME);
    }
  });
});

/**
 * 裁决四的形状判据：通知这一腿**拿不到**任何出网的口子。
 *
 * 运行时那条（④）只能证明"这一次没发"，源码形状证明的是"这一层没有发得出来的门" ——
 * 与 ADR-0070 那两枚"源码里不许有 setInterval"同一形状。
 */
describe('常驻形状：通知这一腿不许为了名字出网', () => {
  const sources = ['share-activity-notify.ts', 'use-share-activity-signal.ts'] as const;

  for (const file of sources) {
    it(`${file} 里没有共享 API 客户端`, () => {
      const source = readFileSync(join(__dirname, '..', 'src', 'features', 'share', file), 'utf8');
      expect(source.includes('ShareApiClient'), `${file} 又为了拼一句话去建客户端`).toBe(false);
    });
  }
});
