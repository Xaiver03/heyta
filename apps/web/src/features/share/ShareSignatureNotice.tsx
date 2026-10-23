/**
 * 共享内容**验签没过**时的那一行说明（ADR-0069 裁决五的界面落点）。
 *
 * ## 为什么它必须存在
 *
 * 读侧遇到一条对不上签名的 op 时做的是**拒绝写入并停下这一轮**：内容不落盘、游标不推进。
 * 界面如果什么都不说，用户看到的形状就是"同事写的那条根本没出现过"——
 * 而这恰恰是这条线一直在防的静默：数据没被改掉，但**少了东西没人知道**。
 * 所以这一格的全部作用是：把"这台设备替你拒了 N 条"说出来，并且说得出**是哪一种失败**。
 *
 * ## 为什么挂在这里而不是评论区里
 *
 * 被拒的 op 不只可能是评论：任务、便签、清单改名走的是同一本日志、同一个验签关口。
 * 挂在评论区里 ⇒ 被拦掉的是一条任务时界面一句都不说。挂一次和 `<TaskActionError />`
 * 是同一个位置逻辑（覆盖收集箱 / 看板 / 象限 / 日历 / 时间线 / 回收站六个面）。
 *
 * ## 「知道了」关掉的是什么
 *
 * 只关这一格的显示，不改任何数据。它**会自己回来**：游标停在被拒那条之前，
 * 下一轮拉取必然再撞上同一条 —— 报警不需要第二份"待办清单"来记住它。
 *
 * ## 🔴 说的与不说的
 *
 * 说「哪一类失败 + 几条 + 没有接收」。**不说** op id、服务端游标、公钥指纹 ——
 * 那些是诊断信息，贴给用户只会变成一段没人读得懂的乱码（`card-export` 那次已经改过这个错）。
 * 样式沿用全站既有的失败行 `ht-settings__notice` + `ht-settings__danger`（`role="alert"`），
 * 所以这里**没有新 CSS**，也不会出现"挂了类名但没人渲染"。
 */

import { useEffect, useState } from 'react';

import type { ShareSignatureRejection } from '@heyta/app-host';
import { useI18n } from '@heyta/i18n';

import { subscribeShareRepaint } from '../../lib/share-signal-sink.js';
import { webShareSession } from './share-session.js';

/**
 * 要报警的两种失败，**固定顺序**（清单顺序 = 界面顺序，不给渲染留随机性）。
 *
 * `verified` / `unsigned` 不在这里：前者是好消息不占界面，后者是存量行的正常形状
 * （签名分期落地之前写的那些），把它们也报出来等于把老清单全量报成事故。
 */
const OUTCOME_KEYS = {
  invalid: 'web.share.signature.invalid',
  'signer-unregistered': 'web.share.signature.signerUnregistered',
} as const satisfies Record<ShareSignatureRejection['outcome'], string>;

/** 画的时候按这张表的键序（字面量顺序 = `Object.keys` 顺序），不再另列一份名单。 */
const OUTCOME_ORDER = Object.keys(OUTCOME_KEYS) as ShareSignatureRejection['outcome'][];

/** 同一批拒的是什么、拒了几条 —— 这一串就是"用户已经看过的那一版"。 */
function rejectionKey(rejections: readonly ShareSignatureRejection[]): string {
  return rejections.map((r) => `${r.shareId}:${String(r.serverSeq)}:${r.outcome}`).join('|');
}

export function ShareSignatureNotice(): React.JSX.Element | null {
  const { t } = useI18n();
  const [, setRepaint] = useState(0);
  const [dismissedKey, setDismissedKey] = useState<string | undefined>(undefined);

  // 拉取只有一个出口（`comment-actions.ts` 的 `pullShareOps`），它在真拒了东西时敲这一下；
  // 值本身不进渲染，存在只是为了让这一节重读一次那一份共享实例。
  useEffect(() => subscribeShareRepaint(() => setRepaint((n) => n + 1)), []);

  const rejections = webShareSession()?.signatureRejections() ?? [];
  const key = rejectionKey(rejections);
  if (rejections.length === 0 || key === dismissedKey) return null;

  return (
    <div
      className="ht-settings__notice"
      role="alert"
      aria-live="assertive"
      data-testid="share-signature-notice"
    >
      {OUTCOME_ORDER.flatMap((outcome) => {
        const count = rejections.filter((r) => r.outcome === outcome).length;
        if (count === 0) return [];
        return (
          <span key={outcome} className="ht-settings__danger" data-testid={`share-signature-${outcome}`}>
            {t(OUTCOME_KEYS[outcome], { count })}
          </span>
        );
      })}
      <button
        type="button"
        className="ht-btn ht-btn--ghost"
        data-testid="share-signature-notice-dismiss"
        onClick={() => {
          setDismissedKey(key);
        }}
      >
        {t('web.share.signature.dismiss')}
      </button>
    </div>
  );
}
