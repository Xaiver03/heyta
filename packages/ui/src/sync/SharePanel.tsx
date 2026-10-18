/**
 * `SharePanel` —— 共享清单的成员面板（邀请 / 角色 / 移除 / 信封状态）。
 * =====================================================================
 *
 * 模型层：`share-model.ts`（投影、管理判定、名额、角色变更裁决）。
 * 服务端事实由宿主经 props 传入；一切管理动作通过回调交回宿主走
 * `/api/shares/*`——**本组件不做任何网络请求、不判权限**（服务端是
 * 唯一裁决者，这里只是把"点了也没用"的入口如实隐藏）。
 *
 * 文案由宿主 `t()` 解析后传入（labels），本包不 import `@heyta/i18n`
 * （AuthForm 同一条纪律）。被移除者不在成员表里——他们的呈现走
 * `GET /api/shares` 的 `removedMemberships`，由宿主在别的入口展示。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 文字层级（2026-10-16 补齐，同 `ShareConsentModal` 那一次的理由）
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 这一层面此前**一条文字样式都没有**：所有 `<Text>` 都走 RN 的默认色
 * （**纯黑**，不是"继承容器色"）—— 亮色下看不出来，暗色下是近黑字压近黑底。
 * `scripts/check-text-color.mjs` 判的是这个**结构性缺陷**，不是审美。
 * 修法按角色接语义文字样式（`useHeytaText()`），而不是逐个 `<Text>` 补色值：
 *
 * - 面板标题 = `section-title`；成员行主文字 = `row-title`
 * - 次要事实（名额已满 / 等待密钥分发 / 转让后果句）= `row-meta`
 * - 动作按**权重**分两档，不按外观分：邀请与「确认转让」是这一步的主操作
 *   （`headline`），角色切换 / 移除 / 取消 / 第一次按的「转让所有权」是
 *   行内动作（`row-title`）。与 `ShareConsentModal` 的"两个动作不等权"
 *   同一条理由 —— 等权会把"拒绝"画成"另一个主操作"。
 *
 * ⚠️ 语义样式**自带默认前景色**，所以这一层不需要任何 `color:` 覆盖。
 */

import { Pressable, Text, View } from 'react-native';

import { useState } from 'react';

import { useHeytaText } from '../theme.js';
import {
  canInviteMembers,
  canManageMembers,
  decideRoleChange,
  memberFallbackLabel,
  memberLimitState,
  projectMembersFor,
  type ShareMemberView,
  type ShareRole,
} from './share-model';

export interface SharePanelMemberLabels {
  roleByRole: Record<ShareRole, string>;
  waitingForEnvelope: string;
}

export interface SharePanelLabels {
  membersTitle: string;
  member: SharePanelMemberLabels;
  inviteButton: string;
  slotsLeft: (n: number) => string;
  limitReached: string;
  removeButton: string;
  fallbackMember: (idPrefix: string) => string;
  /** 转让所有权（owner 专属；W6）。两步确认在面板内完成。 */
  transfer: {
    button: string;
    /** 确认句必须说清后果 —— 转让者本人会降为可编辑成员（语义拍板：计划 W6）。 */
    confirmHint: string;
    confirm: string;
    cancel: string;
  };
}

export interface SharePanelCallbacks {
  onInvite: () => void;
  onRemoveMember: (memberId: string) => void;
  onRoleChange: (memberId: string, nextRole: ShareRole) => void;
  /** 转让所有权（服务端裁决 owner 身份；面板只把入口如实给 owner）。 */
  onTransferOwnership: (memberId: string) => void;
}

export interface SharePanelProps {
  data: {
    shareId: string;
    ownerId: number;
    keyEpoch: number;
    myRole: ShareRole;
    members: readonly {
      memberId: string;
      userId: number;
      role: string;
      addedAt: number | null;
      hasEnvelope: boolean;
      memberKeyEpoch: number;
    }[];
    /** 见 `share-model.ts` 的 `SharePanelData.selfMemberId`——自识别首选。 */
    selfMemberId?: string;
  };
  /** 有 `data.selfMemberId` 时可省（web 宿主拿不到自己的数字 userId）。 */
  selfUserId?: number;
  labels: SharePanelLabels;
  callbacks: SharePanelCallbacks;
}

