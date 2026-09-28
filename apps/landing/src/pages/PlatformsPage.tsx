/**
 * `/platforms`：平台状态
 * =========================
 *
 * 🔴 **这一页叫"平台状态"，不叫"下载"。** 我们目前没有可发布的安装包：
 * 桌面三平台的包**未签名、未公证、没有安装器**；iOS 只到模拟器交互级；
 * 鸿蒙能出 HAP 但跑不起来。所以这一页讲的是"现在到哪了"。
 *
 * 判据在 `content.ts`：每一行的说法都必须与 `docs/plans/roadmap.md` 的状态表
 * 对得上（A2-6 要求一条一致性检查，属于 W2）。
 *
 * ⚠️ **没有下载按钮。** 一个"下载"按钮点下去是 404、或者给到一个装不上的包，
 * 比没有这个按钮更坏 —— 它花掉的是访客对整站其它说法的信任。
 */

import { useI18n, type MessageKey } from '@heyta/i18n';

import {
  SiteSubPage,
  StatusBadge,
  type PlatformStatus,
} from '../site/PageSections.js';
import {PLATFORM_SECTIONS, PLATFORM_NOTES} from '../site/content.js';
import type { SitePage } from '../site/pages.js';

export function PlatformsPage({ page }: { page: SitePage }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <SiteSubPage page={page} notes={PLATFORM_NOTES} sections={PLATFORM_SECTIONS}>
      {/*
        状态说明。
        🔴 没有它，三个徽标就是**三个没有定义的词** —— 访客看到「进行中」
        只能猜它意味着"快好了"还是"还早"。三条词条本来就写好了
        （`site.platforms.legend.*`），缺的只是有人渲染它。
      */}
      <div className="lp-legend">
        {(['available', 'partial', 'blocked'] as const).map((status) => (
          <div key={status} className="lp-legend__item">
            <StatusBadge status={status} />
            <span>{t(LEGEND_KEYS[status])}</span>
          </div>
        ))}
      </div>
    </SiteSubPage>
  );
}

/** 图例文案。与徽标共用同一个档位联合类型 —— 加一档时两处一起被编译期提醒。 */
const LEGEND_KEYS: Record<PlatformStatus, MessageKey> = {
  available: 'site.platforms.legend.available',
  partial: 'site.platforms.legend.partial',
  blocked: 'site.platforms.legend.blocked',
};
