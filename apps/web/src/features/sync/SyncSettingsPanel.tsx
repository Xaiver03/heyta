/**
 * 设置里的「同步」一节（工单 H9 第 3 刀，2026-10-06）
 * ====================================================
 *
 * ## 它补的是哪一条
 *
 * 产品负责人：「设置不应该点击头像之后再打开吗？」rail 上那颗齿轮**长得像**
 * 全局设置，点下去开的却只是同步设置 —— 而同步设置此前是一个
 * `position: fixed` 的同级浮层，盖在设置浮层之上。
 *
 * 现在同步的凭据就是设置里的**一节**，和「显示」「隐私同意」「AI」并列：
 * 一个屏幕、一套出口（Esc / ✕ / 点回别的视图），不再有第二层浮层。
 * 🔴 这顺带解掉 `docs/plans/goal-layout-audit.md` §8.2 第 6 条登记的那格
 * 「同步设置对话框没有 Esc、焦点进不去」—— 它不再是浮层，那些问题没有载体了。
 *
 * ## 为什么三个输入框的值住在 store 而不是这里
 *
 * `AuthPanel`（注册 / 登录）仍然挂在常驻的 `SyncBar` 上：头像菜单里那一项
 * 也要能直接开它，而那一处**没有**本面板。可"从哪儿开"决定"用哪个地址" ——
 * 从这一节开就必须用**屏幕上那个还没保存的地址**，否则就是
 * "对着 A 登录、把令牌存到 B"（这条纪律原文写在 `SyncBar` 的文件头，
 * 它现在落在 `store.ts` 的 `syncDraft` / `syncDraftShown`）。
 * 触发者在 A、面板在 B ⇒ 局部 state 够不着，与 `signInOpen` 同一条搬家理由。
 *
 * ## 为什么挂载时必须播种（`showSyncDraft`）
 *
 * 这是 2026-09-30 在 Windows 桌面壳上量到的**产品缺陷**的形状：
 * 输入框的初值只在组件挂载那一刻取一次，而常驻的载体长期停在过期快照上 ⇒
 * 点「保存并同步」会用**空地址**覆盖内存配置，同步当场变成"还没配置"
 * （磁盘凭据还在，刷新又能好 —— 最难归因的那种形态）。
 * 本面板随设置浮层挂载/卸载，所以"每次进来都对齐"是结构性的；
 * 钉住它的判据是 `apps/web/tests/sync-settings-prefill.spec.tsx`。
 */

import { useEffect } from 'react';
import { cssVar, ICON_SIZE } from '@heyta/design-system';
import { useI18n } from '@heyta/i18n';
import { HeytaUiProvider, SyncStatusBar, syncStatusAffordances } from '@heyta/ui';
import { CircleHelp } from 'lucide-react';

import { HELP_SYNC_ANCHOR, siteLink } from '../../lib/site-url.js';
import { describeSyncStatus } from './status-copy.js';
import { useSyncStore } from './store.js';
import { VaultSettingsPanel } from './VaultSettingsPanel.js';

/**
 * 服务端地址的示例。**不是文案，是 URL 字面量。**
 *
 * URL 两种语言完全一样，不该翻译；而 zh 词条被门禁要求"必须含汉字"，
 * 一个纯 URL 词条放不进词条表。所以它在这里作为**具名常量**存在 ——
 * 直接把这个字面量写进输入的 placeholder 属性会被迁移模式判成"硬编码文案"，
 * 而它其实是数据（用户要照着填的地址格式）。
 */
const SERVER_URL_EXAMPLE = 'http://127.0.0.1:3000';

