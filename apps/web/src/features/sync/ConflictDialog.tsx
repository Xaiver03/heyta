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

import { useSyncStore } from './store.js';
import {
  describeConflictPayload,
  type ConflictInfo,
  type ConflictSide,
} from '@heyta/sync-client';

/** 时间戳 → 可读时间。冲突界面里"谁更新"是判断依据，必须看得懂。 */
function formatTime(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
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
            较新
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
          取不到这一侧的版本
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
            {describeConflictPayload(side.payload)}
          </p>
          <span
            style={{
              fontSize: cssVar('font-size.2xs'),
              color: cssVar('color.foreground-muted'),
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatTime(side.timestamp)}
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
        保留这一版
      </button>
    </div>
  );
}

export function ConflictDialog(): React.JSX.Element | null {
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
              这 {conflicts.length} 处改动两边都改过
            </h2>
            <p
              style={{
                margin: `${cssVar('space.2') as string} 0 0`,
                fontSize: cssVar('font-size.sm'),
                color: cssVar('color.foreground-muted'),
                lineHeight: cssVar('line-height.normal'),
              }}
            >
              heyta 不会替你决定保留哪一版 —— 自动挑一个会
              <strong>悄悄丢掉</strong>
              另一边的改动。每一处都请你看一眼再选。没选的那些会一直留在本地，不会丢。
            </p>
          </div>
          <button
            type="button"
            aria-label="稍后再处理"
            className="ht-btn ht-btn--ghost"
            onClick={closeConflictDialog}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {conflicts.map((conflict) => {
          const localNewer =
            conflict.remote === undefined || conflict.local.timestamp > conflict.remote.timestamp;
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
                  label="本机"
                  icon={<Monitor size={14} aria-hidden="true" />}
                  isNewer={localNewer}
                  disabled={busy}
                  onPick={() => {
                    void resolveConflict(conflict, 'keep-local');
                  }}
                />
                <Side
                  side={conflict.remote}
                  label="其他设备"
                  icon={<Smartphone size={14} aria-hidden="true" />}
                  isNewer={!localNewer}
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
