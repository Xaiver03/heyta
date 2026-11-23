/**
 * 应用顶部那条"有新版本"的提示（web）。
 * ======================================
 *
 * 画法**复用**公告横条那套类名（`ht-main__announcement*`，见 `main-area.css`），
 * 因为它就是"主区顶部一条告知 + 一个动作"的同一种形状 —— 再写一套 CSS 只会多一份要做对的样式。
 *
 * - **可选更新**：标题 + 版本行 + 「刷新」「稍后」两个动作，可关。
 * - **强制更新**：标题 + 「刷新」，**没有关闭入口**（`force` 不渲染 later 与 ×）。
 *
 * 🔴 文案全部走词条表（`web.appUpdate.*`），本文件不出现界面字面量 —— `apps/web` 已全量迁移。
 */
import { ICON_SIZE } from '@heyta/design-system';
import { useI18n } from '@heyta/i18n';
import { RefreshCw, X } from 'lucide-react';

import { applyAppUpdate } from './detect.js';
import { useAppUpdateStore } from './store.js';
import { Button } from '../../components/hta/index.js';

export function AppUpdateNotice(): React.JSX.Element | null {
  const { t } = useI18n();
  const prompt = useAppUpdateStore((s) => s.prompt);
  const latestVersion = useAppUpdateStore((s) => s.latestVersion);
  const dismiss = useAppUpdateStore((s) => s.dismiss);

  if (prompt === 'none') return null;
  const force = prompt === 'force';

  return (
    <div
      className={`ht-main__announcement${force ? ' ht-main__announcement--warning' : ''}`}
      role={force ? 'alert' : 'status'}
      data-testid="app-update-banner"
    >
      <RefreshCw size={ICON_SIZE.xs} aria-hidden="true" />
      <div className="ht-main__announcementBody">
        <strong className="ht-main__announcementTitle ht-type-row-title">
          {t(force ? 'web.appUpdate.forceTitle' : 'web.appUpdate.optionalTitle')}
        </strong>
        {latestVersion !== '' ? (
          <p className="ht-main__announcementText">
            {t('web.appUpdate.body', { version: latestVersion })}
          </p>
        ) : null}
        <div className="ht-main__announcementRow">
          <Button type="button" tone="ghost" onClick={applyAppUpdate}>
            {t('web.appUpdate.refresh')}
          </Button>
          {force ? null : (
            <Button type="button" tone="ghost" onClick={dismiss}>
              {t('web.appUpdate.later')}
            </Button>
          )}
        </div>
      </div>
      {force ? null : (
        <button
          type="button"
          className="ht-main__announcementDismiss"
          aria-label={t('web.appUpdate.later')}
          onClick={dismiss}
        >
          <X size={ICON_SIZE.xs} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
