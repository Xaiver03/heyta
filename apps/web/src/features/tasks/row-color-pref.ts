/**
 * 行着色三态（**只有清单图标着色**，产品拍板 2026-11-08）
 * ======================================================
 *
 * 产品负责人的原话：「只有清单图标着色，我确定是这样」。
 * 所以这里只有三档，没有"色条 / 淡底"那种选项 —— 着色**只发生在行首那枚图标上**。
 *
 * 纪律与 `due-display-pref.ts` / `theme.ts` 逐条相同：
 *
 * 1. **设备本地**（`localStorage`，不进 op-log）—— "我这台机器想怎么看着色"
 *    是界面选择，不是用户数据。判据：改它之后 op-log 条数不变
 *    （`apps/web/tests/row-color.spec.tsx`）。
 * 2. **永不抛**：隐私模式下 `localStorage` 读写都会抛，读失败退默认值、写失败静默。
 * 3. 非法值（手改存储 / 旧版本残留 / 将来删掉某一档）退回 `'project'`。
 */

/**
 * 三档：
 * - `project` 按清单（默认）—— 行首图标取该任务所属清单的色；
 * - `tag`     按标签 —— 取**第一个有效标签**的色（必须经 `resolveTagIds`）；
 * - `off`     关 —— **不渲染那枚图标节点**（不是 `opacity:0`、不是透明色）。
 */
export type RowColorMode = 'project' | 'tag' | 'off';

/** 存储键。🔴 只导出给判据用（测试要断言"改它不产生 op"），产品代码走下面两个函数。 */
export const ROW_COLOR_STORAGE_KEY = 'heyta.rowColor';

const MODES: readonly RowColorMode[] = ['project', 'tag', 'off'];

/** 默认档：按清单。理由与滴答一致 —— 用户先认"这条属于哪个清单"。 */
export const DEFAULT_ROW_COLOR_MODE: RowColorMode = 'project';

export function loadRowColorMode(): RowColorMode {
  try {
    const raw = localStorage.getItem(ROW_COLOR_STORAGE_KEY);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'string' && MODES.includes(parsed as RowColorMode)) {
        return parsed as RowColorMode;
      }
    }
  } catch {
    // 读失败 = 默认值，不崩。
  }
  return DEFAULT_ROW_COLOR_MODE;
}

export function saveRowColorMode(mode: RowColorMode): void {
  try {
    localStorage.setItem(ROW_COLOR_STORAGE_KEY, JSON.stringify(mode));
  } catch {
    // 写失败不影响本次生效（与 theme.ts 同）。
  }
}
