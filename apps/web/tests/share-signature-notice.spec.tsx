/**
 * M4 读侧报警进**界面**的那一步（ADR-0069 裁决五在 web 的落点）
 * ==============================================================
 *
 * app-host 那份判据（`packages/app-host/tests/share-read-verify.spec.ts`）证的是**推导**：
 * 伪造件不物化、游标不推进、具名结局随结果交出去。这一枚证的是**用户看不看得到**：
 *
 * | 判据 | 坏法（症状） |
 * |---|---|
 * | 宿主报了拒 ⇒ 内容列顶部出现那一行，说得出是哪一种失败、几条 | 只在控制台/日志里说 ⇒ 同事写的内容悄悄少了，界面一句都不说 |
 * | 宿主没报 ⇒ 什么都不渲染 | 把"这一轮没有需要报警的行"画成"已验证" |
 * | 两种失败各一行、各带自己的条数 | 只画一种 ⇒ "查无此人"被读成"被改动过"，用户以为有人在篡改 |
 * | 被拒那几条带的标识符一个都不出现在文案上 | 把 `opId` / 成员 id / base64 贴给用户 ⇒ 把诊断信息当文案 |
 * | 拉取真拒了 ⇒ 敲一次重画；没拒 ⇒ 一次都不敲 | 只在 `added > 0` 时敲 ⇒ 被拒那条根本没落盘，`added` 恰好是 0，正好漏掉这一族 |
 * | 「知道了」关掉的是**这一版**；清单变了要重新说 | 永久静音 ⇒ 后面又被拒一批时没人知道 |
 *
 * ⚠️ 分工如实写在这儿：前五枚里前四枚钉界面（`ShareSignatureNotice`），后两枚钉
 *    `comment-actions.ts` 那一行接线。仓内最高发的失效形状就是"宿主那边对了、
 *    壳里没人敲通知"，而那正好是本轮要防的静默。
 *
 * 变异验证（一次性臂，实测读数登记在 `research/tools/mutation-rigs/`）：
 * ① 摘掉 `pullShareOps` 里那枚 `emitShareRepaint()` ⇒ 恰好 1 枚具名红（重画那一枚）；
 * ② 把条件改成 `added > 0` ⇒ 同一枚红（被拒那条 `added` 就是 0）；
 * ③ 让 `ShareSignatureNotice` 无条件渲染（`rejections.length === 0` 也不返回 `null`）⇒
 *    恰好 1 枚具名红（"没报就不渲染"）。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SharePullResult, ShareSignatureRejection } from '@heyta/app-host';

const rig = vi.hoisted(() => ({
  engineChanges: 0,
  /** 这一枚是本轮唯一被 mock 掉的判断：宿主交回来的拉取结果。 */
  pullResult: { fetched: 0, added: 0, cursor: 0, pages: 1, rejections: [] } as unknown as SharePullResult,
}));

/** 这台浏览器那一份共享实例的替身（`ShareSignatureNotice` 唯一的数据源）。 */
const session = vi.hoisted(() => ({ rejections: [] as ShareSignatureRejection[] }));

vi.mock('../src/features/share/share-session.js', () => ({
  webShareSession: () => ({ signatureRejections: () => session.rejections }),
  ensureWebShareSession: async () => undefined,
  armWebShareSession: () => undefined,
  resetWebShareSession: () => undefined,
}));

// 拉取那一行的两个通知出口：引擎通知记数即可，重画通知走**真**垫片（订阅者自己数）。
vi.mock('../src/lib/oplog.js', () => ({
  emitEngineChange: () => {
    rig.engineChanges += 1;
  },
  currentState: () => ({}),
  dispatchChecked: async () => undefined,
  dispatchIntent: async () => undefined,
}));
vi.mock('../src/lib/central-fetch.js', () => ({
  createWebAuthFetch: () => async () => {
    throw new Error('这一枚判据不发请求');
  },
}));
// 共享写通道的宿主实现：只交出 `rig.pullResult` 那一枚结果，别的全是壳。
vi.mock('@heyta/app-host', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@heyta/app-host')>();
  return {
    ...mod,
    createShareCommentDispatch: () => ({
      dispatchShareOp: async () => undefined,
      pullShareOps: async () => rig.pullResult,
      commentsForTask: () => [],
      stateFor: () => ({}),
      conflicts: () => [],
      resolveConflict: async () => undefined,
      signatureRejections: () => session.rejections,
    }),
  };
});

import { ShareSignatureNotice } from '../src/features/share/ShareSignatureNotice.js';
import { createWebShareComments } from '../src/features/share/comment-actions.js';
import { emitShareRepaint, subscribeShareRepaint } from '../src/lib/share-signal-sink.js';

function rejection(over: Partial<ShareSignatureRejection> = {}): ShareSignatureRejection {
  return {
    shareId: 'share-1',
    opId: 'op-forged-2',
    serverSeq: 2,
    clientId: 'device-A',
    outcome: 'invalid',
    signerMemberId: 'member-a',
    ...over,
  };
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function renderNotice(): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<ShareSignatureNotice />);
  });
  return container;
}

function noticeOf(el: HTMLElement): Element | null {
  return el.querySelector('[data-testid="share-signature-notice"]');
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
  session.rejections = [];
  rig.engineChanges = 0;
  rig.pullResult = { fetched: 0, added: 0, cursor: 0, pages: 1, rejections: [] };
});

