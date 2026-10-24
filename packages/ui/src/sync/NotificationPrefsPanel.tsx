/**
 * `NotificationPrefsPanel` —— 共享清单通知偏好的设置组件壳（W5）。
 * =====================================================================
 *
 * 模型层：`notification-model.ts`（判定纯函数）。本组件只做三件事：
 * 渲染当前偏好、把用户的开关/档位选择交回宿主、**不判任何业务规则**
 * （判定全部在模型里，组件只是把 `prefs` 传进去拿布尔结果）。
 *
 * 文案由宿主 `t()` 解析后传入（labels）；本包不 import `@heyta/i18n`
 * （AuthForm / ShareConsentModal 同一条纪律）。无障碍：三类活动开关是
 * 真 `Pressable` + 平铺 `aria-checked`。
 *
 * 🔴 面板只渲染**有输入**的偏好。曾有「任务提醒范围」四档（radiogroup）与
 * 「自动接受已知合作者」开关，2026-10-24 连同判据一起删 —— 理由写在
 * `notification-model.ts`：摆一枚点得动、行为却恒等于「不响」的开关，
 * 等于对用户谎称有能力。
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
 * - 分组标签（活动）= `group-label`
 * - 可点的行（三个活动开关）= `row-title`
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
} from './notification-model';

export interface NotificationPrefsLabels {
  sectionTitle: string;
  activitiesTitle: string;
  activityCompleted: string;
  activityAdded: string;
  activityDeleted: string;
}

export interface NotificationPrefsPanelProps {
  prefs: ShareNotificationPrefs;
  labels: NotificationPrefsLabels;
  /** 用户改偏好 → 宿主落盘（本地），下一轮 props.prefs 带新值进来。 */
  onChange: (prefs: ShareNotificationPrefs) => void;
}

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
    </View>
  );
}
