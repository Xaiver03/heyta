/**
 * 同步状态条（web 外壳）
 * ========================
 *
 * 计划 3.3 的判据：**界面能看出"已同步 / 同步中 / 冲突 / 离线"**。
 *
 * 设计取舍：状态用**图标 + 文字**表达，不只靠颜色。
 * 只靠颜色的话，色觉障碍用户无法区分"离线"和"出错" ——
 * 而这两者的用户动作完全不同（等待 vs 去修设置）。
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 🔴 M3 第四刀之后，这里**只剩 web 特有的那一层**
 *
 * 两个平台共有的部分已经收进 `@heyta/ui`：
 *
 *   · `SyncStatusBar` —— 状态条骨架（字形 + 文字 + live region）；
 *   · `syncStatusSeverity` / `syncStatusColorToken` / `syncStatusGlyph` /
 *     `syncStatusAffordances` —— 状态 → 严重度/颜色/字形/可用动作的**唯一**映射。
 *
 * 本文件只负责：
 *   · **措辞**（`describeSyncStatus`：下载与上传是两句话，冲突要分单复数）；
 *   · **按钮本体**（web 的 `ht-btn` 与真实 `<a>` 导航，RN 侧没有对应物）；
 *   · **同步设置对话框**与认证面板（那是另一件事，不在"状态条"里）。
 *
 * 🔴 一处**修好的漂移**：状态 → 颜色的映射此前 web 与 mobile 各有一份，
 * 而 `offline` 在 web 是警示色、在 mobile 是中性 —— 同一个状态在两端
 * 呈现成两种态度，且没有任何测试会红。现在统一走共享 model
 * （选的是"离线不是错误"那一版，理由见 `packages/ui/src/sync/model.ts`）。
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 🔴 `HeytaUiProvider` 是**本文件自己挂**的
 *
 * 共享状态条透过 `useHeytaTokens` 取 token，缺 Provider 会**运行时抛错**。
 * `apps/web/src/App.tsx` 的 Provider 都挂在各视图局部，而 `<SyncBar/>`
 * 挂在顶栏 —— **不在任何一棵子树里**。`App.tsx` 不在本刀白名单里，
 * 所以在自己的入口挂是最小且不越界的一步。
 *
 * ✅ `SyncStatusBar` 已登记进 `scripts/check-ui-provider.mjs` 的
 * `PROVIDER_DEPENDENT` 清单：把这层 `<HeytaUiProvider>` 拆掉会让那道门禁
 * **变红并指名道姓**（"SyncBar.tsx:136 —— 组件 <SyncStatusBar>"，已故障注入实测）。
 * 第四刀刚落地时它**没登记**、门禁照样全绿，那是这批新组件唯一的覆盖缺口；
 * 已补齐，别再把这一层当成"手工保证"。
 */

import { useEffect, useState } from 'react';
import { cssVar } from '@heyta/design-system';
import { useI18n, type I18nValue } from '@heyta/i18n';
import { useSyncStore } from './store.js';
import type { HostedAuthSession } from '@heyta/app-host';
import { HeytaUiProvider, SyncStatusBar, syncFailureMessageKey, syncStatusAffordances, type SyncStatusLike } from '@heyta/ui';
import { RefreshCw, Settings, X } from 'lucide-react';

import { AuthPanel } from '../auth/AuthPanel.js';
import { HELP_SYNC_ANCHOR, siteLink } from '../../lib/site-url.js';

/**
 * 服务端地址的示例。**不是文案，是 URL 字面量。**
 *
 * URL 两种语言完全一样，不该翻译；而 zh 词条被门禁要求"必须含汉字"，
 * 一个纯 URL 词条放不进词条表。所以它在这里作为**具名常量**存在 ——
 * 直接把这个字面量写进输入的 placeholder 属性会被迁移模式判成"硬编码文案"，
 * 而它其实是数据（用户要照着填的地址格式）。
 */
const SERVER_URL_EXAMPLE = 'http://127.0.0.1:3000';

