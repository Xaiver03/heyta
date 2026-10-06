/**
 * 任务提醒的接线（移动端粘合层）
 * ================================
 *
 * 🔴 **这里是 `apps/mobile` 里唯一一处 `createReminderActions(...)`。**
 *
 * 界面（`TaskDetailSheet`）只消费下面这个 hook 暴露的动作，**一行 op 的构造都不写** ——
 * "提醒的 id 是什么形状""没有截止时间时抛错还是静默建一条绝对提醒""一条任务最多几条"
 * 全部来自 `@heyta/app-host` 的 `createReminderActions`（见那个文件头的五条语义）。
 * `scripts/check-layering.mjs` 的 `no-op-construction-in-apps` 盯着这条边界：
 * `apps/*` 里出现 `entityType: 'REMINDER'` 字面量会直接红。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么是 hook，而不是像 `ListsSection` 那样把逻辑摊在屏里
 *
 * 提醒的宿主是**任务详情面板**（`TaskDetailSheet`），它由 `TasksScreen` 渲染，
 * 拿不到 `AppHost`（只拿到父屏建好的 `TaskActions`）。所以这里自己
 * `openTaskHost()` —— 它是**单例**的（缓存的是 Promise，见 `db/open-host.ts`），
 * 再开一次不会多一条 SQLite 连接。把这段放在 lib 里而不是屏里，理由有两条：
 *   1. `TaskDetailSheet` 已经很长，且它不是"提醒"这一件事的所有者；
 *   2. 以后日历屏要挂提醒面板时，直接复用这个 hook，不必再抄一遍接线
 *      （抄一遍就是两份会漂移的实现，这正是 AGENTS.md §3.5 收尾要避免的）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 刷新靠两件事，缺一不可
 *
 *   1. **动作完成后自己重读一遍**（`run` 里的 `.then(read)`）。`listForTask()`
 *      读的是**已物化的内存状态**，写完不重读，刚建的提醒不会出现在列表里 ——
 *      用户看到的是"点了没反应"，而数据其实已经写进去了。
 *   2. **订阅 `dataRevision`**：另一台设备同步下来的提醒（或本机同步完成后
 *      重新物化的状态）不会触发 React 重渲染。不订阅的话，这一屏在整个
 *      应用生命周期里都不会重读 —— 症状与"同步没成功"一模一样。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 抛错必须冒到界面上，不许静默吞
 *
 * `createReminderBeforeDue` 在任务没有截止时间时**抛错**，
 * `writeNew` 在超过每任务上限时**抛错**。这两条都不该在界面里被"提前判断掉"
 * —— 提前判断就是第二份定义（领域层改了上限，界面不会跟着变）。
 * 所以这里只做一件事：把异常原因（原始文本，是**数据**不是文案）
 * 存进 `error`，由 `TaskDetailSheet` 用 `tone="danger"` 的那一行显示出来。
 * ⚠️ 原始文本**不翻译**：它是系统信息，要能拿去搜索/对照日志
 * （与 `HabitsScreen` / `ProfileScreen` 的做事方式一致）。
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import type { Reminder } from '@heyta/domain';
import { createReminderActions, type AppHost, type ReminderActions } from '@heyta/app-host';

import { openTaskHost } from '../db/open-host';
import { useMobileSync } from '../sync/store';
import { onLocalWrite } from '../sync/write-signal';
import { absoluteReminderTriggerAt, snoozeTargetAt } from './reminders-display';
import { authorizeNativeReminders, getUncertainReminderOccurrences, subscribeReminderDelivery } from './native-reminder-scheduler';

/** 提醒面板要用的全部东西 —— 界面不需要（也不该）知道下面还有没有别的。 */
export interface TaskReminderWiring {
  /** 该任务**未删除**的提醒（`listForTask()` 已经滤掉墓碑）。 */
  readonly reminders: readonly Reminder[];
  readonly uncertainOccurrences: readonly string[];
  /**
   * 最近一次动作的失败原因（原始文本）。`null` = 没有错误。
   *
   * 🔴 与 `HabitsScreen` 的 `error` 同一个取舍：带原因不带整句文案 ——
   * 这是个不认识 i18n 的接线层，拼中文句子会让英文界面里漏出一句中文。
   */
  readonly error: string | null;
  /** 建一条"截止前 offsetMs"的提醒（`0` = 截止时）。任务无截止时间时抛错。 */
  readonly addBeforeDue: (offsetMs: number) => void;
  /** 建一条绝对时刻提醒：**现在 + 1 小时**（文案是 `reminder.absolute.1h`）。 */
  readonly addAbsoluteInOneHour: () => void;
  /** 稍后提醒（10 分钟，来自领域层 `snoozeDeadline`）。收**提醒自己的 id**。 */
  readonly snooze: (entityId: string) => void;
  /** 关闭这条提醒。收**提醒自己的 id**。 */
  readonly dismiss: (entityId: string) => void;
  /** 移除这条提醒。收**提醒自己的 id**。 */
  readonly remove: (entityId: string) => void;
}

