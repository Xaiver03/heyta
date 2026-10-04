/**
 * 设置页的「注销账号」（批次 E3）
 * ================================
 *
 * 服务端早就有 `DELETE /api/account`（级联硬删），E2 也把"收到注销信号就清本机"
 * 那条反应装好了 —— 但在补上这个面板之前，**整个仓库没有任何调用点**：
 * "自助注销"在界面上是一句空话，用户唯一的出口是求运营者删号，
 * 而那既不是 GDPR 意义上"可行使的删除权"，也满足不了苹果 5.1.1(v)。
 *
 * ## 分层（AGENTS.md §3.5）
 *
 * 这里没有一行协议知识：
 *   - 端点 / 令牌怎么带 / 失败归类 → `@heyta/app-host` 的 `hosted-auth.ts`；
 *   - "服务端没删成就不许清本机"这条**顺序** → `@heyta/app-host` 的 `account-closure.ts`；
 *   - 清哪些东西 → `apps/web/src/lib/local-data-destruction.ts`（宿主自己的那几类存储）。
 * 本文件只做两件事：渲染，和收集那一个必须打的勾。
 *
 * ## 🔴 三处形状是判据，不是审美
 *
 *   1. **未登录不画。** 没有令牌就没有"哪个账号"可注销；画一个必然失败的按钮
 *      比不画更糟（与 `WidgetPushPanel` 同一立场：能力不在就不出现）。
 *   2. **两段式，中间那个勾是必需项。** 注销不可逆，而且它现在会连带清掉
 *      **这台设备上还没同步出去的数据** —— 那部分从没进过服务端，删了就真没了，
 *      云端备份救不回来。所以句子必须明说，勾必须打。
 *      没做"输入邮箱确认"那一档：它拦不住真心想删的人，却会把"我没读懂"
 *      变成一次打字错误，而这里需要的恰恰是读懂。
 *   3. **四种结局各有各的句子。** "账号没了没有"与"本机干净了没有"是两件事，
 *      压成一句"已完成"会在 `closed-erase-partial` 那次同时朝两个方向说谎。
 *
 * ⚠️ 成功后不把界面上的凭据"就地抹掉"：令牌留在内存里直到刷新，而它下一次同步
 * 会拿回 401/410 `ACCOUNT_CLOSED` —— 那条路正是 E2 已经验过的被动销毁通道。
 * 这里给用户的是明确的一句结果，不靠那个回声。
 */

import { useState } from 'react';

import { closeAccountAndEraseLocal } from '@heyta/app-host';
import { useI18n, type MessageKey } from '@heyta/i18n';
import { accountClosureMessageKey } from '@heyta/ui';
import { AlertTriangle, ShieldX } from 'lucide-react';

import { useAuthStore } from '../auth/store.js';
import { useSyncStore } from '../sync/store.js';

/**
 * 结局 → 词条这件事**不在本文件里**。
 *
 * 🔴 路由表住在 `@heyta/ui` 的 `accountClosureMessageKey`（与 `authFailureMessageKey`
 * 同一立场：封闭集合在 app-host，句子在 i18n，中间那张表只能有一份）。
 * 这里原先自己写过一张 `Partial<Record<HostedAuthFailureReason, MessageKey>>` ——
 * 那张表的每一条在移动壳里都要再答一遍"这句该说什么"，而漂掉的一侧通常话说得更满。
 * 覆盖关系现在钉在 `packages/ui/tests/account-closure-model.spec.ts`。
 */
export function CloseAccountPanel(): React.JSX.Element | null {
  const { t } = useI18n();
  const baseUrl = useSyncStore((s) => s.baseUrl);
  const token = useSyncStore((s) => s.token);

  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  /** 两段式：第一段只到"我确定要删"，第二段才发请求。 */
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<{ sentence: MessageKey; disposition: string } | null>(null);

  const signedIn = typeof token === 'string' && token !== '';
  if (!signedIn) return null;

  const submit = async (): Promise<void> => {
    // in-flight guard（不只靠 disabled）：忙的时候重复点击直接忽略。
    if (busy || !acknowledged || typeof token !== 'string') return;
    setBusy(true);
    setDone(null);
    try {
      const result = await closeAccountAndEraseLocal({ baseUrl }, token);
      setDone({ sentence: accountClosureMessageKey(result), disposition: result.disposition });
      if (result.disposition !== 'not-closed') useAuthStore.getState().reset();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ht-settings" data-testid="close-account-panel">
      <h2 className="ht-settings__title ht-type-section-title">
        <ShieldX size={16} aria-hidden="true" /> {t('common.accountClosure.title')}
      </h2>
      <p className="ht-settings__hint">{t('common.accountClosure.lead')}</p>
      <p className="ht-settings__hint">{t('common.accountClosure.exportHint')}</p>

      <label className="ht-settings__item-label" htmlFor="close-account-ack">
        <span className="ht-settings__row">
          <input
            id="close-account-ack"
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => {
              setAcknowledged(e.target.checked);
              setConfirming(false);
              setDone(null);
            }}
          />
          {t('common.accountClosure.confirmLocal')}
        </span>
      </label>

      {acknowledged && !confirming ? (
        <div className="ht-settings__actions">
          <button
            type="button"
            className="ht-btn ht-btn--outline"
            data-testid="close-account-open"
            onClick={() => {
              setConfirming(true);
            }}
          >
            {t('common.accountClosure.action')}
          </button>
        </div>
      ) : null}

      {confirming ? (
        <div className="ht-settings__actions">
          <button
            type="button"
            className="ht-btn ht-btn--danger"
            data-testid="close-account-confirm"
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? t('common.accountClosure.busy') : t('common.accountClosure.action')}
          </button>
        </div>
      ) : null}

      {done ? (
        <p
          className="ht-settings__hint"
          role="status"
          aria-live="polite"
          data-testid="close-account-result"
          data-disposition={done.disposition}
        >
          <AlertTriangle size={16} aria-hidden="true" /> {t(done.sentence)}
        </p>
      ) : null}
    </div>
  );
}
