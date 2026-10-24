import { ICON_SIZE } from '@heyta/design-system';
/**
 * 应用顶部那一横条公告（ADR-0075）。
 * ==================================
 *
 * 一次只画**最新的一条**未忽略的。理由不是省地方：同时挂三条的话，
 * 用户读到的是"这个应用出事了"，而那不是公告的用途。
 * 关掉一条之后下一条会顶上来（`dismissed` 是本机的，见 `store.ts`）。
 *
 * 🔴 没有"待办/已读"计数、没有红点。公告不是任务 ——
 * 给它加一个未读计数会把它变成一件"用户没做完的事"，而它只是一段告知。
 */
import { useEffect } from 'react';

import { useI18n } from '@heyta/i18n/provider';
import { Megaphone, X } from 'lucide-react';

import { useNetworkAllowed } from '../privacy/use-network-allowed.js';
import { useSyncStore } from '../sync/store.js';
import { useAnnouncementStore } from './store.js';

export function AnnouncementBanner(): React.JSX.Element | null {
  const { t } = useI18n();
  const store = useAnnouncementStore();
  const load = useAnnouncementStore((state) => state.load);
  // 🔴 三个"什么时候该拉"的事实，缺一个就会静默不显示，见下面那条注释。
  const networkAllowed = useNetworkAllowed();
  const baseUrl = useSyncStore((state) => state.baseUrl);
  const token = useSyncStore((state) => state.token);

  useEffect(() => {
    // 拉这一次必须**由这些值驱动**，不能只在挂载时拉一次：
    //   · 同意闸门没放行 ⇒ `window.fetch` 被 `installConsentGatedFetch()` 挡下，
    //     这一发拿到的是"被拒"而不是"服务端说没有"，而这一侧对失败的处理是
    //     **什么都不画**（那是对的）—— 于是挂载即拉的那一次会永远静默，
    //     用户答完同意之后没人再拉，表现是"这个部署从来不显示公告"；
    //   · 凭据可能在挂载之后才回来（首启时先看到界面、之后才登录）。
    // 判定本身全在服务端与闸门里，这里只决定"什么时候问一次"。
    if (!networkAllowed || baseUrl.trim() === '' || token === undefined || token === '') return;
    void load();
  }, [networkAllowed, baseUrl, token, load]);

  if (store.items === null) return null;
  const visible = store.items.filter((item) => !store.dismissed.includes(item.id));
  if (visible.length === 0) return null;
  // 服务端按 `publishedAt DESC` 发回来，所以第 0 条就是最新的那条。
  const latest = visible[0]!;

  return (
    <div
      className={`ht-main__announcement${
        latest.level === 'warning' ? ' ht-main__announcement--warning' : ''
      }`}
      role="status"
      data-testid="announcement-banner"
    >
      <Megaphone size={ICON_SIZE.xs} aria-hidden="true" />
      <div className="ht-main__announcementBody">
        <strong className="ht-main__announcementTitle ht-type-row-title">{latest.title}</strong>
        <p className="ht-main__announcementText">{latest.body}</p>
      </div>
      <button
        type="button"
        className="ht-main__announcementDismiss"
        aria-label={t('web.announcements.dismiss')}
        onClick={() => store.dismiss(latest.id)}
      >
        <X size={ICON_SIZE.xs} aria-hidden="true" />
      </button>
    </div>
  );
}
