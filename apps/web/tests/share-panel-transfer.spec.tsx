/**
 * 判据：**转让所有权必须两步确认，且确认句说清后果**（W6；语义拍板见计划）
 * ==========================================================================
 *
 * 为什么值得逐条写：转让是成员面板里唯一**单向**的管理动作 ——
 * 角色可再改、移除可重邀，转让后原 owner 拿不回 owner 身份
 * （除非新 owner 再转回来）。所以交互形状钉三件事：
 *
 * **A. 两步，不是一步。** 第一次按只 `armed`（换出确认块），回调**不许发**；
 *    第二次按「确认转让」才发。一次误触就丢所有权，是不可接受的形状。
 * **B. 确认块说清后果。** 「转让后你将成为『可编辑』成员」必须在确认块里
 *    逐字出现 —— 用户确认的是**这句话**，不是一个「确定？」。
 * **C. 入口如实。** 只给 owner 看（`canManageMembers`）；owner 自己的行
 *    没有转让入口（自己转给自己没有语义）；非 owner 一个转让按钮都没有。
 *
 * ⚠️ 本测试用 `@heyta/ui` 的 **`dist/`**（package exports）。
 *    改完 `packages/ui` 源码必须先 `pnpm --filter @heyta/ui build`。
 * ⚠️ RNW 的 `Pressable` 渲染成 `<div role="button">`，`testID` 落
 *    `data-testid`；一律按 `data-testid` 寻址、真实 `.click()` 触发。
 *
 * 变异臂（2026-10-10 实测）：把 `SharePanel` 第一次按的 `setTransferArmed`
 * 换成直接调 `onTransferOwnership`（一步转让）⇒ A 的「确认块出现 + 回调未发」
 * 具名转红；还原后本文件全绿。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { translate } from '@heyta/i18n';
import { SharePanel, type SharePanelLabels, type SharePanelProps } from '@heyta/ui';

// 走真实词条（编译期查键）：确认句里有没有说清后果，词条本身就是判据的一部分。
const CONFIRM_HINT = translate('zh-CN', 'web.share.transfer.confirmHint');

const LABELS: SharePanelLabels = {
  membersTitle: '成员',
  member: {
    roleByRole: { owner: '所有者', editor: '可编辑', commenter: '可评论', viewer: '只读' },
    waitingForEnvelope: '等待密钥分发',
  },
  inviteButton: '邀请',
  slotsLeft: (n) => `还可邀请 ${n} 人`,
  limitReached: '名额已满',
  removeButton: '移除',
  fallbackMember: (idPrefix) => `成员 ${idPrefix}`,
  transfer: { button: '转让所有权', confirmHint: CONFIRM_HINT, confirm: '确认转让', cancel: '取消' },
};

const OWNER_DATA = {
  shareId: 'sh1',
  ownerId: 7,
  keyEpoch: 1,
  myRole: 'owner' as const,
  members: [
    { memberId: 'm-owner', userId: 7, role: 'owner', addedAt: 1, hasEnvelope: true, memberKeyEpoch: 1 },
    { memberId: 'm-bob', userId: 8, role: 'editor', addedAt: 2, hasEnvelope: true, memberKeyEpoch: 1 },
  ],
  selfMemberId: 'm-owner',
};

const EDITOR_DATA = {
  ...OWNER_DATA,
  myRole: 'editor' as const,
  selfMemberId: 'm-bob',
};

let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  // B（前置）那条不渲染组件 —— root 可能没被赋值。
  const mounted = root;
  if (mounted !== undefined) act(() => { mounted.unmount(); });
  root = undefined;
  container.remove();
});

function renderPanel(data: SharePanelProps['data']) {
  const callbacks = {
    onInvite: () => {},
    onRemoveMember: vi.fn(),
    onRoleChange: vi.fn(),
    onTransferOwnership: vi.fn(),
  };
  const nextRoot = createRoot(container);
  root = nextRoot;
  act(() => {
    nextRoot.render(<SharePanel data={data} labels={LABELS} callbacks={callbacks} />);
  });
  return callbacks;
}

const byTestId = (id: string) => container.querySelector(`[data-testid="${id}"]`);

describe('SharePanel · 转让所有权（W6 两步确认）', () => {
  it('B（前置）：确认句词条本身就说清「降为可编辑」的后果', () => {
    // 面板只负责把这句话摆出来；句子本身错了，界面再对也是骗确认。
    expect(CONFIRM_HINT).toContain('「可编辑」');
  });

  it('C：入口如实 —— owner 看到**别人**行上的转让按钮，自己的行没有', () => {
    renderPanel(OWNER_DATA);
    expect(byTestId('share-transfer-m-bob')).not.toBeNull();
    // owner 自己的行整块管理动作都不渲染（manage && !view.isOwner）。
    expect(byTestId('share-member-actions-m-owner')).toBeNull();
  });

  it('C：非 owner 一个转让按钮都没有（服务端才是裁决者，界面不摆死路）', () => {
    renderPanel(EDITOR_DATA);
    expect(byTestId('share-member-actions-m-owner')).toBeNull();
    expect(container.querySelectorAll('[data-testid^="share-transfer-"]')).toHaveLength(0);
  });

  it('A+B：第一次按 → 确认块出现、后果句逐字在场、回调**未发**', () => {
    const { onTransferOwnership } = renderPanel(OWNER_DATA);
    act(() => { (byTestId('share-transfer-m-bob') as HTMLElement).click(); });
    const confirm = byTestId('share-transfer-confirm-m-bob');
    expect(confirm).not.toBeNull();
    expect(confirm!.textContent).toContain(CONFIRM_HINT);
    expect(onTransferOwnership).not.toHaveBeenCalled();
  });

  it('A：取消 → 退出确认块、回调不发、转让按钮回来', () => {
    const { onTransferOwnership } = renderPanel(OWNER_DATA);
    act(() => { (byTestId('share-transfer-m-bob') as HTMLElement).click(); });
    act(() => { (byTestId('share-transfer-cancel-m-bob') as HTMLElement).click(); });
    expect(byTestId('share-transfer-confirm-m-bob')).toBeNull();
    expect(onTransferOwnership).not.toHaveBeenCalled();
    expect(byTestId('share-transfer-m-bob')).not.toBeNull();
  });

  it('A：确认 → 回调恰好一次、参数是那一行的 memberId、确认块收起', () => {
    const { onTransferOwnership } = renderPanel(OWNER_DATA);
    act(() => { (byTestId('share-transfer-m-bob') as HTMLElement).click(); });
    act(() => { (byTestId('share-transfer-accept-m-bob') as HTMLElement).click(); });
    expect(onTransferOwnership).toHaveBeenCalledTimes(1);
    expect(onTransferOwnership).toHaveBeenCalledWith('m-bob');
    // armed 已清：确认块离开，回到普通的转让按钮。
    expect(byTestId('share-transfer-confirm-m-bob')).toBeNull();
    expect(byTestId('share-transfer-m-bob')).not.toBeNull();
  });

  it('A：armed 是**单行**的 —— 给 m-bob 掏出确认块时，别的成员行没有确认块', () => {
    const three = {
      ...OWNER_DATA,
      members: [
        ...OWNER_DATA.members,
        { memberId: 'm-carol', userId: 9, role: 'viewer', addedAt: 3, hasEnvelope: true, memberKeyEpoch: 1 },
      ],
    };
    renderPanel(three);
    act(() => { (byTestId('share-transfer-m-bob') as HTMLElement).click(); });
    expect(byTestId('share-transfer-confirm-m-bob')).not.toBeNull();
    expect(byTestId('share-transfer-confirm-m-carol')).toBeNull();
  });
});
