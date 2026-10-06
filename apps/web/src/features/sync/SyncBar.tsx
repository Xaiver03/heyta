import { ICON_SIZE } from '@heyta/design-system';
/**
 * 同步那一枚（web 外壳，rail 底部）
 * ==================================
 *
 * 计划 3.3 的判据：**界面能看出"已同步 / 同步中 / 冲突 / 离线"**。
 *
 * 设计取舍：状态用**图标 + 文字**表达，不只靠颜色。
 * 只靠颜色的话，色觉障碍用户无法区分"离线"和"出错" ——
 * 而这两者的用户动作完全不同（等待 vs 去修设置）。
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 🔴 这个文件现在**只剩 rail 底部那一枚 + 认证面板的挂载点**
 *
 * 2026-10-06 两刀之后：
 *
 *   · **H9 第 1 刀**：同步这一组从页头搬进 rail 底部（裁决与现量在
 *     `docs/plans/goal-layout-audit.md` §9.1 第 1 行）。
 *   · **H9 第 3 刀**：「同步设置」不再是浮层 —— 表单、状态条、密钥面板、
 *     「查看帮助」全部住进 **设置 → 同步** 那一节
 *     （`features/sync/SyncSettingsPanel.tsx`），rail 上那颗齿轮一起删掉。
 *     产品负责人第 2 条（「设置不应该点击头像之后再打开吗？」）的病根就是
 *     那颗齿轮**长得像**全局设置。
 *
 * 本文件只负责：
 *   · rail 那一枚（状态可读、冲突可点、同步中不可再点）；
 *   · `AuthPanel` 的**唯一**挂载点（触发者有两处，见下面 `authOpen` 的注释）。
 *
 * 措辞在 `status-copy.ts`（rail 与设置里那一节共用**一份**），
 * 状态 → 严重度/颜色/字形/可用动作的映射在 `@heyta/ui`（四端共用一份）。
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 🔴 原本挂在这里的 `<HeytaUiProvider>` 跟着状态条搬走了
 *
 * 共享状态条透过 `useHeytaTokens` 取 token，缺 Provider 会**运行时抛错**；
 * `scripts/check-ui-provider.mjs` 的 `PROVIDER_DEPENDENT` 清单认的是**符号**
 * （`SyncStatusBar`），所以它现在盯的是 `SyncSettingsPanel.tsx` 里那一层。
 * 把那里那层 Provider 拆掉，这道门禁会**变红并指名道姓**（已故障注入实测）。
 */

import { useI18n } from '@heyta/i18n';
import { useSyncStore } from './store.js';
import type { HostedAuthSession } from '@heyta/app-host';
import { syncStatusAffordances, syncStatusGlyph, syncStatusSeverity } from '@heyta/ui';
import { AlertTriangle, CheckCircle2, CloudOff, RefreshCw } from 'lucide-react';

import { AuthPanel } from '../auth/AuthPanel.js';
import { describeSyncStatus } from './status-copy.js';

/**
 * 共享那份字形族 → web 的 `lucide-react` 组件。
 *
 * 🔴 映射本身**不在这里判断**（`syncStatusGlyph` 是唯一事实源，mobile 走同一份）；
 * 这里只是把名字落成组件 —— 与 `habit-glyphs.ts` 那半张表同一条分工。
 * `spinner` 用 `RefreshCw` 配一条旋转动画（共享层那边是 `ActivityIndicator`）。
 */
const GLYPH_COMPONENTS = {
  check: CheckCircle2,
  'cloud-off': CloudOff,
  alert: AlertTriangle,
  spinner: RefreshCw,
} as const;

