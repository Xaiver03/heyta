/**
 * 专注动作（宿主无关）
 * =====================
 *
 * 与 `actions.ts`（任务动作）同一个理由：**op 的构造只能有一份**。
 *
 * 专注记录看起来只是"写一条日志"，但它同样有三个必须全端一致的语义决定：
 *
 *   1. **一次专注 = 一条 `FOCUS_SESSION` op。** 不是"开始写一条、结束再改一条" ——
 *      那样中途杀进程会留下一条永远不结束的记录，而"哪些记录算完成"就没人说得清。
 *   2. **`completed` 必须有值。** 自然完成与中途放弃是**两种不同的东西**，
 *      统计时要分开。缺省它会让"完成了 3 个"把放弃的也算进去。
 *   3. **可清除字段写 `null`，不写 `undefined`**（同 `actions.ts` 文件头第 2 条）：
 *      `undefined` 会被 `JSON.stringify` 丢掉，于是载荷里那个键根本不存在，
 *      对端既不会设置也不会清除。这里 `taskId` 就是这种字段 ——
 *      不关联任务的专注，和"关联任务被取消"必须能被区分。
 *
 * 🔴 之所以放在 `packages/app-host` 而不是移动端的 FocusScreen 里：
 * 见 AGENTS.md §3.5 —— 判断方法是"这段代码里有没有一行在决定业务上该怎么做"。
 * "一次专注该记哪些字段"显然是。
 */

import type { FocusSession } from '@heyta/domain';
import type { EntityType } from '@heyta/shared-schema';
import { OpType } from '@heyta/sync-core';

import type { ActionContext } from './actions.js';
import { randomId } from './ids.js';

export interface FocusActionsOptions {
  /** 注入 id 生成器（测试用）。默认带 RN 安全回退的 `randomId()`。 */
  newFocusId?: () => string;
}

export interface FocusActions {
  /**
   * 记录一次已结束的专注轮（完成或中止）。
   *
   * 只接受**已经结束**的轮次：状态机（`packages/domain` 的 `advance` / `abort`）
   * 负责在结束时产出这个对象。计时中的状态**不落盘** ——
   * 见文件头第 1 条，避免留下永远不结束的记录。
   *
   * 返回新记录的 entityId。
   */
  log(session: FocusSession): Promise<string>;
  /**
   * 未删除的专注记录，按创建时间排序（同刻按 id 字典序）。
   *
   * 顺序与 `listTasks()` 用同一条规则：**必须在所有端一致**，
   * 否则同一份数据在两台设备上显示不同顺序。
   */
  listSessions(): FocusSession[];
}

/** 合法的专注类型。与 `FocusSessionKind` 同集合 —— 两边一起改。 */
const KINDS: ReadonlySet<string> = new Set(['work', 'shortBreak', 'longBreak']);

/**
 * 写入校验失败的**原因码**（封闭集合）。
 *
 * 🔴 这里**不写句子**。异常 message 会顺着两个壳的
 * `catch` 落进「专注记录保存失败：{reason}」那句**已翻译的**话里 ——
 * 中文句子渗进另一句话，英文界面就会露出半句中文。
 * 句子归 `packages/ui/src/focus/model.ts` 的 `focusLogFailureMessageKey`
 * 与 i18n 词条表；这里只出码，收到的值留在 message 里当**诊断数据**
 * （同 `packages/ui/src/sync/model.ts` 的 `message`：不翻译、也不映射成词条）。
 *
 * 🔴 这份清单是**唯一的真源**：联合类型与下面的判定集合都从它派生。
 * 原来三处各写一遍，而"加一条码只改了一处"这种漂移不会报错 ——
 * 它只会让那条码在界面上落到兜底句（`check-ai-coverage` 那类教训）。
 * `apps/web/tests/focus-log-failure-parity.spec.ts` 逐条遍历它，
 * 要求每一条都能在 `packages/ui` 查到词条、且两份词条表都有值。
 */
