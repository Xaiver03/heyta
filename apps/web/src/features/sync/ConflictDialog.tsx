import { ICON_SIZE } from '@heyta/design-system';
/**
 * 冲突解决界面（web 外壳）
 * ==========================
 *
 * P1 把冲突做到了"能判定并上报"，但**没有解决的地方** ——
 * 用户看到一句"需要手动选择保留哪一边"，却无处可选，数据卡在待上传队列里。
 * 一个必然需要人判断的问题，被做成了一句死路。
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 🔴 M3 第四刀之后，这里**只剩 web 特有的那一层**
 *
 * 两个平台共有的部分已经收进 `@heyta/ui` 的 `ConflictResolutionView`：
 * 逐条列出冲突、并排摆出两边的**内容**与时间、标出哪一侧较新、
 * 每一侧一个「保留这一版」、把"为什么点不了"说出来。
 * 本文件只负责 web 这一侧的外壳与措辞：
 *
 *   · **对话框语义**（`role="dialog"` / `aria-modal` / `aria-labelledby` /
 *     Esc 关闭 / 打开时把焦点移进去）—— 那是 L3 外壳，RN 侧没有对应物；
 *   · **真实 `<button disabled>`** —— 见下面 `renderSideAction` 的注释；
 *   · **词条**（`labels`）—— 共享层不许 import `@heyta/i18n`。
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 🔴 为什么必须并排显示两边的**内容**，而不是只显示"本机/远端"和时间
 *
 * 时间戳谁新谁旧，用户根本判断不了"哪个才是我要的"。
 * 他改的是标题、备注还是完成状态，只有内容本身能告诉他。
 * 冲突解决界面的价值全在"能看清两边分别是什么"这一点上。
 * ═════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ 自动解决（sync-core 的 `suggestConflictResolution` 能判定的那些）
 * **不会**走到这里 —— 只有它返回 `manual` 的才需要用户决定。
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 🔴 `HeytaUiProvider` 是**本文件自己挂**的
 *
 * 共享视图透过 `useHeytaTokens` 取 token，缺 Provider 会**运行时抛错**。
 * `apps/web/src/App.tsx` 里的 Provider 都挂在各视图**局部**
 * （tasks 一棵树、focus 一棵树），而 `<SyncBar/>` / `<ConflictDialog/>`
 * 挂在顶栏 —— **不在任何一棵之内**。本来该由 App.tsx 在顶栏再挂一层，
 * 但 `App.tsx` 不在本刀白名单里，所以在自己的入口挂是最小且不越界的一步。
 *
 * ✅ `ConflictResolutionView` 已登记进 `scripts/check-ui-provider.mjs` 的
 * `PROVIDER_DEPENDENT` 清单：把这层 `<HeytaUiProvider>` 拆掉会让那道门禁
 * **变红并指名道姓**（已故障注入实测）。第四刀刚落地时它**没登记**、
 * 门禁照样全绿 —— 已补齐，别再把这一层当成"手工保证"。
 */

import { useEffect, useMemo, useRef } from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';

import { cssVar } from '@heyta/design-system';
import { useI18n } from '@heyta/i18n';
import {
  ConflictResolutionView,
  HeytaUiProvider,
  conflictLookupCode,
  conflictReasonLabelOf,
  entityLabelOf,
  type ConflictResolutionLabels,
  type ConflictSideRenderInfo,
} from '@heyta/ui';
import {
  compareConflictFreshness,
  summarizeConflictPayload,
  type ConflictInfo,
} from '@heyta/sync-client';

import { useSyncStore } from './store.js';

/**
 * 时间戳 → 可读时间。冲突界面里"谁更新"是判断依据，必须看得懂。
 *
 * ⚠️ 这里原先把 `'zh-CN'` 写死 —— 英文界面会用中文习惯排日期。
 * 现在用当前语言（`useI18n().locale`），这是最容易被漏掉的一类"看不见的文案"。
 * 格式属于宿主，所以共享层收的是 `labels.time(ms)` 函数而不是一个字符串。
 */