describe('验签被拒 ⇒ 界面那一行', () => {
  it('🔴 有一条被拒 ⇒ 渲染具名失败：说得出"对不上签名"、几条、没有接收', () => {
    session.rejections = [rejection()];
    const el = renderNotice();
    const notice = noticeOf(el);
    expect(notice).not.toBeNull();
    expect(notice?.getAttribute('role')).toBe('alert');
    expect(notice?.getAttribute('aria-live')).toBe('assertive');
    expect(el.textContent).toContain('对不上作者的签名');
    expect(el.textContent).toContain('1 条');
    expect(el.textContent).toContain('没有接收');
  });

  it('🔴 宿主没报任何拒 ⇒ 整块不渲染（"这一轮没有需要报警的行"不等于"已验证"）', () => {
    session.rejections = [];
    const el = renderNotice();
    expect(noticeOf(el)).toBeNull();
    expect(el.textContent).not.toContain('签名');
  });

  it('两种失败各一行、各带自己的条数（不能把"查无此人"画成"被改动过"）', () => {
    session.rejections = [
      rejection({ serverSeq: 2 }),
      rejection({ serverSeq: 3 }),
      rejection({ serverSeq: 4, outcome: 'signer-unregistered', opId: 'op-no-key', signerMemberId: 'member-b' }),
    ];
    const el = renderNotice();
    const invalid = el.querySelector('[data-testid="share-signature-invalid"]');
    const unregistered = el.querySelector('[data-testid="share-signature-signer-unregistered"]');
    expect(invalid?.textContent).toContain('2 条');
    expect(invalid?.textContent).not.toContain('查不到');
    expect(unregistered?.textContent).toContain('1 条');
    expect(unregistered?.textContent).toContain('查不到作者登记的签名');
  });

  it('🔴 被拒那几条带的标识符一个都不许出现在文案上', () => {
    session.rejections = [rejection()];
    const el = renderNotice();
    for (const leaked of ['op-forged-2', 'share-1', 'member-a', 'device-A']) {
      expect(el.textContent, `界面漏出了 ${leaked}`).not.toContain(leaked);
    }
  });

  it('后台那一趟拉到新内容 ⇒ 重画信号让这一节自己重读，不用重挂载', () => {
    session.rejections = [];
    const el = renderNotice();
    expect(noticeOf(el)).toBeNull();

    // 与 `comment-actions.ts` 那枚通知同一个入口：信号一到，订阅者自己再去读那一份实例。
    session.rejections = [rejection()];
    act(() => {
      emitShareRepaint();
    });
    expect(noticeOf(el)).not.toBeNull();
  });

  it('🔴 「知道了」关掉这一版；被拒的清单变了就重新说（关掉不等于解决）', () => {
    session.rejections = [rejection()];
    const el = renderNotice();
    const dismiss = el.querySelector<HTMLElement>('[data-testid="share-signature-notice-dismiss"]')!;

    act(() => {
      dismiss.click();
    });
    expect(noticeOf(el)).toBeNull();

    // 同一批再敲一次信号：仍然收着 —— 用户已经看过这一版。
    act(() => {
      emitShareRepaint();
    });
    expect(noticeOf(el)).toBeNull();

    // 又来了一条新的 ⇒ 必须重新出现。
    session.rejections = [rejection(), rejection({ serverSeq: 5 })];
    act(() => {
      emitShareRepaint();
    });
    expect(noticeOf(el)).not.toBeNull();
  });
});

/*
 * 下面这三枚钉的是 `comment-actions.ts` 里那一行通知。重画垫片本身**不 mock** ——
 * mock 掉它，"接没接上"就退化成在数替身。
 */
describe('拉取真拒了 ⇒ web 那一行通知', () => {
  /** 造一份真壳宿主：只把**拉取结果**这一枚换成假的，其余（构造、包一层、返回形状）全真。 */
  function host(): NonNullable<ReturnType<typeof createWebShareComments>> {
    const comments = createWebShareComments({
      baseUrl: 'https://sync.test',
      token: 'tok',
      userId: 'u-me',
      clientId: 'device-A',
      schemaVersion: 1,
      vaultCipher: {} as never,
      storage: {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      } as unknown as Storage,
    });
    if (comments === undefined) throw new Error('壳宿主没建起来（依赖门槛没过）');
    return comments;
  }

  function countRepaints(): { calls: () => number; off: () => void } {
    let n = 0;
    const off = subscribeShareRepaint(() => {
      n += 1;
    });
    return { calls: () => n, off };
  }

  it('🔴 被拒一条而 `added = 0` ⇒ 仍然敲一次重画（旧条件"added>0 才敲"正好漏掉这一族）', async () => {
    rig.pullResult = { fetched: 1, added: 0, cursor: 0, pages: 1, rejections: [rejection()] };
    const seen = countRepaints();
    try {
      await host().pullShareOps('share-1');
      expect(seen.calls()).toBe(1);
      // 内容一条都没落盘 ⇒ 引擎通知一次都不该敲（两枚通知各管各的，不是同义词）。
      expect(rig.engineChanges).toBe(0);
    } finally {
      seen.off();
    }
  });

  it('对照臂：没拒而真拿到新内容 ⇒ 只敲引擎通知，重画一次都不敲', async () => {
    rig.pullResult = { fetched: 2, added: 2, cursor: 7, pages: 1, rejections: [] };
    const seen = countRepaints();
    try {
      await host().pullShareOps('share-1');
      expect(seen.calls()).toBe(0);
      expect(rig.engineChanges).toBe(1);
    } finally {
      seen.off();
    }
  });

  it('🔴 一轮拉取没有 `rejections` 这一格（旧结果形状）⇒ 不报错、也不敲重画', async () => {
    rig.pullResult = { fetched: 0, added: 0, cursor: 7, pages: 1 };
    const seen = countRepaints();
    try {
      const result = await host().pullShareOps('share-1');
      expect(result.rejections).toBeUndefined();
      expect(seen.calls()).toBe(0);
    } finally {
      seen.off();
    }
  });
});