export function SyncSettingsPanel(): React.JSX.Element {
  const { t } = useI18n();
  const sync = useSyncStore();
  const draft = sync.syncDraft;
  const setDraft = sync.setSyncDraft;
  const showSyncDraft = useSyncStore((s) => s.showSyncDraft);
  const hideSyncDraft = useSyncStore((s) => s.hideSyncDraft);
  const vaultMode = sync.accountId !== undefined && sync.accountId.trim() !== '';
  const affordances = syncStatusAffordances(sync.status);

  /**
   * 挂载即按**当前配置**播种，卸载即声明"这一节不在屏幕上了"。
   *
   * 🔴 依赖取的是两个 action 引用（它们在 store 里只有一份、不会随状态变），
   * **不许**把 `sync` 整个对象放进依赖 —— 那样每一次状态变化都会重新播种，
   * 用户正在输入的地址会被他自己刚敲进去的那个字符覆盖掉。
   */
  useEffect(() => {
    showSyncDraft();
    return hideSyncDraft;
  }, [showSyncDraft, hideSyncDraft]);

  return (
    <section
      className="ht-settings"
      id="settings-sync"
      data-testid="sync-settings-panel"
      aria-label={t('web.sync.settings.title')}
    >
      <h2 className="ht-settings__title ht-type-section-title">{t('web.sync.settings.title')}</h2>
      <p className="ht-settings__hint">{t('web.settings.sync.note')}</p>

      {/*
        共享那枚状态条骨架（`@heyta/ui`）。
        ⚠️ 这层 `<HeytaUiProvider>` 不能拆：`scripts/check-ui-provider.mjs` 的
        `PROVIDER_DEPENDENT` 清单里登记的是 `SyncBar.tsx` 那一层；搬到这里之后
        清单要跟着改（`check:ui-provider` 会红 —— 那是它该有的样子，不是巧合）。
      */}
      <HeytaUiProvider>
        <SyncStatusBar
          status={sync.status}
          labels={{ status: (status) => describeSyncStatus(status, t) }}
          testID="sync-status-bar"
        />
      </HeytaUiProvider>

      <label style={labelStyle}>
        {t('web.sync.serverUrl.label')}
        <input
          value={draft.baseUrl}
          onChange={(e) => setDraft({ baseUrl: e.target.value })}
          placeholder={SERVER_URL_EXAMPLE}
          // 「从订阅提示跳到这一节」时焦点落在它身上（见 `shell/settings-anchors.ts`）。
          data-testid="sync-server-url"
          style={fieldStyle}
        />
      </label>

      <label style={labelStyle}>
        {t('web.sync.token.label')}
        <input
          type="password"
          value={draft.token}
          onChange={(e) => setDraft({ token: e.target.value })}
          autoComplete="off"
          style={fieldStyle}
        />
      </label>

      {/* 「令牌从哪来」的入口。手填**保留**（自建用户可能已有令牌），
          这里只是补上一条不必手填的路。 */}
      <p style={hintStyle}>{t('web.auth.tokenHint')}</p>
      <button
        type="button"
        className="ht-btn ht-btn--ghost"
        style={{ alignSelf: 'flex-start' }}
        onClick={() => sync.openSignIn()}
      >
        {t('web.auth.open')}
      </button>

      {!vaultMode ? (
        <>
          <label style={labelStyle}>
            {t('web.sync.password.label')}
            <input
              type="password"
              value={draft.password}
              onChange={(e) => setDraft({ password: e.target.value })}
              autoComplete="new-password"
              style={fieldStyle}
            />
          </label>

          <p className="ht-settings__hint">
            {t('web.sync.password.lead')}
            <strong>{t('web.sync.password.strong')}</strong>
            {t('web.sync.password.tail')}
          </p>
        </>
      ) : null}

      <VaultSettingsPanel />

      <div style={{ display: 'flex', gap: cssVar('space.2'), justifyContent: 'flex-end' }}>
        {/*
          🔴 2026-09-30 撤掉了「清除凭据」按钮：它和头像菜单里的「退出登录」是
          **同一个动作**（都走 `sync.clearCredentials()`），却名字不同、视觉分量不同、
          **未登录时也照常渲染**（点了纯空操作）。身份动作长在身份区（头像菜单），
          所以这一节里不重复一个。要断开这台设备 → 点头像 → 退出登录。
        */}
        <button
          type="button"
          className="ht-btn ht-btn--primary"
          data-testid="sync-save-and-sync"
          onClick={() => {
            sync.configure(draft.baseUrl, draft.token, draft.password);
            sync.closeSettings();
            void sync.syncNow();
          }}
        >
          {t('web.sync.saveAndSync')}
        </button>
      </div>

      {affordances.showsHelp ? (
        /*
          🔴 出错时才给「查看帮助」，而且**直接落到「同步」那一问**上（`/help#sync`），
          不是帮助页顶部 —— 报错的人要找的就是那一篇，让他再找一次是把成本
          从我们这边挪到他那边。只在 `error` 分支出现（`showsHelp`）的理由见
          `syncStatusAffordances` 那段原注释。
          它原来住在 rail 那一列里（齿轮旁边），H9 第 3 刀跟着表单搬进来 ——
          「同步失败了，去哪查」和「改同步配置」是同一件事的上下两屏。
        */
        <a
          className="ht-btn ht-btn--ghost"
          href={siteLink(HELP_SYNC_ANCHOR)}
          rel="noopener noreferrer"
          data-testid="sync-help-link"
          style={{ alignSelf: 'flex-start' }}
        >
          <CircleHelp size={ICON_SIZE.sm} aria-hidden="true" />
          {t('web.sync.help.link')}
        </a>
      ) : null}
    </section>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: cssVar('space.1'),
  fontSize: cssVar('font-size.2xs'),
  color: cssVar('color.foreground-muted'),
};

/** 字段下方的说明句 —— 比标签更轻，但仍然可读。 */
const hintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: cssVar('font-size.2xs'),
  color: cssVar('color.foreground-muted'),
  lineHeight: cssVar('line-height.normal'),
};

const fieldStyle: React.CSSProperties = {
  minHeight: cssVar('touch-target.min'),
  padding: `0 ${cssVar('space.2')}`,
  borderRadius: cssVar('radius.md'),
  border: `${cssVar('border-width.thin')} solid ${cssVar('color.border')}`,
  background: cssVar('color.background'),
  color: cssVar('color.foreground'),
  // ≥16px，否则 iOS 聚焦时自动放大页面
  fontSize: cssVar('font-size.base'),
  fontFamily: cssVar('font.sans'),
};