function formatTime(ms: number, locale: string): string {
  return new Date(ms).toLocaleString(locale, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * 实体类型 → 词条 key **收进共享层了**（`@heyta/ui` 的 `sync/model.ts`）。
 *
 * 🔴 这里曾经有一份本地 `ENTITY_LABEL_KEYS`，而移动端
 * `apps/mobile/src/sync/conflict-view.ts` 也有**同一张表**。key 相同、句子不漂移，
 * 但**集合本身是两份**：加一个新实体只改一端时，另一端不会报错、也没有测试会红，
 * 只会静默地把 `AI_FEEDBACK` 这种内部标识符显示给用户。
 *
 * 现在两端都调共享的 `entityLabelOf`（词条落成 `common.entity.*`）——
 * 修掉了旧注释记着的那笔命名空间债（web 曾借 `mobile.entity.*`），
 * web 用户与移动端用户看到的是**同一张表**给出的同一个名字。
 * 认不出来的实体回落成原始类型名（不编一个，也不吞掉）。
 */

export function ConflictDialog(): React.JSX.Element | null {
  const { t, locale } = useI18n();
  const status = useSyncStore((s) => s.status);
  const resolveConflict = useSyncStore((s) => s.resolveConflict);
  const dialogOpen = useSyncStore((s) => s.conflictDialogOpen);
  const closeConflictDialog = useSyncStore((s) => s.closeConflictDialog);
  const dialogRef = useRef<HTMLDivElement>(null);

  const conflicts: ConflictInfo[] = status.kind === 'conflict' ? status.conflicts : [];
  // 两个条件：有冲突可解决，且用户正看着。
  // 关掉窗口**不会**清掉冲突状态 —— SyncBar 仍会提示，用户还能再打开。
  const open = dialogOpen && conflicts.length > 0;

  // Esc 关闭。挂在不存在的节点上什么也不会发生，所以只在打开时绑。
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        closeConflictDialog();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [open, closeConflictDialog]);

  // 打开时把焦点移进对话框 —— 否则键盘用户还停在背后的页面上
  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  const labels: ConflictResolutionLabels = useMemo(
    () => ({
      entity: (entityType) => entityLabelOf(entityType, t),
      // 🔴 「原因」这一行 web 以前**没有**（只有 `mobile.conflict.reason.*`，
      // `common.conflict.reason.*` 不存在，所以省略）。本轮补了共享词条，
      // 两端从此在同一位置说同一句「为什么这件事需要人来定」。
      // 查表用码由共享 `conflictLookupCode`（`errorCode ?? reason`）决定。
      reason: (conflict) => conflictReasonLabelOf(conflictLookupCode(conflict), t),
      side: (side) =>
        t(side === 'local' ? 'web.conflict.side.local' : 'web.conflict.side.remote'),
      newer: t('web.conflict.newer'),
      remoteUnavailable: t('web.conflict.remoteUnavailable'),
      keepThis: t('web.conflict.keepThis'),
      // 空载荷与"取不到这一侧"是两回事，不能混成一句（见共享层 model 的注释）。
      emptyPayload: t('web.conflict.payload.empty'),
      // 词条表没有 ICU：1 个字段必须走单数兄弟词条，否则英文是 "1 fields changed"。
      payloadFields: (count) =>
        count === 1
          ? t('web.conflict.payload.fieldsOne', { count })
          : t('web.conflict.payload.fields', { count }),
      blocked: () => t('web.conflict.remoteUnavailable'),
      time: (ms) => formatTime(ms, locale),
    }),
    [t, locale],
  );

  if (!open) return null;

  /**
   * 🔴 词条表没有 ICU：1 处冲突时英文必须走单数兄弟词条
   * （"these 1 places" 是一眼可见的坏句子）。
   */
  const title =
    conflicts.length === 1
      ? t('web.conflict.titleOne', { count: conflicts.length })
      : t('web.conflict.title', { count: conflicts.length });

  /**
   * 每一侧的按钮**由 web 自己渲染**。
   *
   * 🔴 这不是偷懒，是实测的硬约束：RNW 的 `Pressable` 虽然会渲染成真实
   * `<button>`，但它的 `disabled` **只产出 `aria-disabled`**，
   * 不产出 DOM 的 `disabled` 属性（属性白名单里没有它）。而
   * `apps/web/tests/conflict-dialog.spec.tsx` 断言"取不到对端那一侧的按钮
   * 必须真的带 `disabled` 属性" —— 那份测试不在本刀白名单，也不该为迁就让步。
   * 共享层仍然负责**决定**（`blockedReason` / `preferred` 都在入参里）。
   */
  const renderSideAction = (info: ConflictSideRenderInfo<ConflictInfo>): React.JSX.Element => (
    <button
      type="button"
      className={info.preferred ? 'ht-btn ht-btn--primary' : 'ht-btn'}
      disabled={info.blockedReason !== undefined || info.busy}
      onClick={() => {
        void resolveConflict(info.conflict, info.choice);
      }}
      style={{ marginTop: 'auto' }}
    >
      <Check size={ICON_SIZE.sm} aria-hidden="true" />
      {labels.keepThis}
    </button>
  );

  return (
    <div
      role="presentation"
      style={{
        position: 'fixed',
        inset: 0,
        background: cssVar('color.overlay'),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: cssVar('space.4'),
        zIndex: cssVar('z.modal'),
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ht-conflict-title"
        style={{
          width: '100%',
          maxWidth: cssVar('layout.content-max'),
          maxHeight: '90vh',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: cssVar('space.5'),
          background: cssVar('color.surface-raised'),
          borderRadius: cssVar('radius.lg'),
          boxShadow: cssVar('shadow.lg'),
          padding: cssVar('space.6'),
          color: cssVar('color.foreground'),
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: cssVar('space.3'),
          }}
        >
          <span
            style={{
              display: 'flex',
              color: cssVar('color.warning-strong'),
              paddingTop: cssVar('space.1'),
            }}
          >
            <AlertTriangle size={ICON_SIZE.md} aria-hidden="true" />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2
              id="ht-conflict-title"
              style={{ margin: 0, fontSize: cssVar('font-size.lg') }}
            >
              {title}
            </h2>
            <p
              style={{
                margin: `${cssVar('space.2')} 0 0`,
                fontSize: cssVar('font-size.sm'),
                color: cssVar('color.foreground-muted'),
                lineHeight: cssVar('line-height.normal'),
              }}
            >
              {t('web.conflict.bodyLead')}
              <strong>{t('web.conflict.bodyStrong')}</strong>
              {t('web.conflict.bodyTail')}
            </p>
          </div>
          <button
            type="button"
            aria-label={t('web.conflict.close')}
            className="ht-btn ht-btn--ghost"
            onClick={closeConflictDialog}
          >
            <X size={ICON_SIZE.sm} aria-hidden="true" />
          </button>
        </div>

        {/* 🔴 共享的那一段：逐条冲突 + 两侧内容 + 保留按钮。
            上面那层 Provider 见文件头（顶栏不在任何一棵 Provider 子树里）。 */}
        <HeytaUiProvider>
          <ConflictResolutionView
            conflicts={conflicts}
            labels={labels}
            freshnessOf={(conflict) =>
              compareConflictFreshness(conflict.local, conflict.remote)
            }
            summarize={summarizeConflictPayload}
            busy={status.kind === 'syncing'}
            renderSideAction={renderSideAction}
            onResolve={(conflict, choice) => {
              void resolveConflict(conflict, choice);
            }}
            testID="conflict-resolution"
          />
        </HeytaUiProvider>
      </div>
    </div>
  );
}
