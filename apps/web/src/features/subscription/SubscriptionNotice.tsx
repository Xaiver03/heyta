import { ICON_SIZE } from '@heyta/design-system';
/**
 * 托管同步到期 / 被拒时的**克制**提示。
 *
 * ## 它只做一件事：把"降级到底限制了哪一件事"说清楚
 *
 * 产品边界（`docs/plans/subscription-boundary.md` §2）唯一允许被限制的是
 * **通过 heyta 官方托管服务同步 / 新增设备**。所以这块提示：
 *   - **不**说"数据将丢失"（那是假的，本地数据一个字都不动）；
 *   - **不**挡任何界面、**不**禁用任何按钮 —— 到期之后任务照样能看、能编辑、能导出；
 *   - 只给出一条**真的可操作**的出路：改成你自己的服务器。
 *
 * ## 出路有两条：自建服务器，和续费
 *
 * 「现在不存在可跳转的续费地址」这句话**在 2026-10-05 过期了**：
 * 设置页里的 `RenewPanel` 就是续费入口（下单 → 服务端报价冻结 → 拿支付串，
 * 30 天叠加在当前到期日之后）。本提示仍然只给"改用你自己的服务器"这一条按钮 ——
 * 它是**即时可完成的动作**，而续费要先有一个配好收款通道的实例
 * （`WECHAT_PAY_ENABLED=false` 时下单拿到 503，`check:payment-entry` 钉的就是这一对）。
 *
 * ⚠️ 留这行日期是因为它自己就是那类会过期的话：上一版写"到今天仍然成立"，
 * 而判断依据只是**当时**没有入口。
 *
 * ## 分层
 *
 * 判断（该不该降级）在 `@heyta/domain`；措辞在 `./copy`；
 * 这里只负责渲染。措辞**全部在 JSX 之外算好**再引用标识符 ——
 * 界面文案门禁只看 `prop={...}` 里的字符串字面量，直接内联会让它把
 * 词条 **key** 当成"一句没有中文的文案"报红。
 */
import { useEffect } from 'react';
import { cssVar } from '@heyta/design-system';
import { useI18n, type MessageKey } from '@heyta/i18n';
import { CloudOff, Server } from 'lucide-react';

/**
 * 提示的措辞变体。
 *
 * `expired` 与 `refused` 分开，是因为"到期了"和"服务端因其它原因拒绝"
 * 对用户来说是不同的信息 —— 把它们合并成一句会让其中一种说假话。
 */
export type SubscriptionNoticeVariant = 'expired' | 'refused';

/**
 * 变体 → 词条。用 `Record` 而不是 `t(\`...${variant}...\`)`：
 * **动态拼 key 在门禁上是违规的**（拼错了就没有类型检查兜底），
 * 而且 `Record` 让"新加一个变体却忘了加词条"变成编译错误。
 */
const VARIANT_KEYS: Record<SubscriptionNoticeVariant, { title: MessageKey; body: MessageKey }> = {
  expired: {
    title: 'web.subscription.notice.expired.title',
    body: 'web.subscription.notice.expired.body',
  },
  refused: {
    title: 'web.subscription.notice.refused.title',
    body: 'web.subscription.notice.refused.body',
  },
};
import { useSubscriptionStore } from './store.js';
import { useSyncStore } from '../sync/store.js';
import { siteLink } from '../../lib/site-url.js';

export function SubscriptionNotice(): React.JSX.Element | null {
  const { t } = useI18n();
  const access = useSubscriptionStore((s) => s.access);
  const refresh = useSubscriptionStore((s) => s.refresh);
  // 地址 / 令牌一变就重新问一次：用户刚把地址换成自己的服务器时，
  // 提示必须跟着消失，而不是继续举着上一次的旧结论。
  const baseUrl = useSyncStore((s) => s.baseUrl);
  const token = useSyncStore((s) => s.token);
  const openSettings = useSyncStore((s) => s.openSettings);

  useEffect(() => {
    void refresh();
  }, [refresh, baseUrl, token]);

  // 🔴 fail-open 的界面一侧：只有服务端**明确拒绝**时才渲染任何东西。
  // 未配置 / 断网 / 响应异常 → 这里直接 return null。
  if (access.kind !== 'restricted') return null;

  const variant: SubscriptionNoticeVariant = access.expired ? 'expired' : 'refused';
  const { title: titleKey, body: bodyKey } = VARIANT_KEYS[variant];
  const label = t('web.subscription.notice.a11y');
  const title = t(titleKey);
  const body = t(bodyKey);
  const localData = t('web.subscription.notice.localData');
  const selfHost = t('web.subscription.notice.selfHost');

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: cssVar('space.3'),
        padding: cssVar('space.4'),
        marginBlockEnd: cssVar('space.4'),
        border: `${cssVar('border-width.thin')} solid ${cssVar('color.warning')}`,
        borderInlineStartWidth: cssVar('border-width.thick'),
        borderRadius: cssVar('radius.lg'),
        background: cssVar('color.surface'),
        color: cssVar('color.foreground'),
      }}
    >
      <CloudOff
        size={ICON_SIZE.md}
        aria-hidden="true"
        style={{ color: cssVar('color.warning-strong'), flexShrink: 0 }}
      />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: cssVar('space.1'),
          flex: 1,
        }}
      >
        <p style={titleStyle}>{title}</p>
        <p style={bodyStyle}>{body}</p>
        {/* 这一句是整个提示的重点：明确告诉用户"你的数据没被扣"。 */}
        <p style={bodyStyle}>{localData}</p>
        <div className="ht-settings__actions">
          <button type="button" className="ht-btn ht-btn--ghost" onClick={openSettings}>
            <Server size={ICON_SIZE.xs} aria-hidden="true" />
            {selfHost}
          </button>
          {/*
            🔴 这一条是**说明**，不是续费入口。续费入口在设置页的 `RenewPanel`
            （2026-10-05 落地），本提示刻意不复制第二个按钮：
            两个入口指向同一个动作时，其中一个必然先过期 —— 而这条链接回答的是
            "到底能不能买、为什么买不了"，那是价格页在写的东西。
            ⚠️ 待办（未做，别读成已做）：到期用户从这里**一步**走到续费面板的锚点
            还没接（`settingsFocus` 现在只服务 AI 面板）。
          */}
          <a
            className="ht-btn ht-btn--ghost"
            href={siteLink('/pricing')}
            rel="noopener noreferrer"
            data-testid="subscription-pricing-link"
          >
            {t('web.about.pricing.label')}
          </a>
        </div>
      </div>
    </div>
  );
}

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: cssVar('font-size.sm'),
  fontWeight: cssVar('font-weight.semibold'),
  color: cssVar('color.warning-strong'),
};

const bodyStyle: React.CSSProperties = {
  margin: 0,
  fontSize: cssVar('font-size.xs'),
  color: cssVar('color.foreground-muted'),
  lineHeight: cssVar('line-height.normal'),
};