export const FOCUS_LOG_FAILURE_CODES = [
  'unknown-kind',
  'non-positive-planned-ms',
  'missing-created-at',
] as const;

/** 写入校验失败的原因码。 */
export type FocusLogFailureCode = (typeof FOCUS_LOG_FAILURE_CODES)[number];

/** 与上面那份清单同集合 —— `focusLogFailureCode` 用它做结构化判定的边界。 */
const FAILURE_CODES: ReadonlySet<string> = new Set<string>(FOCUS_LOG_FAILURE_CODES);

/** 带原因码的写入校验失败。 */
export class FocusLogValidationError extends Error {
  readonly code: FocusLogFailureCode;

  constructor(code: FocusLogFailureCode, received: string | number) {
    // message 是日志用的诊断串，不是文案：码本身可 grep，收到的值原样带上。
    super(`${code}: ${String(received)}`);
    this.name = 'FocusLogValidationError';
    this.code = code;
  }
}

/**
 * 从 caught 值里取原因码；不是校验失败就回 `undefined`。
 *
 * 🔴 **刻意不用 `instanceof`**：打包器把 `@heyta/app-host` 打成两份时
 * （monorepo 里 src 与 dist 混用就会这样），`instanceof` 认不出另一个实例
 * 抛出的错误，于是每条失败都退化成兜底句 —— 一个永远绿的判据。
 * 这里改成结构化判定：`name` 加上「`code` 属于封闭集合」。
 */
export function focusLogFailureCode(error: unknown): FocusLogFailureCode | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = error as { name?: unknown; code?: unknown };
  if (candidate.name !== 'FocusLogValidationError') return undefined;
  return FAILURE_CODES.has(String(candidate.code))
    ? (candidate.code as FocusLogFailureCode)
    : undefined;
}

export function createFocusActions(
  ctx: ActionContext,
  options: FocusActionsOptions = {},
): FocusActions {
  const makeId = options.newFocusId ?? ((): string => `focus-${randomId()}`);

  const isDeleted = (session: FocusSession): boolean => session.deletedAt !== undefined;

  return {
    async log(session) {
      if (!KINDS.has(session.kind)) {
        throw new FocusLogValidationError('unknown-kind', String(session.kind));
      }
      // 🔴 时长必须是**正数**。0 或负数记录下来会污染统计，
      // 而且在界面上表现为"今天专注了 0 分钟"——看起来像功能坏了。
      if (!Number.isFinite(session.plannedMs) || session.plannedMs <= 0) {
        throw new FocusLogValidationError('non-positive-planned-ms', session.plannedMs);
      }
      if (!Number.isFinite(session.createdAt) || session.createdAt <= 0) {
        throw new FocusLogValidationError('missing-created-at', session.createdAt);
      }

      const entityId = makeId();
      await ctx.dispatch({
        entityType: 'FOCUS_SESSION' as EntityType,
        entityId,
        opType: OpType.Create,
        payload: {
          kind: session.kind,
          // null 而不是省略 —— 见文件头第 3 条。
          taskId: session.taskId ?? null,
          plannedMs: session.plannedMs,
          // 负数夹到 0：状态机已经 `Math.max(0, ...)` 过一次，
          // 这里再兜一次是因为别的写入方（将来的手表端？）不一定照做。
          actualMs: session.actualMs === undefined ? null : Math.max(0, session.actualMs),
          // 必须有值 —— 见文件头第 2 条。缺省视为"未完成"而不是"完成"。
          completed: session.completed ?? false,
          startedAt: session.startedAt ?? null,
          endedAt: session.endedAt ?? null,
        },
      });
      return entityId;
    },

    listSessions(): FocusSession[] {
      return Object.values(ctx.getState().focusSessions)
        .filter((session) => !isDeleted(session))
        .sort((a, b) => {
          if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
          // 与 listTasks 同样的确定性决胜 —— 跨端顺序必须一致。
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
    },
  };
}
