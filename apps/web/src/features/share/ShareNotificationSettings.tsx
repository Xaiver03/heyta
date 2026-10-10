/**
 * `ShareNotificationSettings` —— 设置 → 同步与隐私 里的「共享协作」小节（W5）。
 * ================================================================================
 *
 * 挂载 `NotificationPrefsPanel`（共享层组件壳）+ 本地偏好落盘。
 *
 * 🔴 **偏好只存本地**（计划 W5 / ADR-0062 通知盲推那条线）：服务端只广播
 *    信号，"响不响"由本机过滤 ⇒ 改这些开关**零网络请求**（e2e 断言钉住）。
 *
 * 🔴 顺序在「隐私同意」之前**不成立**：这一节是同步的下游偏好，跟着
 *    `SyncSettingsPanel` 走（同一组）；没配同步时整节不渲染 —— 空转的开关
 *    是"这按钮是不是坏了"那种噪音（与侧栏「加入共享清单」同一条判据）。
 */

import { useCallback, useState } from 'react';

import { useI18n } from '@heyta/i18n';
import {
  DEFAULT_NOTIFICATION_PREFS,
  NotificationPrefsPanel,
  type ShareNotificationPrefs,
} from '@heyta/ui';
import { HeytaUiProvider } from '@heyta/ui';

const PREFS_STORAGE_KEY = 'heyta.share-notif-prefs.v1';

function loadPrefs(): ShareNotificationPrefs {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (raw === null) return DEFAULT_NOTIFICATION_PREFS;
    const parsed = JSON.parse(raw) as Partial<ShareNotificationPrefs>;
    // 逐字段回填而不是整块信任磁盘：坏数据回落默认值，不让一个键拖垮整节。
    return {
      activities: {
        onCompleted: parsed.activities?.onCompleted ?? DEFAULT_NOTIFICATION_PREFS.activities.onCompleted,
        onAdded: parsed.activities?.onAdded ?? DEFAULT_NOTIFICATION_PREFS.activities.onAdded,
        onDeleted: parsed.activities?.onDeleted ?? DEFAULT_NOTIFICATION_PREFS.activities.onDeleted,
      },
      taskScope: parsed.taskScope ?? DEFAULT_NOTIFICATION_PREFS.taskScope,
      autoAcceptKnownCollaborators:
        parsed.autoAcceptKnownCollaborators ?? DEFAULT_NOTIFICATION_PREFS.autoAcceptKnownCollaborators,
    };
  } catch {
    return DEFAULT_NOTIFICATION_PREFS;
  }
}

export function ShareNotificationSettings(): React.JSX.Element {
  const { t } = useI18n();
  const [prefs, setPrefs] = useState<ShareNotificationPrefs>(() => loadPrefs());

  const onChange = useCallback((next: ShareNotificationPrefs) => {
    // 只落本地，不出网（W5 判据：改设置零请求）。
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(next));
    setPrefs(next);
  }, []);

  return (
    <div className="ht-settings__subsection" data-testid="share-notification-settings">
      <h3 className="ht-settings__h3">{t('common.share.notif.sectionTitle')}</h3>
      <HeytaUiProvider>
        <NotificationPrefsPanel
          prefs={prefs}
          labels={{
            sectionTitle: t('common.share.notif.sectionTitle'),
            activitiesTitle: t('common.share.notif.activitiesTitle'),
            activityCompleted: t('common.share.notif.activityCompleted'),
            activityAdded: t('common.share.notif.activityAdded'),
            activityDeleted: t('common.share.notif.activityDeleted'),
            taskScopeTitle: t('common.share.notif.taskScopeTitle'),
            taskScopeAll: t('common.share.notif.taskScope.all'),
            taskScopeAllExceptAssignedToOthers: t('common.share.notif.taskScope.allExceptAssignedToOthers'),
            taskScopeAssignedToMe: t('common.share.notif.taskScope.assignedToMe'),
            taskScopeNone: t('common.share.notif.taskScope.none'),
            autoAcceptTitle: t('common.share.notif.autoAcceptTitle'),
          }}
          onChange={onChange}
        />
      </HeytaUiProvider>
    </div>
  );
}
