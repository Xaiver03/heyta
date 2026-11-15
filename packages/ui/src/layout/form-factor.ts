/**
 * 产品层级的**形态档** —— 一套判断，四个端共用。
 *
 * ## 为什么要有这一层
 *
 * 2026-11-15：移动端把四象限从单列改成 2×2 时，做法是给 `QuadrantScreen`
 * 写死 `twoColumns`。**那是硬编码，不是规则** ——
 * iPad、macOS、Windows 上同一个视图该几列，没有任何一处说了算，
 * 将来每加一个端就要再抄一遍判断。
 *
 * 这里把"这个视图在哪里、有多大、该用哪种形态"收成一处：
 * 各端只报**可用宽度**，档位与列数由这条规则推导。
 *
 * ## 为什么用「档」而不是像素断点
 *
 * 像素断点（`min-width: 768px`）在不同设备上是**不同的物理尺度**：
 * 手机横屏 768px、iPad 竖屏 768px、Mac 窗口 768px 是三件不同的事。
 * 所以这里不比"窗口多宽"，比的是**能放下几列基准宽度**。
 *
 * 基准宽度取 `mobile` 那一档（360dp）—— 它是一列的最小合理宽度，
 * 也是手机上实际跑的那个尺寸。
 *
 * ## 档位
 *
 * | 档 | 可放列数 | 典型 |
 * |---|---|---|
 * | `compact` | 1 | 手机竖屏 |
 * | `regular` | 2 | 手机横屏、iPad 竖屏、窄窗口 |
 * | `expanded` | ≥3 | iPad 横屏、Mac / Windows 大窗口 |
 */

/** 排版形态档。三档足以覆盖手机 / 平板 / 桌面，再加档要先有真实视图需要它。 */
export type FormFactor = 'compact' | 'regular' | 'expanded';

/**
 * 一列的基准宽度（dp）。取手机竖屏的视口宽 ——
 * 它是一张卡片/一列内容在任何端上**可读**的最小宽度。
 */
export const COLUMN_BASE_WIDTH = 360;

/**
 * 由可用宽度推出形态档。
 *
 * @param availableWidth 视图可用宽度（dp）。由各端自己报：
 *        移动端用 `onLayout` 的 `nativeEvent.layout.width`，
 *        web / 桌面用容器的 `clientWidth`。
 *        🔴 **不要传 `Dimensions.get('window').width`** —— 那是物理屏宽，
 *        在桌面上永远 ≥ 断点，"响应式"就成了摆设（本条在
 *        `QuadrantBoard.tsx` 的 props 注释里也记过一次实测）。
 */
export function formFactorOf(availableWidth: number): FormFactor {
  // 宽度未知（0 / NaN / 负数）时按最保守的一档处理：宁可少排一列，不要挤出屏幕。
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) return 'compact';
  const columns = Math.floor(availableWidth / COLUMN_BASE_WIDTH);
  if (columns <= 1) return 'compact';
  if (columns === 2) return 'regular';
  return 'expanded';
}

/**
 * 某一档下，一个视图最多排几列。
 *
 * 🔴 **这是"最多"，不是"必须"** —— 具体视图仍可自己收窄
 * （例如四象限固定 2 列：3 列以上没有第 5、6 个象限可放）。
 */
export function maxColumnsOf(formFactor: FormFactor): number {
  switch (formFactor) {
    case 'compact':
      return 1;
    case 'regular':
      return 2;
    case 'expanded':
      return 3;
  }
}


/**
 * 一个视图**最少要多少宽**才值得并排两列。
 *
 * 与 `COLUMN_BASE_WIDTH` 不同：那个是"一列内容的可读宽度"，
 * 这个回答的是"两块并排还读不读得出字"。
 *
 * 四象限就是典型：它**默认就该是 2×2**（艾森豪威尔矩阵的意义在并置对比），
 * 所以判断不是"宽了才并排"，而是"**窄到读不出字才退回单列**"。
 * 360dp 手机两列各 165dp —— 放得下「马上做 / 重要且紧急」；
 * 低于 300dp 时每格不足 150dp，退回单列比挤成两列可读。
 */
export const TWO_COLUMN_MIN_WIDTH = 300;

/** 这一块宽度够不够并排两列（`<= 0` 表示还没量到，按"够"处理，避免首帧闪一下单列）。 */
export function canPairColumns(availableWidth: number): boolean {
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) return true;
  return availableWidth >= TWO_COLUMN_MIN_WIDTH;
}