export function SyncBar() {
  const { t } = useI18n();
  const sync = useSyncStore();
  const affordances = syncStatusAffordances(sync.status);
  const statusText = describeSyncStatus(sync.status, t);
  const severity = syncStatusSeverity(sync.status);
  const Glyph = GLYPH_COMPONENTS[syncStatusGlyph(sync.status)];
  /**
   * 注册 / 登录面板的开合**在 `useSyncStore` 里**，不是这里的局部 state：
   *
   * 🔴 2026-09-29 起它是 store state，因为入口搬进了 rail 顶部的账号区
   *    （`AccountMenu`，未登录时「登录 / 注册」是菜单第一项）—— 触发者在 A、
   *    面板在 B，局部 state 够不着。
   * 🔴 2026-10-06（H9 第 3 刀）之后**第二个**入口是 设置 → 同步 里的
   *    「登录 / 注册」按钮。两处都必须能开**同一块**面板，所以挂载点仍只有一处。
   */
  const authOpen = useSyncStore((s) => s.signInOpen);

  return (
    <>
      {/*
        🔴 2026-10-06（工单 H9）：同步这一组从**页头**搬进 **rail 底部**，形状也从
        "图标 + 文字的状态条"收成 48px 装得下的一枚。理由不是审美：页头那一排已经成了
        六个不相关控件的平铺（状态 / 立即同步 / 同步设置 / 语言 / 登录 / 主题），
        而"同步"在滴答里是左下角的东西。负责人原话与逐条现量在
        `docs/plans/goal-layout-audit.md` §9.1 第 1 行。

        状态条原本负责的三件事，一件都不许因为"变小"而丢：
        1. **状态要说得出**：整句状态进 `aria-label`，另有一枚 `role="status"` +
           `aria-live="polite"` 的 live region 承担"异步变化要播报"。
           hover 时那句状态也看得见（复用 rail 既有的 `.ht-rail__label` 机制，
           不新造一套 tooltip）。
        2. **冲突要看得见**：`needsResolution` 时这枚的**点击语义改成打开冲突对话框** ——
           有冲突时用户下一步要的是"处理"，不是"再同步一次"。原来那颗
           「处理冲突」主按钮因此不再单独存在（48px 里放不下两枚主按钮），
           而"关掉对话框之后还得能再打开它"这条由"同一枚按钮 + 警示态"兑现。
        3. **同步中不可再点**：沿用共享的 `syncStatusAffordances`，不在这里另判一次。

        ⚠️ 外层必须是 `<div>` 而不是把按钮直接摊进 `<nav>`：rail 的贴底靠
        `.ht-rail__tab--tool:first-of-type { margin-top: auto }`，而 `:first-of-type`
        选的是父元素里**第一个 `<button>`**（`App.tsx` 里铃铛那段注释是同一条纪律）。
        同理，**这一列里的按钮一律不带 `--tool`**：带了就会在 `<div>` 内部再匹配一次
        `:first-of-type`，把第一枚往下推。

        ⚠️ 字形与颜色**不在这份文件里判断**：`syncStatusGlyph` / `syncStatusSeverity`
        是 `@heyta/ui` 那份唯一映射（web 与 mobile 各一份的历史事故见文件头）。

        ⚠️ H9 第 3 刀之后这一列**只有这一枚按钮**：齿轮（同步设置）与「查看帮助」
        都跟着表单住进 设置 → 同步 了。
      */}
      <div className="ht-rail__sync" data-testid="sync-rail" data-severity={severity}>
        <button
          type="button"
          className="ht-rail__tab ht-rail__sync__action"
          aria-label={t('web.sync.rail.aria', { status: statusText })}
          data-testid="sync-rail-action"
          disabled={!affordances.canSyncNow && !affordances.needsResolution}
          onClick={() => {
            if (affordances.needsResolution) {
              sync.openConflictDialog();
              return;
            }
            void sync.syncNow();
          }}
        >
          <span className="ht-rail__sync__icon" aria-hidden="true">
            <Glyph
              size={ICON_SIZE.sm}
              className={severity === 'progress' ? 'ht-rail__sync__spin' : undefined}
            />
            <span
              className={`ht-rail__sync__dot ht-rail__sync__dot--${severity}`}
              data-testid="sync-status-dot"
            />
          </span>
          <span className="ht-rail__label ht-type-caption" aria-hidden="true">
            {statusText}
          </span>
        </button>
        {/* live region 与上面那枚 hover 标签是**两个元素**：标签 `aria-hidden`，只服务眼睛；
            这句只服务读屏，视觉上被收成 1 个像素见 `rail.css`。 */}
        <span className="ht-rail__sync__status" role="status" aria-live="polite">
          {statusText}
        </span>
      </div>

      {authOpen ? (
        <AuthPanel
          /**
           * 🔴 地址来源取决于**从哪儿进来的**（W2）：
           *   · 从 **设置 → 同步** 那一节进来时用**输入框里的草稿** —— 用户可能
           *     刚改过地址还没保存，认证就该用他眼前那个值（原来的行为，保持不变）；
           *   · 从**头像菜单**进来时用**已保存的** `sync.baseUrl` —— 那一处没有
           *     草稿可读。若它为空，`AuthPanel` 会自己显示地址输入。
           * 两种情况都只有**一个**地址来源，认证与同步永远指向同一个服务端。
           * 「那一节在不在屏幕上」由面板自己的挂载 effect 写进
           * `syncDraftShown`（见 `SyncSettingsPanel.tsx` 文件头）。
           */
          baseUrl={sync.syncDraftShown ? sync.syncDraft.baseUrl : sync.baseUrl}
          onClose={() => sync.closeSignIn()}
          onSignedIn={(session: HostedAuthSession) => {
            // 认证 store 已经把令牌写进了同步配置；这里把**那一节的输入框**
            // 也对齐，否则用户接着点「保存并同步」会用空输入框把它覆盖掉。
            sync.setSyncDraft({ token: session.token });
            sync.closeSignIn();
          }}
        />
      ) : null}
    </>
  );
}
