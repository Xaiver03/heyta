/**
 * 冲突解决界面
 * ==============
 *
 * P1 把冲突做到了"能判定并上报"，但**没有解决的地方** ——
 * 用户看到一句"需要手动选择保留哪一边"，却无处可选，数据卡在待上传队列里。
 * 一个必然需要人判断的问题，被做成了一句死路。
 *
 * 这个界面的唯一职责：把**双方分别是什么**摆出来，让用户点一下选一边。
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
 */

import { useEffect, useRef } from 'react';
import { AlertTriangle, Check, Monitor, Smartphone, X } from 'lucide-react';

import { cssVar, type TokenName } from '@heyta/design-system';
import { useI18n, type I18nValue, type Locale } from '@heyta/i18n';

import { useSyncStore } from './store.js';
import {
  compareConflictFreshness,
  summarizeConflictPayload,
  type ConflictInfo,
  type ConflictSide,
} from '@heyta/sync-client';

/**
 * 时间戳 → 可读时间。冲突界面里"谁更新"是判断依据，必须看得懂。
 *
 * ⚠️ 这里原先把 `'zh-CN'` 写死 —— 英文界面会用中文习惯排日期。
 * 现在用当前语言（`useI18n().locale`），这是最容易被漏掉的一类"看不见的文案"。
 */
function formatTime(ms: number, locale: Locale): string {
  return new Date(ms).toLocaleString(locale, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * 冲突载荷 → 一句用户能读的摘要。
 *
 * 🔴 **判断不在这里**：这段载荷里哪个字段能当标题，由 `@heyta/sync-client`
 * 的 `summarizeConflictPayload` 决定 —— 那是唯一知道载荷形状的地方，
 * 两端（web / mobile）消费同一份判断，不会漂移。这里只负责措辞：
 *
 *   - `text`：**用户自己的字**（标题、项目名…），直接显示、不翻译；
 *   - `fields`：**只报数量**，绝不列字段名 —— `completedAt` 那种内部标识符
 *     出现在用户可见文案里正是门禁要拦的东西（跨包返回值曾经绕过它）；
 *   - `empty`：单独一条词条。空载荷与"取不到这一侧"是两回事，不能混。
 */
function payloadSummaryText(payload: unknown, t: I18nValue['t']): string {
  const summary = summarizeConflictPayload(payload);
  switch (summary.kind) {
    case 'text':
      return summary.text;
    case 'empty':
      return t('web.conflict.payload.empty');
    case 'fields': {
      const count = summary.fields.length;
      if (count === 1) return t('web.conflict.payload.fieldsOne', { count });
      return t('web.conflict.payload.fields', { count });
    }
  }
}

function Side({
  side,
  label,
  icon,
  isNewer,
  disabled,
  onPick,
}: {
  side: ConflictSide | undefined;
  label: string;
  icon: React.JSX.Element;
  isNewer: boolean;
  disabled: boolean;
  onPick: () => void;
}): React.JSX.Element {
  const { t, locale } = useI18n();

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: cssVar('space.3'),
        padding: cssVar('space.4'),
        borderStyle: 'solid',
        borderWidth: cssVar('border-width.thin'),
        borderColor: isNewer
          ? (cssVar('color.primary') as string)
          : (cssVar('color.border') as string),
        borderRadius: cssVar('radius.md'),
        background: cssVar('color.surface'),
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: cssVar('space.2'),
          fontSize: cssVar('font-size.xs'),
          color: cssVar('color.foreground-muted'),
        }}
      >
        {icon}
        <span>{label}</span>
        {isNewer ? (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: cssVar('font-size.2xs'),
              color: cssVar('color.primary'),
            }}
          >
            {t('web.conflict.newer')}
          </span>
        ) : null}
      </div>

      {side === undefined ? (
        // 🔴 取不到对端版本时必须**明说**。
        // 显示成空白会让人以为"对端什么都没写"，从而做出相反的判断。
        <p
          style={{
            margin: 0,
            fontSize: cssVar('font-size.sm'),
            color: cssVar('color.foreground-muted'),
            fontStyle: 'italic',
          }}
        >
          {t('web.conflict.remoteUnavailable')}
        </p>
      ) : (
        <>
          <p
            style={{
              margin: 0,
              fontSize: cssVar('font-size.base'),
              color: cssVar('color.foreground'),
              lineHeight: cssVar('line-height.normal'),
              wordBreak: 'break-word',
            }}
          >
            {payloadSummaryText(side.payload, t)}
          </p>
          <span
            style={{
              fontSize: cssVar('font-size.2xs'),
              color: cssVar('color.foreground-muted'),
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatTime(side.timestamp, locale)}
          </span>
        </>
      )}

      <button
        type="button"
        className={isNewer ? 'ht-btn ht-btn--primary' : 'ht-btn'}
        disabled={disabled || side === undefined}
        onClick={onPick}
        style={{ marginTop: 'auto' }}
      >
        <Check size={15} aria-hidden="true" />
        {t('web.conflict.keepThis')}
      </button>
    </div>
  );
}

