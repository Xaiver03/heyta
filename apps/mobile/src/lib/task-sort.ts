/**
 * 任务列表的排序档位（移动壳）
 * ============================
 *
 * 🔴 **这里没有一行比较逻辑。** 每一档怎么排、已完成为什么永远沉底、
 * 同档为什么保持原序 —— 全部在 `@heyta/domain` 的 `sortTasks`，
 * 档位清单是它的 `TASK_SORT_KEYS`。本文件只做两件事：把档名映射到词条，
 * 以及记住"这台设备选的是哪一档"。
 *
 * 为什么必须这样：`packages/ui` 的 `model.ts` 文件头记着一次真实事故 ——
 * app-host 自己写了一份 `(createdAt, id)` 排序，于是**同一账号在桌面壳和
 * web/移动端看到不同顺序**。而移动端在此之前的写法更直接：
 * `TasksScreen` 对每个分组 `reverse()`（见下面的 `DEFAULT_TASK_SORT`）。
 * 那已经是**第三份**比较规则了，而且它不会报错，只会画错。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 命名空间残差：档位名复用 `web.shell.sort.*`
 *
 * 与 `lib/quadrant-display.ts` 复用 `web.quadrant.*` 同一个先例：排序这件事
 * **四端完全同义**，正确的命名空间是 `common.sort.*`，但词条表按壳分了段，
 * 新增一套同义键就是让同一句话有三个键。将来合并命名空间时这里是纯改名。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 存储：走 `prefs/device-prefs.ts`，与 Web 的 localStorage 同一位置
 *
 * 三条边界都是既有文件划好的，这里只是复用：
 *
 * 1. **不进 op-log**。op-log 存用户意图；"列表怎么排"是这台设备的阅读偏好，
 *    写进日志会让另一台设备被同步改掉自己的选择（Web 同处置）。
 * 2. **不进 `META_KEYS`**。`packages/storage` 里那张表明确写着"同步协议的关键
 *    状态，不是普通配置"。
 * 3. **不进同步实体**。换一台设备应当有它自己的第一印象，与该设备上看到过
 *    什么顺序无关。
 *
 * ⚠️ `device-prefs` 的契约是**永不抛**，且"写不进去"是可能发生的（原生模块
 * 不在、库损坏）。这里的降级后果只有一句：下次冷启动回到默认档，列表照常
 * 显示。所以本层不向上报"保存失败" —— 但也不假装写成了磁盘：返回值原样
 * 透给调用方，需要时可以说明。
 */

import { TASK_SORT_KEYS, type TaskSortKey } from '@heyta/domain';
import type { I18nValue, MessageKey } from '@heyta/i18n';
import { readDevicePref, writeDevicePref } from '../prefs/device-prefs';

/**
 * 档名 → 词条。
 *
 * 🔴 用 `Record<TaskSortKey, MessageKey>` 而不是 `Map`：`TaskSortKey` 是字面量
 * 联合，加一档却没给文案 ⇒ **编译期**报缺键。写成 `Map` 或对象字面量不标注，
 * 报错会推迟到运行时"界面上少一个选项"，而那正是没人会去查的那种坏法。
 */
const SORT_LABEL_KEY: Record<TaskSortKey, MessageKey> = {
  display: 'web.shell.sort.display',
  addedAt: 'web.shell.sort.addedAt',
  priority: 'web.shell.sort.priority',
};

/**
 * 移动端的默认档：**新的在上**（`addedAt`）。
 *
 * ⚠️ 这与 Web 的默认档（`display`，按截止时间）**刻意不同**，不是漏改：
 *
 * - Web 的列表已经按**日期**分了组，组内再按截止时间排是在同一把尺子上细分；
 * - 移动端的分组是**紧急程度**（已过期 / 今天 / 收集箱 / 已完成），其中
 *   "收集箱"整组都没有截止时间 —— 那一组按 `display` 排会全部并列，
 *   稳定排序后落回 `createdAt` **升序**，于是新建的任务掉到屏幕外。
 *   这个代价是移动端实测过的（旧 `TasksScreen` 的注释原话：用户唯一的反馈
 *   是角标从 9 变成 10，会怀疑"我到底加上了吗"），所以那一屏当时的选择是
 *   `reverse()`。`addedAt` 就是同一个语义，只是换成了领域的那一份实现。
 */
export const DEFAULT_TASK_SORT: TaskSortKey = 'addedAt';

/** 设备本地偏好表里的键。与 `PREF_KEY_WELCOME_SEEN` 同一张表、同一条契约。 */
export const PREF_KEY_TASK_SORT = 'task.sort';

/** 字符串 → 档位。不在领域清单里的值一律算"没有值"，不猜、不抛。 */
function toTaskSortKey(raw: string | undefined): TaskSortKey | undefined {
  return raw !== undefined && (TASK_SORT_KEYS as readonly string[]).includes(raw)
    ? (raw as TaskSortKey)
    : undefined;
}

/**
 * 当前档位。
 *
 * 读不到（没存过 / 库不可用 / 值被写坏）一律回默认档 —— 调用点是界面，
 * 一个坏值不该让列表变空白。判据与 Web 的 `features/tasks/sort-pref.ts` 同一条。
 */
export function readTaskSort(): TaskSortKey {
  return toTaskSortKey(readDevicePref(PREF_KEY_TASK_SORT)) ?? DEFAULT_TASK_SORT;
}

/**
 * 记下用户选的档位。返回**是否真的写进去了**（`device-prefs` 的纪律：
 * 不许静默假装成功）。
 *
 * ⚠️ 非法值**不写**并返回 `false`：写进去的那条坏值会让下次启动静默回到
 * 默认档，而"我明明选了按优先级"会以一种没人能复现的方式失效。
 */
export function writeTaskSort(sort: TaskSortKey): boolean {
  const valid = toTaskSortKey(sort);
  if (valid === undefined) return false;
  return writeDevicePref(PREF_KEY_TASK_SORT, valid);
}

/** 选择面板要列出的档位 —— 直接用领域的清单，不在此重列。 */
export const TASK_SORT_OPTIONS: readonly TaskSortKey[] = TASK_SORT_KEYS;

/** 档名 → 当前语言的说法。 */
export function taskSortName(t: I18nValue['t'], sort: TaskSortKey): string {
  return t(SORT_LABEL_KEY[sort]);
}

/** 列表页那颗 chip 的文字（「排序：按优先级」）。 */
export function taskSortChipLabel(t: I18nValue['t'], sort: TaskSortKey): string {
  return t('mobile.tasks.sort.label', { sort: taskSortName(t, sort) });
}

/** 词条映射表（测试与另一端对账时要能读到）。 */
export const SORT_LABEL_KEYS = SORT_LABEL_KEY;
