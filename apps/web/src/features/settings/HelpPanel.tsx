import { ICON_SIZE } from '@heyta/design-system';
/**
 * 「帮助与关于」面板（设置页）
 * ==============================
 *
 * 🔴 这个面板是**产品孤岛的另一半**的落点（见 `lib/site-url.ts` 的文件头）。
 *
 * 在此之前，应用里**没有任何一处**能到达站点的帮助 / 价格 / 更新动态。
 * 所以用户在应用里遇到问题时，唯一的出路是去搜索引擎找 ——
 * 而那意味着他会找到别家的产品。
 *
 * ## 为什么三件事放在一个面板里
 *
 * 它们不是三个功能，而是**同一个问题的三种问法**：
 *   - 「这个怎么做？」→ 帮助中心
 *   - 「这东西还在维护吗？」→ 更新动态
 *   - 「要不要花钱、花了钱买什么？」→ 价格
 * 拆成三个面板会让设置页多出两段只有一行字的区块；合在一起，
 * 用户扫一眼就知道"关于这个产品的事都在这条线上"。
 *
 * ## 为什么是**链接**而不是把内容搬进应用
 *
 * 帮助中心的文案与页面形态是**站点**的职责（`apps/landing`），
 * 因为它要能独立被索引、独立被分享（详见 ADR-0033）。
 * 在应用里再写一份，就是第二份会漂移的副本 —— 而漂移的那一半
 * 恰恰是搜不到的那一半。
 *
 * ## 外链必须带 `rel="noopener noreferrer"`
 *
 * `noopener` 防的是被打开页面通过 `window.opener` 反向操纵本页
 * （同一个来源也照带：站点与应用将来可能分域名，而"将来"不是不带的理由）；
 * `noreferrer` 一起带上，是因为这些链接的 Referer 会泄露用户
 * **当前在应用的哪个页面**，而那是用户自己的信息。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 M3 第五刀（settings）：**行的骨架已收进共享层**
 *
 * 三个入口与那句"没有检查更新按钮"的说明，现在都由 `@heyta/ui` 的
 * `SettingsSection` + `SettingsRow` 渲染（与 mobile 的「我的」屏同一份实现）。
 * 本文件不再自己拼 `<ul>` / `<li>` / `<a class="ht-btn">` / `<span class="ht-settings__hint">`。
 *
 * 🔴 **它仍然是三个真链接**（`apps/web/tests/app-mount.spec.tsx` 会断言
 * `[data-testid="about-links"] a` 恰好三个、各带 `rel="noopener noreferrer"`）。
 * 这不是靠宿主自己写 `<a>` 保住的 —— 共享动作行的 `href` 在
 * `react-native-web` 下渲染出来**就是**真实的 `<a>`（实测见
 * `packages/ui/src/settings/Settings.tsx` 文件头）。所以这里只传 `href`，
 * `rel` 由共享层给。
 *
 * ⚠️ `listTestID="about-links"` 是**给那条既有断言留的口子**：共享层负责容器，
 * 但容器的 `data-testid` 由宿主指定。没有它，那条断言只能靠改测试迁就 ——
 * 而 `apps/web/tests/**` 不在本刀白名单里。
 *
 * ⚠️ 每个面板各自包一层 `<HeytaUiProvider>`：`view === 'settings'` 那棵子树
 * 在 `App.tsx` 里**没有** Provider（那棵树只覆盖 `tasks` 与 `focus`），
 * 而 `App.tsx` 不在本刀白名单。**不要**把它提成一个只渲染 `{children}` 的
 * 包装组件 —— `check:ui-provider` 的"消费者必须在 Provider 子树内"是按
 * **同一文件内的配对标签**算的，隔一个文件就判成"在之外"，门禁会红。
 */

import { BookOpen, HelpCircle, ScrollText, Tag } from 'lucide-react';
import type { MessageKey } from '@heyta/i18n';
import {
  HeytaUiProvider,
  SettingsRow,
  SettingsSection,
  type SettingsRowModel,
} from '@heyta/ui';

import { useI18n } from '@heyta/i18n';

import { siteLink } from '../../lib/site-url.js';

/**
 * 一条指向站点的入口。
 *
 * `labelKey` / `hintKey` 是 `MessageKey` 而不是字符串 —— 于是"新加一条
 * 却忘了加词条"是编译错误，而不是界面上冒出半句中文。
 */
interface SiteEntry {
  readonly labelKey: MessageKey;
  readonly hintKey: MessageKey;
  readonly path: string;
  readonly icon: typeof HelpCircle;
}

const ENTRIES: readonly SiteEntry[] = [
  {
    labelKey: 'web.about.help.label',
    hintKey: 'web.about.help.hint',
    path: '/help',
    icon: HelpCircle,
  },
  {
    labelKey: 'web.about.changelog.label',
    hintKey: 'web.about.changelog.hint',
    path: '/changelog',
    icon: ScrollText,
  },
  {
    labelKey: 'web.about.pricing.label',
    hintKey: 'web.about.pricing.hint',
    path: '/pricing',
    icon: Tag,
  },
];

export function HelpPanel(): React.JSX.Element {
  const { t } = useI18n();

  /**
   * 三条站内入口 → 共享的类型化动作行。
   *
   * 🔴 图标走 `leading` 插槽（web 的字形来自 `lucide-react` 的组件，
   * 而共享层吃 `lucide` 的数据 —— 两端不同源，所以记号由宿主给，
   * 见 `packages/ui/src/settings/model.ts` 的 `SettingsActionRow.leading`）。
   * 三个入口各有各的字形，**丢掉它们就是为统一而降级**。
   */
  const rows: readonly SettingsRowModel[] = ENTRIES.map((entry) => {
    const Glyph = entry.icon;
    return {
      kind: 'action',
      testID: `about-link-${entry.path.replace('/', '')}`,
      label: t(entry.labelKey),
      hint: t(entry.hintKey),
      href: siteLink(entry.path),
      leading: <Glyph size={ICON_SIZE.xs} aria-hidden="true" />,
    };
  });

  return (
    <HeytaUiProvider>
      <SettingsSection
        testID="about-panel"
        title={t('web.about.title')}
        note={t('web.about.lead')}
        rows={rows}
        listTestID="about-links"
      >
        {/*
          🔴 这里**故意没有**「检查更新」按钮。
          应用是 PWA，更新由 Service Worker 在后台决定，点击"立即检查"
          什么都不会发生 —— 而一个点了没反应的按钮比没有按钮更坏
          （同一条判据见 `Pricing.tsx`：渠道未接通时不放付款按钮）。
          把"为什么没有"写出来，比留一个空位强。
        */}
        <SettingsRow
          row={{
            kind: 'note',
            testID: 'about-update-note',
            text: t('web.about.updateNote'),
            leading: <BookOpen size={ICON_SIZE.xs} aria-hidden="true" />,
          }}
        />
      </SettingsSection>
    </HeytaUiProvider>
  );
}
