/**
 * 把 AI 估出的工时**存进备注**，而不是新增一个持久化字段。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ## 🔴 为什么是备注，而不是 `Task.duration`
 *
 * `docs/plans/ai-capability-branches.md` §5.1 的裁决写得很明确：
 *
 * > AI 的正当位置只有一处：从标题估工期，写进一个**可选**字段。
 * > ⚠️ 但 `duration` / `startDate` 属于**不可逆层**，
 * > **必须先确认产品是否真的要做时间线视图**，再动模型。
 * > **不要为了"顺手让 AI 能估时"而加字段。**
 *
 * 也就是说：**加字段这件事需要产品先拍板，不是编码顺手就能做的。**
 * 在产品没拍板之前，估时仍然要能给用户看见、并且能改 —— 所以走备注，
 * 与拆解（`ai-breakdown.ts` 的 `mergeChecklistIntoNote`）**完全同一条路**：
 * 经 `store.setNote` → op-log → 可同步、可撤销、用户可见可编辑。
 *
 * 代价要如实说：备注里会多一行。所以它必须是**单独一行、可精确识别、
 * 可反复覆盖**的，不能每次估时都往后追加。
 *
 * ## 🔴 读回来也必须能解析
 *
 * 只写不读的话，"这条任务估过多久"除了人眼之外没有任何东西知道 ——
 * 而时间线视图恰恰需要把它读回来。所以写入与解析必须成对，
 * 且格式只有这一处定义（判据：同一份业务语义只能有一个实现，
 * 见 `docs/reference/ai-architecture.md` §14 第 19 条）。
 */

/** 备注里那一行的固定前缀。**改它等于改磁盘上已有数据的语义**，不要随手改。 */
const DURATION_LINE_PREFIX = '预计耗时：';

/** 该行的匹配规则。逐行匹配，避免误伤正文里的同名词。 */
const DURATION_LINE_PATTERN = /^预计耗时：\s*(\d+)\s*分钟\s*$/;

/**
 * 渲染成备注里的一行。
 *
 * 用中文全角冒号，与仓库其余界面文案一致（`check:ui-language`）。
 */
export function renderDurationLine(minutes: number): string {
  return `${DURATION_LINE_PREFIX}${String(minutes)} 分钟`;
}

/**
 * 把估时写进备注：**覆盖已有的那一行**，没有才追加。
 *
 * 🔴 刻意不做"追加" —— 反复估时会让备注里堆出一串历史估值，
 * 而用户要的是"当前估计是多少"。历史估值的价值在反馈层，不在这里。
 *
 * 备注为空/未定义时，结果是**只有这一行**（不产生前导空行）。
 */
export function writeDurationIntoNote(existingNote: string | undefined, minutes: number): string {
  const line = renderDurationLine(minutes);
  const current = existingNote ?? '';
  const lines = current.split('\n');

  const index = lines.findIndex((l) => DURATION_LINE_PATTERN.test(l.trim()));
  if (index >= 0) {
    lines[index] = line;
    return lines.join('\n');
  }

  // 没有就追加。**空备注不产生前导换行** —— 否则每次估时都多一个空行。
  if (current.trim() === '') return line;
  return `${current}\n${line}`;
}

/**
 * 从备注里读回估时。读不到返回 `undefined`（**不返回 0**）。
 *
 * 🔴 `undefined` 与 `0` 必须分开：`0` 是一个合法的"估了 0 分钟"，
 * 而"没估过"是另一件事。混在一起会让时间线把没估过的当成估了零。
 */
export function readDurationFromNote(note: string | undefined): number | undefined {
  if (note === undefined) return undefined;
  for (const raw of note.split('\n')) {
    const m = DURATION_LINE_PATTERN.exec(raw.trim());
    if (m !== null) {
      // ⚠️ `m[1]` 在 `noUncheckedIndexedAccess` 下是 `string | undefined` ——
      // 正则里有捕获组不代表 TS 知道它一定匹配上了。
      const digits = m[1];
      if (digits === undefined) continue;
      const minutes = Number.parseInt(digits, 10);
      if (Number.isFinite(minutes)) return minutes;
    }
  }
  return undefined;
}

/**
 * 把估时从备注里去掉（用户反悔时用）。
 *
 * 与 `writeDurationIntoNote` 对称：没写过就原样返回，
 * **不要顺手把备注重新格式化**。
 *
 * ⚠️ **当前生产零调用点**：界面还没有"撤销估时"的入口
 * （`apps/web` 只在时间线里**读**它 —— `readDurationFromNote`）。
 * 保留的理由是"写"必须有对称的"擦除"能力：`writeDurationIntoNote` 一旦写进备注，
 * 用户唯一的清除手段就只剩手工删那一行 —— 而格式（前缀、全角冒号、
 * "N 分钟"）是这里定义的，让用户去猜等于把内部格式泄漏成用户负担。
 * 行为已由 `tests/duration-note.spec.ts` 钉住（含"写→擦→回到原文"的往返）。
 * **接线**（界面上给一个"清除 AI 估时"）属于界面层，不在本模块范围。
 */
export function removeDurationFromNote(note: string | undefined): string {
  if (note === undefined) return '';
  return note
    .split('\n')
    .filter((l) => !DURATION_LINE_PATTERN.test(l.trim()))
    .join('\n');
}
