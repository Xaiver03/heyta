/**
 * `NotificationPrefsPanel` —— 共享清单通知偏好的设置组件壳（W5）。
 * =====================================================================
 *
 * 模型层：`notification-model.ts`（判定纯函数）。本组件只做三件事：
 * 渲染当前偏好、把用户的开关/档位选择交回宿主、**不判任何业务规则**
 * （判定全部在模型里，组件只是把 `prefs` 传进去拿布尔结果）。
 *
 * 文案由宿主 `t()` 解析后传入（labels）；本包不 import `@heyta/i18n`
 * （AuthForm / ShareConsentModal 同一条纪律）。无障碍：三类开关与
 * 「不再提示」同款真 `Pressable` + 平铺 `aria-checked`；四档用
 * `radiogroup` + 平铺 `aria-checked`。
 *
 * 🔴 「自动接受已知合作者」的开关与三类活动开关**视觉分层**：前者改变
 * 的是"要不要不经确认就入群"（安全相关），后三类只改变"响不响"。
 * 分层是为了让审阅者一眼看出哪一个是安全决策。
 */

import { Pressable, Text, View } from 'react-native';

import {
  isActivityEnabled,
  type ShareActivityKind,
  type ShareNotificationPrefs,
  type TaskReminderScope,
} from './notification-model';

export interface NotificationPrefsLabels {
  sectionTitle: string;
  activitiesTitle: string;
  activityCompleted: string;
  activityAdded: string;
  activityDeleted: string;
  taskScopeTitle: string;
  taskScopeAll: string;
  taskScopeAllExceptAssignedToOthers: string;
  taskScopeAssignedToMe: string;
  taskScopeNone: string;
  autoAcceptTitle: string;
}

export interface NotificationPrefsPanelProps {
  prefs: ShareNotificationPrefs;
  labels: NotificationPrefsLabels;
  /** 用户改偏好 → 宿主落盘（本地），下一轮 props.prefs 带新值进来。 */
  onChange: (prefs: ShareNotificationPrefs) => void;
}

const TASK_SCOPES: ReadonlyArray<{ scope: TaskReminderScope; key: keyof NotificationPrefsLabels }> = [
  { scope: 'all', key: 'taskScopeAll' },
  { scope: 'allExceptAssignedToOthers', key: 'taskScopeAllExceptAssignedToOthers' },
  { scope: 'assignedToMe', key: 'taskScopeAssignedToMe' },
  { scope: 'none', key: 'taskScopeNone' },
];

const ACTIVITIES: ReadonlyArray<{ kind: ShareActivityKind; key: keyof NotificationPrefsLabels }> = [
  { kind: 'completed', key: 'activityCompleted' },
  { kind: 'added', key: 'activityAdded' },
  { kind: 'deleted', key: 'activityDeleted' },
];

export function NotificationPrefsPanel(props: NotificationPrefsPanelProps) {
  const { prefs, labels, onChange } = props;

  const toggleActivity = (kind: ShareActivityKind) => {
    onChange({
      ...prefs,
      activities: {
        onCompleted: kind === 'completed' ? !prefs.activities.onCompleted : prefs.activities.onCompleted,
        onAdded: kind === 'added' ? !prefs.activities.onAdded : prefs.activities.onAdded,
        onDeleted: kind === 'deleted' ? !prefs.activities.onDeleted : prefs.activities.onDeleted,
      },
    });
  };

  return (
    <View testID="notification-prefs-panel">
      <Text>{labels.sectionTitle}</Text>

      <Text>{labels.activitiesTitle}</Text>
      {ACTIVITIES.map(({ kind, key }) => (
        <Pressable
          key={kind}
          onPress={() => toggleActivity(kind)}
          accessibilityRole="checkbox"
          aria-checked={isActivityEnabled(prefs, kind)}
          testID={`share-notif-activity-${kind}`}
        >
          <Text>{labels[key]}</Text>
        </Pressable>
      ))}

      <Text>{labels.taskScopeTitle}</Text>
      <View accessibilityRole="radiogroup" testID="share-notif-task-scope">
        {TASK_SCOPES.map(({ scope, key }) => (
          <Pressable
            key={scope}
            onPress={() => onChange({ ...prefs, taskScope: scope })}
            accessibilityRole="radio"
            aria-checked={prefs.taskScope === scope}
            testID={`share-notif-scope-${scope}`}
          >
            <Text>{prefs.taskScope === scope ? '◉ ' : '○ '}{labels[key]}</Text>
          </Pressable>
        ))}
      </View>

      <Text>{labels.autoAcceptTitle}</Text>
      <Pressable
        onPress={() => onChange({ ...prefs, autoAcceptKnownCollaborators: !prefs.autoAcceptKnownCollaborators })}
        accessibilityRole="checkbox"
        aria-checked={prefs.autoAcceptKnownCollaborators}
        testID="share-notif-auto-accept"
      >
        <Text>{labels.autoAcceptTitle}</Text>
      </Pressable>
    </View>
  );
}