/**
 * 同步状态 → 用户能读、能行动的句子。
 *
 * 🔴 这段话原先由 `features/sync/store.ts` 的 `describeStatus` 在**非 UI 层**
 * 拼成中文返回，组件直接渲染 —— 英文界面因此永远显示中文。
 * 现在按"state 只带数据、句子在壳里拼"的纪律全部搬到这里：
 * `SyncStatus` 本身是结构化的判别联合，措辞属于壳。
 *
 * ⚠️ **哪些状态、哪些动作**不在这里判断：那是 `@heyta/ui` 的
 * `syncStatusAffordances`（有单测）。这里只把状态说成人话。
 *
 * ⚠️ `error.message` 其余情况仍是**数据**（来自网络或服务端的技术串），
 * 原样带进句子里，不编也不映射。
 */
function describeSyncStatus(status: SyncStatusLike, t: I18nValue['t']): string {
  switch (status.kind) {
    case 'idle':
      return t('web.sync.status.idle');
    case 'syncing':
      // 下载与上传是两件事，措辞必须分开。
      return status.phase === 'download'
        ? t('web.sync.status.downloading')
        : t('web.sync.status.uploading');
    case 'synced':
      return t('web.sync.status.synced');
    case 'offline':
      return t('web.sync.status.offline');
    case 'conflict': {
      // 🔴 词条表没有 ICU：1 处冲突是最常见的情形，必须分支到单数兄弟词条。
      // 不写 `t(count === 1 ? 'a' : 'b')` —— 那样两种形状都认不出（见门禁文件头）。
      const count = status.conflicts?.length ?? 0;
      if (count === 1) return t('web.sync.status.conflictOne', { count });
      return t('web.sync.status.conflict', { count });
    }
    case 'error': {
      // 🔴 已知原因：**整句**走词条，映射只有一处（`@heyta/ui` 的
      // `syncFailureMessageKey`，与移动端共用）。不要退回成
      // `t('web.sync.status.errorRetryable', { message: status.message })` ——
      // 那会把包里的中文插进英文句子里（中英混排），而门禁扫不到这种变量渲染。
      const known = syncFailureMessageKey(status.reason);
      if (known !== undefined) return t(known);
      // 意外异常：`message` 是诊断数据（不是文案），当参数带进来。
      return t('web.sync.status.errorRetryable', { message: status.message ?? '' });
    }
  }
}

