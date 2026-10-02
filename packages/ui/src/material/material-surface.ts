/**
 * 玻璃材质表面 —— 端能力协商的**唯一合法居所**（ADR-0042 §4）
 * ==============================================================
 *
 * 设计系统把「玻璃」定义成**两半**：
 *   - 半透明 tint（`material.*-tint`，token 已生成到全部原生端）；
 *   - `backdrop-filter: blur() saturate()`（只在 CSS 里合法，RN 没有这个属性）。
 *
 * 两半缺一不可 —— 没有模糊时，tint 就是一张贴着内容的磨砂纸：底下的字会
 * **穿过卡片**出现在前景上，对比度取决于「下面恰好排了什么字」，于是它不再是
 * 材质，而是一个随机数发生器。2026-10-01 在 Android 模拟器上实测到的正是这个
 * 形状（`screencap` 留档）：浮层卡片半透明，压住顶栏图标与大号日期标题，
 * 「关闭」的 ✕ 与底下那个同步图标**重叠成同一个字形**。
 *
 * 🔴 判据是「这一端有没有背景模糊」，不是「是不是 web」：
 * `backdrop-filter` 是 CSS 属性，只有渲染到 CSS 里的那一端有（与 shadow /
 * cubic-bezier 同一类划分）。本层据此分支；**业务组件不得散写
 * `Platform.OS` 分叉** —— 分叉只允许住在这里（ADR-0042）。
 *
 * 档位（ADR-0042 逐面裁决表）：
 *   - `chrome`：导航条 / 标签栏 / 命令面板 —— 最透，内容从下面滚过。
 *     🔴 只承载主前景色：muted 文字在它上面过不了「tint × 最坏背景」
 *     的 4.5:1（见 design-system 的 tokens.spec），文字密集的面用 panel/sheet。
 *   - `panel`：菜单 / 下拉 / 小浮层 —— 比 chrome 厚一点（承载密集文字）。
 *   - `sheet`：底部面板 / 表单 —— 最厚。
 *
 * 顶边高光（`material.edge-highlight`）是配方的一部分：亮色下它是
 * 「光打在材料上」，没有它半透明面像「没画完」。无 blur 端退化为普通
 * 边框色（`color.border`）—— 不透明面需要的是分隔线，不是光。
 *
 * web 的另一半（blur + 饱和度提升 + 全边框 rim）在宿主 CSS：
 * `apps/web/src/styles/app.css` 的 `.ht-material`（两个渲染世界、同一配方）。
 */

import type { HeytaNativeTokens } from '@heyta/design-system';

/** 材质档位。取值与 tokens.css §3d 的 `material.*-tint` 一一对应。 */
export type MaterialTier = 'chrome' | 'panel' | 'sheet';

/** 一个材质表面的全部视觉决定（RN View 可直接展开）。 */
export interface MaterialSurfaceStyle {
  readonly backgroundColor: string;
  /** 发丝级 rim：web 玻璃 = 边缘高光（光打在材料上）；无 blur 端 = 分隔线。 */
  readonly borderWidth: number;
  readonly borderColor: string;
}

/** 本抽象需要的 token 子集（Pick 而不是整表：消费面越窄，耦合越真）。 */
export type MaterialTokens = Pick<
  HeytaNativeTokens,
  | 'material.chrome-tint'
  | 'material.panel-tint'
  | 'material.sheet-tint'
  | 'material.edge-highlight'
  | 'color.surface-raised'
  | 'color.border'
  | 'border-width.thin'
>;

const TINT_OF: Record<MaterialTier, keyof MaterialTokens> = {
  chrome: 'material.chrome-tint',
  panel: 'material.panel-tint',
  sheet: 'material.sheet-tint',
};

/**
 * 按档位与端能力解析材质表面。
 *
 * @param tier          材质档位（见文件头的档位表）。
 * @param hasBackdropBlur 这一端能不能真的模糊背景（web/RN-web=true，RN 原生=false）。
 *   不能时**不降级成假半透明**，而是换成不透明的 `surface-raised`：
 *   「宁可诚实不透明，不要假装半透明」。
 */
export function materialSurface(
  tokens: MaterialTokens,
  tier: MaterialTier,
  hasBackdropBlur: boolean,
): MaterialSurfaceStyle {
  if (hasBackdropBlur) {
    return {
      backgroundColor: tokens[TINT_OF[tier]] as string,
      borderWidth: tokens['border-width.thin'],
      borderColor: tokens['material.edge-highlight'],
    };
  }
  return {
    backgroundColor: tokens['color.surface-raised'],
    borderWidth: tokens['border-width.thin'],
    borderColor: tokens['color.border'],
  };
}