/**
 * 订阅某条任务的提醒。
 *
 * `taskId === undefined`（面板还没选中任务）时返回空列表、动作全部是空操作 ——
 * 调用方因此可以无条件调这个 hook（**hooks 不能在提前 return 之后**，
 * 见 `TaskDetailSheet` 里那两处注释）。
 */
export function useTaskReminders(taskId: string | undefined): TaskReminderWiring {
  const uncertainOccurrences = useSyncExternalStore(subscribeReminderDelivery, getUncertainReminderOccurrences);
  // 见文件头第 2 条：同步完成信号。
  const { dataRevision } = useMobileSync();

  const [host, setHost] = useState<AppHost | null>(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void openTaskHost()
      .then((opened) => {
        // 卸载后 `setState` 是无声的脏写入（面板关闭时正好开完库）。
        if (alive) setHost(opened);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  // 与 `TasksScreen` 同一条规则：动作集从宿主派生，不在界面里新造。
  const actions = useMemo<ReminderActions | null>(
    () => (host ? createReminderActions(host) : null),
    [host],
  );

  const read = useCallback((): void => {
    if (actions === null || taskId === undefined) {
      setReminders([]);
      return;
    }
    // ⚠️ `listForTask()` 是**同步**的（读已物化状态），不是 Promise。
    setReminders(actions.listForTask(taskId));
  }, [actions, taskId]);

  useEffect(read, [read, dataRevision]);
  // Receipt reconciliation writes outside this hook's run() callbacks, and
  // local-only mode never advances the sync revision.
  useEffect(() => onLocalWrite(read), [read]);

  /** 跑一个动作：成功就重读、失败就把原因摆到界面上（见文件头第 3 条）。 */
  const run = useCallback(
    (pending: Promise<unknown>): void => {
      setError(null);
      void pending
        .then(read)
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message : String(e));
        });
    },
    [read],
  );

  const addBeforeDue = useCallback(
    (offsetMs: number): void => {
      if (actions === null || taskId === undefined) return;
      void authorizeNativeReminders().catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      });
      run(actions.createReminderBeforeDue(taskId, offsetMs));
    },
    [actions, taskId, run],
  );

  /**
   * 绝对时刻入口。时刻在**动作发生时**取 `Date.now()`，不在渲染里取 ——
   * 在渲染里取自 `now` 的话，面板开着不动时"1 小时后"会一直指向同一个过去时刻。
   */
  const addAbsoluteInOneHour = useCallback((): void => {
    if (actions === null || taskId === undefined) return;
    void authorizeNativeReminders().catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
    });
    run(actions.createReminder(taskId, absoluteReminderTriggerAt(Date.now())));
  }, [actions, taskId, run]);

  const snooze = useCallback(
    (entityId: string): void => {
      if (actions === null) return;
      run(actions.snoozeReminder(entityId, snoozeTargetAt(Date.now())));
    },
    [actions, run],
  );

  const dismiss = useCallback(
    (entityId: string): void => {
      if (actions === null) return;
      run(actions.dismissReminder(entityId));
    },
    [actions, run],
  );

  const remove = useCallback(
    (entityId: string): void => {
      if (actions === null) return;
      run(actions.removeReminder(entityId));
    },
    [actions, run],
  );

  return { reminders, uncertainOccurrences, error, addBeforeDue, addAbsoluteInOneHour, snooze, dismiss, remove };
}