export function ConflictDialog(): React.JSX.Element | null {
  const { t } = useI18n();
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
  }, [open, closeConflictDialog]);

  if (!open) return null;

  /**
   * 🔴 词条表没有 ICU：1 处冲突时英文必须走单数兄弟词条
   * （"these 1 places" 是一眼可见的坏句子）。
   */
  const title =
    conflicts.length === 1
      ? t('web.conflict.titleOne', { count: conflicts.length })
      : t('web.conflict.title', { count: conflicts.length });

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
              color: cssVar('color.warning' as TokenName),
              paddingTop: cssVar('space.1'),
            }}
          >
            <AlertTriangle size={20} aria-hidden="true" />
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
                margin: `${cssVar('space.2') as string} 0 0`,
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
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {conflicts.map((conflict) => {
          /**
           * 🔴 「较新」的判定**不在这里**，而是调 `@heyta/sync-client` 的
           * `compareConflictFreshness`。这条规则原本只在本文件里，
           * 移动端做冲突界面时若再写一遍就是两份实现 —— 而漂移的后果是
           * **同一个冲突在两个平台上"较新"标在不同的一侧**。
           * 一处实现、两端消费；规则本身的可失败检查在 `sync-client` 的测试里。
           *
           * ⚠️ 它只影响哪个按钮被高亮，**不影响任何一个字节的数据**。
           */
          const { localNewer, remoteNewer } = compareConflictFreshness(
            conflict.local,
            conflict.remote,
          );
          const busy = status.kind === 'syncing';

          return (
            <div
              key={conflict.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: cssVar('space.3'),
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: cssVar('space.2'),
                  fontSize: cssVar('font-size.xs'),
                  color: cssVar('color.foreground-muted'),
                  borderTopStyle: 'solid',
                  borderTopWidth: cssVar('border-width.thin'),
                  borderTopColor: cssVar('color.border-subtle') as string,
                  paddingTop: cssVar('space.3'),
                }}
              >
                <span>{conflict.entityType}</span>
              </div>

              <div
                style={{
                  display: 'flex',
                  gap: cssVar('space.3'),
                  alignItems: 'stretch',
                }}
              >
                <Side
                  side={conflict.local}
                  label={t('web.conflict.side.local')}
                  icon={<Monitor size={14} aria-hidden="true" />}
                  isNewer={localNewer}
                  disabled={busy}
                  onPick={() => {
                    void resolveConflict(conflict, 'keep-local');
                  }}
                />
                <Side
                  side={conflict.remote}
                  label={t('web.conflict.side.remote')}
                  icon={<Smartphone size={14} aria-hidden="true" />}
                  isNewer={remoteNewer}
                  disabled={busy}
                  onPick={() => {
                    void resolveConflict(conflict, 'keep-remote');
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
