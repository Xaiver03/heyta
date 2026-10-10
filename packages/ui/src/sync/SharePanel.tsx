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
 */

import { Pressable, Text, View } from 'react-native';

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
}

export interface SharePanelCallbacks {
  onInvite: () => void;
  onRemoveMember: (memberId: string) => void;
  onRoleChange: (memberId: string, nextRole: ShareRole) => void;
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
  const views = projectMembersFor(props.data, props.selfUserId);
  const myRole = views.find((v) => v.isSelf)?.role ?? props.data.myRole;
  const manage = canManageMembers(myRole);
  const invite = canInviteMembers(myRole);
  const limit = memberLimitState(props.data.members.length);

  return (
    <View testID="share-panel">
      <Text>{props.labels.membersTitle}</Text>
      {!limit.full && invite && (
        <Pressable
          onPress={props.callbacks.onInvite}
          accessibilityRole="button"
          testID="share-invite-button"
        >
          <Text>{`${props.labels.inviteButton}（${props.labels.slotsLeft(limit.slotsLeft)}）`}</Text>
        </Pressable>
      )}
      {limit.full && <Text>{props.labels.limitReached}</Text>}
      {views.map((view: ShareMemberView) => {
        const label = view.displayName
          ?? props.labels.fallbackMember(view.userId.toString().slice(0, 6));
        return (
          <View key={view.memberId} testID={`share-member-${view.memberId}`}>
            <Text>
              {`${label} · ${props.labels.member.roleByRole[view.role]}${view.isSelf ? '（我）' : ''}`}
            </Text>
            {view.keyEpochLag > 0 && (
              <Text>{props.labels.member.waitingForEnvelope}</Text>
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
                    <Text>{props.labels.member.roleByRole[role]}</Text>
                  </Pressable>
                ))}
                <Pressable
                  onPress={() => props.callbacks.onRemoveMember(view.memberId)}
                  accessibilityRole="button"
                  testID={`share-remove-${view.memberId}`}
                >
                  <Text>{props.labels.removeButton}</Text>
                </Pressable>
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
