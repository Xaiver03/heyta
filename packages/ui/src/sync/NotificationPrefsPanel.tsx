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
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 文字层级（2026-10-16 补齐，同 `ShareConsentModal` 那一次的理由）
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 这一层面此前**一条文字样式都没有**：所有 `<Text>` 都是 RN 的默认色
 * （**纯黑**，不是"继承容器色"），暗色下就是近黑字压近黑底。
 * `scripts/check-text-color.mjs` 抓到的正是这一档 —— 它判的是结构缺陷，不是审美。
 *
 * 所以这里按**角色**接语义文字样式（`useHeytaText()`），而不是给每个 `<Text>` 补一枚色值：
 *
 * - 面板标题 = `section-title`（区块标题；设置面里"一屏一个"的那一级）
 * - 三个分组标签（活动 / 任务范围 / 自动接受）= `group-label`
 * - 可点的行（三个活动开关、四档范围、自动接受）= `row-title`
 *
 * ⚠️ 语义样式**自带默认前景色**，所以这一层不再需要任何 `color:` 覆盖；
 * 需要别的色在消费点用样式数组覆盖（后面的胜出）。
 */

import { Pressable, Text, View } from 'react-native';

import { useHeytaText } from '../theme.js';
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
  const text = useHeytaText();

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
      <Text style={text['section-title']}>{labels.sectionTitle}</Text>

      <Text style={text['group-label']}>{labels.activitiesTitle}</Text>
      {ACTIVITIES.map(({ kind, key }) => (
        <Pressable
          key={kind}
          onPress={() => toggleActivity(kind)}
          accessibilityRole="checkbox"
          aria-checked={isActivityEnabled(prefs, kind)}
          testID={`share-notif-activity-${kind}`}
        >
          <Text style={text['row-title']}>{labels[key]}</Text>
        </Pressable>
      ))}

      <Text style={text['group-label']}>{labels.taskScopeTitle}</Text>
      <View accessibilityRole="radiogroup" testID="share-notif-task-scope">
        {TASK_SCOPES.map(({ scope, key }) => (
          <Pressable
            key={scope}
            onPress={() => onChange({ ...prefs, taskScope: scope })}
            accessibilityRole="radio"
            aria-checked={prefs.taskScope === scope}
            testID={`share-notif-scope-${scope}`}
          >
            <Text style={text['row-title']}>
              {prefs.taskScope === scope ? '◉ ' : '○ '}{labels[key]}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={text['group-label']}>{labels.autoAcceptTitle}</Text>
      <Pressable
        onPress={() => onChange({ ...prefs, autoAcceptKnownCollaborators: !prefs.autoAcceptKnownCollaborators })}
        accessibilityRole="checkbox"
        aria-checked={prefs.autoAcceptKnownCollaborators}
        testID="share-notif-auto-accept"
      >
        <Text style={text['row-title']}>{labels.autoAcceptTitle}</Text>
      </Pressable>
    </View>
  );
}
