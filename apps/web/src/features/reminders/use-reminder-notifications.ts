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
 * ## W9 ②：那不等于"不需要定时器"，只是定时器**不许带判据**
 *
 * 上面那条推理曾推出一句过强的结论："没有 op 就不会响" —— 而那正是缺陷本身：
 * 用户 09:00 建一条"09:30 提醒我"，之后不再产生任何 op，09:30 那一刻
 * **没人去问一次**。现在由 `use-reminder-wake.ts` 补上那一次问：它只算
 * "下一个该看的时刻"，到点调 `store.recheck()`，而 `recheck()` 里只有
 * 动作层那**同一个** `due()`。⇒ 判据仍只有一份，多出来的只是一个钟。
 *
 * ⚠️ 补完之后仍然有一个真实局限：**应用进程不在（关掉）不会响**。
 * 那需要 Service Worker + 一个不泄露内容的唤醒协议，见 `notify.ts` 文件头。
 */

import { useEffect, useRef } from 'react';

import { useI18n } from '@heyta/i18n';

import { useReminderStore } from './store.js';
import { deliverDueReminders, type DeliveryOutcome } from './notify.js';
import { useReminderWakeTimer } from './use-reminder-wake.js';
import { useTaskStore } from '../tasks/store.js';

/**
 * 监听"已到点、还没投递"的提醒并投出去，**同时挂上到点自醒的钟**。
 *
 * 返回值只为测试/诊断用（真实调用点忽略它）。
 *
 * 🔴 定时器为什么挂在**这里**而不是 `App.tsx`：这个 hook 已经挂在根组件上了
 *（`App.tsx` 里那一行 `useReminderNotifications()`）。于是"什么时候醒"与
 * "醒了投给谁"在同一个子树里 —— 拆成两处挂，就会有一处哪天被忘掉。
 */
export function useReminderNotifications(): { last: DeliveryOutcome | undefined } {
  const { t } = useI18n();
  useReminderWakeTimer();
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
    last.current = deliverDueReminders(due, tasks, shown.current, {
      // 通知的标题就是产品名 —— 它出现在系统通知里，所以必须走词条
      //（硬编码会被 `check:ui-language` 拦，而它正是为这一类存在的）。
      title: t('common.brand'),
      // 正文是**任务标题本身**：这是"有显示路径"与"只弹一句泛泛的话"的分界。
      // 泛泛的"你有新提醒"等于没有告诉用户任何事。
      body: (taskTitle: string) => t('web.reminder.notify.body', { title: taskTitle }),
    });
  }, [due, tasks, t]);

  return { last: last.current };
}
