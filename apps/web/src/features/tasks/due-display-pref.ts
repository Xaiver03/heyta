/**
 * 截止时间显示方式的**设备本地**偏好。
 * =====================================================
 *
 * 2026-09-30 从任务页头搬进设置（产品负责人：页头上两个光秃秃的
 * 「日期 | 倒计时」用户根本不知道是什么）。搬完的三条纪律：
 *
 * 1. **设备本地**（`localStorage`，不进 op-log）—— 与功能模块开关
 *    （`features/shell/modules.ts`）同一条推理："这台设备上我想怎么看
 *    截止时间"是界面选择，不是用户数据。
 * 2. **永不抛**：隐私模式下 `localStorage` 会抛，读失败退默认值、
 *    写失败静默（与 `theme.ts` 同一契约）。
 * 3. 非法值（将来手改存储 / 旧版本残留）退回 `'date'`。
 */

import type { DueDisplayMode } from './DueBadge.js';

const KEY = 'heyta.dueDisplay';
const MODES: readonly DueDisplayMode[] = ['date', 'countdown'];

export function loadDueDisplay(): DueDisplayMode {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'string' && MODES.includes(parsed as DueDisplayMode)) {
        return parsed as DueDisplayMode;
      }
    }
  } catch {
    // 读失败 = 默认值，不崩。
  }
  return 'date';
}

export function saveDueDisplay(mode: DueDisplayMode): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(mode));
  } catch {
    // 写失败不影响本次生效（与 theme.ts 同）。
  }
}
