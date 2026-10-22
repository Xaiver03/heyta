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
import {
  HeytaUiProvider,
  SharePanel,
  resolveHeytaUiTheme,
  type SharePanelLabels,
  type SharePanelProps,
} from '@heyta/ui';

/**
 * 主题上下文：`SharePanel` 的角色文字样式走 `useHeytaText()`（`packages/ui/src/theme.js`），
 * 而它必须在 `HeytaUiProvider` 里取值 —— 宿主真实交出去的就是这一层（见 `apps/web/src/App.tsx`）。
 * 本文件只判「转让两步确认」的交互，颜色不在判据里，用默认亮色即可。
 * 夹具必须照宿主形状包一层：不包时本文件 7 条会一起报
 * `useHeytaUiTheme 必须在 <HeytaUiProvider> 内使用。`
 */
const THEME = resolveHeytaUiTheme({ scheme: 'light' });

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
    nextRoot.render(
      <HeytaUiProvider value={THEME}>
        <SharePanel data={data} labels={LABELS} callbacks={callbacks} />
      </HeytaUiProvider>,
    );
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

  // 🔴 B-10：转让入口只给「手里有当前世代钥」的人 —— 两种不合格形状各一臂。
  // 服务端对同一件事回 409，界面这一层不该先摆出一颗点了必报错的按钮。
  it('B-10：目标没有信封（刚接受邀请的默认形状）→ 不给转让按钮，但给那句等待提示', () => {
    const unsealed = {
      ...OWNER_DATA,
      members: [
        OWNER_DATA.members[0]!,
        { ...OWNER_DATA.members[1]!, hasEnvelope: false },
      ],
    };
    renderPanel(unsealed);
    expect(byTestId('share-transfer-m-bob')).toBeNull();
    expect(byTestId('share-member-m-bob')!.textContent).toContain(LABELS.member.waitingForEnvelope);
    // 其余管理动作不受影响（改角色/移除不需要对方有钥）。
    expect(byTestId('share-member-actions-m-bob')).not.toBeNull();
    expect(byTestId('share-remove-m-bob')).not.toBeNull();
  });

  it('B-10：目标有信封但世代落后 → 同样不给按钮、给提示（这一臂管 lag 那一半）', () => {
    const lagging = {
      ...OWNER_DATA,
      members: [
        OWNER_DATA.members[0]!,
        { ...OWNER_DATA.members[1]!, memberKeyEpoch: 0 },
      ],
    };
    renderPanel(lagging);
    expect(byTestId('share-transfer-m-bob')).toBeNull();
    expect(byTestId('share-member-m-bob')!.textContent).toContain(LABELS.member.waitingForEnvelope);
  });

  it('B-10：owner 自己的行不因这一层多出一句提示（合格与否都不给）', () => {
    const ownerLagging = {
      ...OWNER_DATA,
      keyEpoch: 2,
      members: OWNER_DATA.members.map((m) => ({ ...m, memberKeyEpoch: 1 })),
    };
    renderPanel(ownerLagging);
    expect(byTestId('share-member-m-owner')!.textContent)
      .not.toContain(LABELS.member.waitingForEnvelope);
    // 同一条数据里 bob 也落后 ⇒ 他那行给提示、不给按钮（证明上一条不是整屏都不渲染）。
    expect(byTestId('share-member-m-bob')!.textContent).toContain(LABELS.member.waitingForEnvelope);
    expect(byTestId('share-transfer-m-bob')).toBeNull();
  });
});
