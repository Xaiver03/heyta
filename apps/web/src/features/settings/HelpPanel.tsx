/** Website content has a single home; this panel only provides browser entry points. */
import { ICON_SIZE } from '@heyta/design-system';
import { ArrowUpRight, BookOpen, ScrollText, Send, Tag } from 'lucide-react';
import { useI18n, type MessageKey } from '@heyta/i18n';
import { isOfficialHostedInstance } from '@heyta/app-host';
import { OPERATOR, operatorFilingLine } from '@heyta/legal';
import { siteLink } from '../../lib/site-url.js';
import { useSyncStore } from '../sync/store.js';
import './help-settings.css';

const ENTRIES = [
  { path: '/docs', label: 'web.about.help.label', hint: 'web.about.help.hint', icon: BookOpen },
  { path: '/changelog', label: 'web.about.changelog.label', hint: 'web.about.changelog.hint', icon: ScrollText },
  { path: '/pricing', label: 'web.about.pricing.label', hint: 'web.about.pricing.hint', icon: Tag },
] satisfies readonly { path: string; label: MessageKey; hint: MessageKey; icon: typeof BookOpen }[];

export function HelpPanel(): React.JSX.Element {
  const { t } = useI18n();
  /**
   * 🔴 **只有在官方托管实例上才印运营者与备案号。**
   *
   * 自建实例上，"运营者"是**把它架起来的那个人**，不是我们 —— 在那一页印
   * 「晓黎（杭州）人工智能科技有限公司 · 浙ICP备2026081423号」，
   * 与把**我们的**隐私政策挂到自建实例上是同一种错（`resolveLegalLinks` 对非官方 host
   * 刻意指向运营者自己的 `/terms.html`："打不开时得到的是一个诚实的 404，
   * **不是一份别人的政策**"）。判断本身只有一处：`isOfficialHostedInstance`。
   *
   * ⚠️ 没配同步（地址为空）⇒ `false` ⇒ 不印。**不知道就不冒充。**
   */
  const serverUrl = useSyncStore((s) => s.baseUrl);

  /**
   * 这一行是本算法对外承诺的**投诉/举报入口**（备案材料与九份法律文本都写了它）。
   *
   * 🔴 `mailto` 这一行**不带** `target="_blank"`：Chrome 会先开一个空白标签页
   * 再去拉起邮件客户端，那一片空白读起来就是"点了没反应"。
   * 尾部那支斜箭头也只给站外链接 —— 它承诺的是"打开一个页面"，
   * 而这一行打开的是邮件应用，承诺由文案自己说（`common.feedback.hint`）。
   *
   * 🔴 收件人**不写在界面里**：它取 `OPERATOR.contactEmail`，也就是隐私政策与
   * 个人信息主体权利页对外公示的那一枚。抄一份到这里就允许两份漂移，
   * 而漂移的症状是用户的举报发进一个没人看的信箱。
   */
  const links = [
    ...ENTRIES.map(({ path, label, hint, icon }) => ({
      testId: `about-link-${path.slice(1)}`,
      href: siteLink(path),
      label,
      hint,
      icon,
      site: true,
    })),
    {
      testId: 'about-link-feedback',
      href: `mailto:${OPERATOR.contactEmail}?subject=${encodeURIComponent(t('common.feedback.subject'))}`,
      label: 'common.feedback.label',
      hint: 'common.feedback.hint',
      icon: Send,
      site: false,
    },
  ] satisfies readonly {
    testId: string;
    href: string;
    label: MessageKey;
    hint: MessageKey;
    icon: typeof BookOpen;
    site: boolean;
  }[];

  return (
    <div className="ht-settings__help" data-testid="about-panel">
      <div className="ht-settings__help-links" data-testid="about-links">
        {links.map(({ testId, href, label, hint, icon: Icon, site }) => (
          <a
            key={testId}
            className="ht-settings__help-link"
            data-testid={testId}
            href={href}
            {...(site ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          >
            <span className="ht-settings__help-icon"><Icon size={ICON_SIZE.md} aria-hidden="true" /></span>
            <span className="ht-settings__help-copy">
              <span className="ht-type-row-title">{t(label)}</span>
              <span className="ht-type-row-meta">{t(hint)}</span>
            </span>
            {site ? <ArrowUpRight size={ICON_SIZE.sm} aria-hidden="true" /> : null}
          </a>
        ))}
      </div>
      <p className="ht-settings__help-note ht-type-row-meta">{t('web.about.lead')}</p>

      {/*
        运营者与备案号。

        🔴 **它是隐私政策里一句承诺的兑现**：`packages/legal` 的隐私政策写着
        「App 备案号以**应用内「关于」页**与服务端对外页公布者为准」——
        所以这两个字段必须**真的从这里渲染出去**。
        2026-10-16 查实：在此之前的 `appFilingNumber` **UI 侧零消费者**，
        核准之后**光把字段填上，它不会出现在任何地方**，而那两处正是我们
        对外说过要公布的地方（应用商店提审也会看这一行）。

        ⚠️ `appFilingNumber` 是 `null` 时**整段不渲染** —— 法务明文
        「不印任何号码，也不编一个看起来合理的占位」，而 `structure.spec.ts`
        有一条双向判据同时禁止占位与漂移。⇒ 今天这里只有主体名与 ICP 号，
        核准那天它会**自己出现**，不需要再改这里。
      */}
      {isOfficialHostedInstance(serverUrl) ? (
        <p className="ht-settings__help-note ht-type-row-meta" data-testid="about-operator">
          {operatorFilingLine(OPERATOR)}
        </p>
      ) : null}
    </div>
  );
}