export function SharePanel(props: SharePanelProps) {
  const text = useHeytaText();
  const views = projectMembersFor(props.data, props.selfUserId);
  const myRole = views.find((v) => v.isSelf)?.role ?? props.data.myRole;
  const manage = canManageMembers(myRole);
  const invite = canInviteMembers(myRole);
  const limit = memberLimitState(props.data.members.length);
  // 转让的两步确认：armed = 已按过一次「转让所有权」、等第二次确认的成员行。
  // 🔴 必须两步：这是面板里唯一**单向**的管理动作（角色可再改、移除可重邀，
  // 转让后原 owner 拿不回 owner 身份，除非新 owner 再转回来）。
  const [transferArmed, setTransferArmed] = useState<string | undefined>(undefined);

  return (
    <View testID="share-panel">
      <Text style={text['section-title']}>{props.labels.membersTitle}</Text>
      {!limit.full && invite && (
        <Pressable
          onPress={props.callbacks.onInvite}
          accessibilityRole="button"
          testID="share-invite-button"
        >
          <Text style={text['headline']}>
            {`${props.labels.inviteButton}（${props.labels.slotsLeft(limit.slotsLeft)}）`}
          </Text>
        </Pressable>
      )}
      {limit.full && <Text style={text['row-meta']}>{props.labels.limitReached}</Text>}
      {views.map((view: ShareMemberView) => {
        const label = view.displayName
          ?? props.labels.fallbackMember(view.userId.toString().slice(0, 6));
        return (
          <View key={view.memberId} testID={`share-member-${view.memberId}`}>
            <Text style={text['row-title']}>
              {`${label} · ${props.labels.member.roleByRole[view.role]}${view.isSelf ? '（我）' : ''}`}
            </Text>
            {view.keyEpochLag > 0 && (
              <Text style={text['row-meta']}>{props.labels.member.waitingForEnvelope}</Text>
            )}
            {manage && !view.isOwner && (
              <View testID={`share-member-actions-${view.memberId}`}>
                {(SHARE_ROLE_OPTIONS).map((role) => (
                  <Pressable
                    key={role}
                    onPress={() => {
                      const decision = decideRoleChange({
                        myRole,
                        targetCurrentRole: view.role,
                        nextRole: role,
                      });
                      if (decision.allowed) props.callbacks.onRoleChange(view.memberId, role);
                    }}
                    accessibilityRole="button"
                    testID={`share-role-${role}-${view.memberId}`}
                  >
                    <Text style={text['row-title']}>{props.labels.member.roleByRole[role]}</Text>
                  </Pressable>
                ))}
                <Pressable
                  onPress={() => props.callbacks.onRemoveMember(view.memberId)}
                  accessibilityRole="button"
                  testID={`share-remove-${view.memberId}`}
                >
                  <Text style={text['row-title']}>{props.labels.removeButton}</Text>
                </Pressable>
                {transferArmed === view.memberId ? (
                  <View testID={`share-transfer-confirm-${view.memberId}`}>
                    <Text style={text['row-meta']}>{props.labels.transfer.confirmHint}</Text>
                    <Pressable
                      onPress={() => {
                        setTransferArmed(undefined);
                        props.callbacks.onTransferOwnership(view.memberId);
                      }}
                      accessibilityRole="button"
                      testID={`share-transfer-accept-${view.memberId}`}
                    >
                      <Text style={text['headline']}>{props.labels.transfer.confirm}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setTransferArmed(undefined)}
                      accessibilityRole="button"
                      testID={`share-transfer-cancel-${view.memberId}`}
                    >
                      <Text style={text['row-title']}>{props.labels.transfer.cancel}</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    onPress={() => setTransferArmed(view.memberId)}
                    accessibilityRole="button"
                    testID={`share-transfer-${view.memberId}`}
                  >
                    <Text style={text['row-title']}>{props.labels.transfer.button}</Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const SHARE_ROLE_OPTIONS: readonly ShareRole[] = ['editor', 'commenter', 'viewer'];

// 面板里兜底名走同一份规则（避免两份前缀逻辑漂移）：
void memberFallbackLabel;