export function SyncBar() {
  const { t } = useI18n();
  const sync = useSyncStore();
  const affordances = syncStatusAffordances(sync.status);
  /**
   * 对话框的开合状态**在 `useSyncStore` 里**，不是这里的局部 state ——
   * 订阅提示的「改用你自己的服务器」也要打开它（见 store 里的注释）。
   */
  const open = useSyncStore((s) => s.settingsOpen);
  const [baseUrl, setBaseUrl] = useState(sync.baseUrl ?? '');
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');

  /**
   * 🔴 对话框**打开时**把三个输入框对齐到已保存的配置。
   *
   * 这几个 state 的初值只在 SyncBar **挂载那一刻**取一次，而 SyncBar 是常驻的
   * 顶栏组件 —— 于是它们会长期停在一个过期的快照上：
   *
   *   · 冷启动（尤其刚清过存储的新设备）`sync.baseUrl` 还是空的，
   *     之后登录虽然写进了 store，**这里不会自己更新**；
   *   · `token` 的初值恒为空串。
   *
   * 后果不是"显示不对"这么轻：点「保存并同步」会走
   * `sync.configure(baseUrl, token, password)`，把**空地址**写进内存配置 ——
   * 同步当场变成"还没配置"（`configure` 只在两者都非空时才落盘，
   * 所以磁盘上的凭据还在，刷新一次又能好 —— 这正是最难归因的那种形态）。
   *
   * 实测（2026-09-30，Windows 桌面壳旅程验收 W3）：用户能走到的路径正是
   * 「点头像 → 登录 / 注册 → 打开同步设置 → 补端到端加密口令 → 保存并同步」，
   * 而口令**从不落盘**，所以每个新会话都要用户再走一次。
   *
   * 口令也一起对齐：它只在内存里，而真值就在 store 里。
   * 不这样，一次"打开设置 → 保存"就会把刚建立的口令抹成空串。
   *
   * ⚠️ 只在 `open` 翻转时播种（用 `getState()` 取当下值，不把 store 放进依赖）：
   *    否则用户在输入框里打字时，任何一次 store 更新都会把他的输入覆盖掉。
   */
  useEffect(() => {
    if (!open) return;
    const current = useSyncStore.getState();
    setBaseUrl(current.baseUrl ?? '');
    setToken(current.token ?? '');
    setPassword(current.password ?? '');
  }, [open]);
  /**
   * 认证面板的开合。
   *
   * 🔴 它在**同步设置对话框里面**打开，而不是另做一个更靠前的入口：
   * 认证要用的服务端地址就是这里的地址，两者分开会让用户对着 A 登录、
   * 把令牌存到 B。
   *
   * 🔴 2026-09-29 起**状态在 store 里**（`signInOpen`）：入口搬进了
   * rail 顶部的账号区（`AccountMenu`），触发者在这里之外 —— 与
   * `settingsOpen` 同一条搬家理由（两个组件要开同一块面板）。
   */
  const authOpen = useSyncStore((s) => s.signInOpen);

  return (
    <>
      {/* 🔴 状态条骨架来自共享层。上面那层 Provider 见文件头
          （顶栏不在任何一棵 Provider 子树里）。 */}
      <HeytaUiProvider>
        <SyncStatusBar
          status={sync.status}
          labels={{ status: (status) => describeSyncStatus(status, t) }}
          testID="sync-status-bar"
          actions={
            <>
              {/*
                🔴 W2（注册/登录前置）：入口**搬进了 rail 顶部账号区的头像菜单**
                （2026-09-29 撤掉顶栏那块大主按钮；2026-09-30 又撤掉头像旁边
                那个 pill —— 产品负责人："应该是点击头像出来注册、登录吧？"）。
                `AccountMenu` 在未登录时把「登录 / 注册」渲染成菜单**第一项**
                （同一个 `sync-signin-entry` testID），开合状态在 store 的
                `signInOpen`。这里**不再**渲染第二个入口。
              */}

              {/* 冲突需要一个**看得见的入口**：关掉对话框之后，
                  用户还得能再打开它，否则问题就从"没法解决"变成"看不见了" */}
              {affordances.needsResolution ? (
                <button
                  type="button"
                  className="ht-btn ht-btn--primary"
                  onClick={sync.openConflictDialog}
                >
                  {t('web.sync.resolveConflicts')}
                </button>
              ) : null}

              {/*
                🔴 出错时才给「查看帮助」，而且**直接落到「同步」那一问**上
                （`/help#sync`），不是帮助页顶部 —— 报错的人要找的就是那一篇，
                让他再找一次是把成本从我们这边挪到他那边。
                只在 `error` 分支出现（`showsHelp`），是因为"没配置同步""没登录"
                这两种状态旁边本来就有可以点的出路（设置 / 登录），
                再给一条帮助链接会稀释那两条真正的出路。
              */}
              {affordances.showsHelp ? (
                <a
                  className="ht-btn ht-btn--ghost"
                  href={siteLink(HELP_SYNC_ANCHOR)}
                  rel="noopener noreferrer"
                  data-testid="sync-help-link"
                >
                  {t('web.sync.help.link')}
                </a>
              ) : null}

              <button
                type="button"
                className="ht-btn ht-btn--ghost"
                aria-label={t('web.sync.a11y.syncNow')}
                disabled={!affordances.canSyncNow}
                onClick={() => {
                  void sync.syncNow();
                }}
              >
                <RefreshCw size={14} aria-hidden="true" />
              </button>

              <button
                type="button"
                className="ht-btn ht-btn--ghost"
                aria-label={t('web.sync.settings.title')}
                onClick={sync.openSettings}
              >
                <Settings size={14} aria-hidden="true" />
              </button>
            </>
          }
        />
      </HeytaUiProvider>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('web.sync.settings.title')}
          style={{
            position: 'fixed',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            background: cssVar('color.overlay'),
            // 模态是真正的浮层 —— 这里用阴影是对的
            zIndex: cssVar('z.modal'),
          }}
        >
          <div
            style={{
              background: cssVar('color.surface-raised'),
              borderRadius: cssVar('radius.lg'),
              boxShadow: cssVar('shadow.lg'),
              padding: cssVar('space.6'),
              minWidth: cssVar('layout.content-max'),
              maxWidth: '90vw',
              display: 'flex',
              flexDirection: 'column',
              gap: cssVar('space.3'),
              color: cssVar('color.foreground'),
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: cssVar('font-size.lg') }}>
                {t('web.sync.settings.title')}
              </h2>
              <button
                type="button"
                onClick={sync.closeSettings}
                aria-label={t('web.sync.settings.close')}
                className="ht-btn ht-btn--ghost"
                style={{ marginLeft: 'auto' }}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            <label style={labelStyle}>
              {t('web.sync.serverUrl.label')}
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={SERVER_URL_EXAMPLE}
                style={fieldStyle}
              />
            </label>

            <label style={labelStyle}>
              {t('web.sync.token.label')}
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
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

            <label style={labelStyle}>
              {t('web.sync.password.label')}
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                style={fieldStyle}
              />
            </label>

            <p
              style={{
                margin: 0,
                fontSize: cssVar('font-size.2xs'),
                color: cssVar('color.foreground-muted'),
                lineHeight: cssVar('line-height.normal'),
              }}
            >
              {t('web.sync.password.lead')}
              <strong>{t('web.sync.password.strong')}</strong>
              {t('web.sync.password.tail')}
            </p>

            <div style={{ display: 'flex', gap: cssVar('space.2'), justifyContent: 'flex-end' }}>
              {/*
                🔴 2026-09-30 撤掉了这里的「清除凭据」按钮。
                它和头像菜单里的「退出登录」是**同一个动作**（都走
                `sync.clearCredentials()`），却：名字不同、视觉分量不同
                （ghost 排在主按钮**之前**）、**未登录时也照常渲染**
                （点了纯空操作 —— 那正是"给一个按不出效果的按钮"）。
                产品负责人 2026-09-30 拍板的 IA 是**身份入口唯一**：
                身份动作长在身份区（头像菜单），所以这里不再重复一个。
                要断开这台设备 → 点头像 → 退出登录。
              */}
              <button
                type="button"
                className="ht-btn ht-btn--primary"
                onClick={() => {
                  sync.configure(baseUrl, token, password);
                  sync.closeSettings();
                  void sync.syncNow();
                }}
              >
                {t('web.sync.saveAndSync')}
              </button>
            </div>
          </div>
        </div>
      )}

      {authOpen ? (
        <AuthPanel
          /**
           * 🔴 地址来源取决于**从哪进来的**（W2）：
           *   · 对话框开着时用它的输入框 —— 用户可能刚改过地址还没保存，
           *     认证就该用他眼前那个值（原来的行为，保持不变）；
           *   · 从**顶栏**进来时用**已保存的** `sync.baseUrl` —— 顶栏不该读到
           *     对话框里未提交的草稿。若它为空，`AuthPanel` 会自己显示地址输入。
           * 两种情况都只有**一个**地址来源，认证与同步永远指向同一个服务端。
           */
          baseUrl={open ? baseUrl : sync.baseUrl}
          onClose={() => sync.closeSignIn()}
          onSignedIn={(session: HostedAuthSession) => {
            // 认证 store 已经把令牌写进了同步配置；这里把**这个对话框的输入框**
            // 也对齐，否则用户接着点「保存并同步」会用空输入框把它覆盖掉。
            setToken(session.token);
            sync.closeSignIn();
          }}
        />
      ) : null}
    </>
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
