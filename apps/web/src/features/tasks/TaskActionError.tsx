import { useI18n } from '@heyta/i18n';

import { useTaskStore } from './store.js';

/**
 * 任务动作失败的**一行说明**（布局审计 §8.2 第 12 条）。
 *
 * ## 为什么它必须存在
 *
 * `App.tsx` 那批调用点写成 `void store.toggleComplete(id)` /
 * `void store.deleteTask(task.id)` —— 拒绝没有去处。用户按下勾选，
 * 看到的样子是"这一行闪回去了"或干脆"点了没反应"，
 * 而真正发生的可能是**这一次写入没有落库**。
 * "界面在说谎"里最难发现的一种就是它：界面没说错什么，
 * 它只是在**该说话的时候没说**。
 *
 * ## 为什么只有一行、挂在内容列顶部
 *
 * 要覆盖的是**所有**任务面（收集箱 / 看板 / 象限 / 日历 / 时间线 / 回收站）。
 * 逐面各挂一份 = 六份各自维护的失败提示，而且新面会长得没有它；
 * 挂一次和 `<SubscriptionNotice />` 是同一个位置逻辑。
 *
 * ## 🔴 说的与不说的
 *
 * 说「这一步没有保存成功」+「可以重试」。**不说** `error.message` 原文 ——
 * 那是内部原因（引擎没初始化 / 实体不存在 / 存储写不进去），
 * 把诊断信息当文案贴给用户，是 `card-export` 那次已经改过的同一个错。
 * 样式沿用全站既有的失败行 `ht-settings__danger`（`role="alert"`），
 * 所以这里**没有新 CSS**，也不会出现"挂了类名但没人渲染"。
 */
export function TaskActionError(): React.JSX.Element | null {
  const failure = useTaskStore((state) => state.error);
  const { t } = useI18n();

  if (failure === undefined) return null;

  return (
    <div className="ht-settings__notice" role="alert" aria-live="assertive" data-testid="task-action-error">
      <span className="ht-settings__danger">{t('web.tasks.actionFailed')}</span>
      <button
        type="button"
        className="ht-btn ht-btn--ghost"
        data-testid="task-action-error-dismiss"
        onClick={() => {
          // 只清这一格的显示，不假装"已经重试过"：数据状态一个字都不动。
          useTaskStore.setState({ error: undefined });
        }}
      >
        {t('web.tasks.dismissFailure')}
      </button>
    </div>
  );
}
