/**
 * 提醒投递的**接线** —— 把 `store.due` 真的送到用户眼前
 * ======================================================
 *
 * ⚠️ 这个文件存在的唯一理由是：**纯函数有测试 ≠ 用户收得到**。
 *
 * 本仓最高发的那类失效就是这个形状：`due` 算好了躺在 state 里（前一个坑），
 * 或者 `deliverDueReminders` 写好了、测得好好的，**而没有调用点**（这一个坑）。
 * 所以接线与纯逻辑分成两个文件，而**接线这一层也要有它自己的验收**
 *（`apps/web/tests/reminder-notify-wiring.spec.tsx` 挂真 `<App />` 断言通知真的出去了）。
 *
 * ## 为什么订阅 `due` 而不是自己轮询
 *
 * `due` 由提醒 store 在**每次引擎变化之后**重算并落盘
 *（`reminders/store.ts` 的 `refresh()`）。自己再挂一个 `setInterval` 会有第二个
 * "什么时候算到点"的判据，而它与 store 那份必然漂移 ——
 * 症状是"面板里显示已到点、通知却不响"。
 *
 * ⚠️ 这带来一个真实的局限：**应用没开、或者没有发生任何 op 时，不会到点自动响。**
 * 见 `notify.ts` 文件头那段"如实写出的局限"。这是刻意接受的：
 * 后台唤醒需要一套不泄露内容的协议，不是这里顺手能补的。
 */

import { useEffect, useRef } from 'react';

import { useI18n } from '@heyta/i18n';

import { useReminderStore } from './store.js';
import { deliverDueReminders, type DeliveryOutcome } from './notify.js';
import { useTaskStore } from '../tasks/store.js';

/**
 * 监听"已到点、还没投递"的提醒并投出去。
 *
 * 返回值只为测试/诊断用（真实调用点忽略它）。
 */
export function useReminderNotifications(): { last: DeliveryOutcome | undefined } {
  const { t } = useI18n();
  const due = useReminderStore((s) => s.due);
  const tasks = useTaskStore((s) => s.entities.tasks);

  /**
   * 已经投过的提醒 id。
   *
   * 🔴 用 `useRef` 而不是 state：它**不该**触发重渲染，而且必须跨渲染持有。
   * 放 state 会让"投出去了"这件事本身引起一次渲染 —— 而那又会重跑这个 effect。
   */
  const shown = useRef(new Set<string>());
  const last = useRef<DeliveryOutcome | undefined>(undefined);

  useEffect(() => {
    const outcome = deliverDueReminders(due, tasks, shown.current, {
      // 通知的标题就是产品名 —— 它出现在系统通知里，所以必须走词条
      //（硬编码会被 `check:ui-language` 拦，而它正是为这一类存在的）。
      title: t('common.brand'),
      // 正文是**任务标题本身**：这是"有显示路径"与"只弹一句泛泛的话"的分界。
      // 泛泛的"你有新提醒"等于没有告诉用户任何事。
      body: (taskTitle: string) => t('web.reminder.notify.body', { title: taskTitle }),
    });
    last.current = outcome;

    /**
     * 🔴 投出去就要**落库**（写 `firedAt` op），否则"投过"只活在这一次页面加载里。
     *
     * `shown.current` 是 `useRef(new Set())`：刷新即忘、另一台设备完全不知道。
     * 领域层判 `fired` **优先于** `due`，所以把 `firedAt` 写成 op 之后，
     * 这条提醒在任何一端重放同一份状态时都不会再进 `due()`。
     * （此前 `markReminderFired` 全仓库只有它自己的单测在调 —— 见计划 D14。）
     *
     * ⚠️ 不 `await`：effect 里等一条写 op 会把"弹通知"变成"等同步"，
     * 而失败已经由 store 落进 `error` 并在面板上渲染（`attempt` 的既有纪律）。
     */
    if (outcome.deliveredIds.length > 0) {
      void useReminderStore.getState().markDelivered(outcome.deliveredIds);
    }
  }, [due, tasks, t]);

  return { last: last.current };
}
