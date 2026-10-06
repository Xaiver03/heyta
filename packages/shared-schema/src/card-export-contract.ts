/**
 * 纪念卡片**成品图**的导出契约（W7）
 * ==================================
 *
 * 🔴 **这些数字为什么住在契约层而不是 UI 文件里** —— 与
 * `ACCOUNT_AVATAR_EDGE_PX` 同一条理由（见 `account-profile-contract.ts` 文件头）：
 * 「**数字**（边长、比例、允许的格式）是产品规格；**怎么把一张卡片变成那个形状**
 * 是平台调用，住各自的壳。」界面文件里写一个裸 `1080`，下次有人改 UI 时
 * 不会知道它是"规格"还是"随手试的数"。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ## 这一层管的是**成品图**，不是素材图（计划 §2.3）
 *
 * 「导出纪念卡片 = 在**用户自己的设备上**渲染出来的那张 PNG」：
 * 零上传、零新通道、零法务变更（L 系列那一张表一项都不触发 —— 没有任何字节出设备）。
 * 背景照片是**素材图**，要走客户端加密的对象存储通道（ADR-0044 §2.6 / 计划 §6），
 * 与本文件无关，也不许顺手加进来。
 *
 * ## 为什么是 1080 × 1440
 *
 * 推导链（不是随手取的）：
 *
 *   · **1080 宽**是中文社区竖版图文的通用位宽（小红书 / 公众号封面的导出宽度），
 *     低于它会在分享时被二次放大，高于它只是让文件变大。
 *   · **3 : 4** 是同一批平台里"竖版不裁切"的那一档（4:5 更窄、1:1 更方）。
 *     卡片要放下「名字 + 那个大数字 + 日期」三行，3:4 的高度够用且不必缩字。
 *   · 两边都是**规格**，所以这里存的是"比例的两个整数项"而不是一个 `1.3333` 的浮点 ——
 *     浮点比例在 `height = width * ratio` 里会让四端各算出不同的高度（`Math.round` 的
 *     时机不同），而导出图的尺寸是判据要数的东西。
 *
 * ## `EXPORT_CARD_REF_WIDTH_DP = 360` 是"成品图 = UI 的整数倍放大"这一裁决的分母
 *
 * 排版角色（`TEXT_STYLES`）、间距（`space.*`）、圆角（`radius.*`）**一律不重新发明**：
 * 成品图就是同一套 token 按 `EDGE_PX / REF_WIDTH_DP` 倍放大后画出来的。
 * 360 是 Android 设计基准里手机逻辑宽度的那一档（RN 的 dp 同一口径），
 * 也就是 `numeric-display` / `row-meta` 这些角色被设计出来时所在的那个宽度。
 *
 * 🔴 为什么宁可接受"整倍放大"也不给海报单独定一套字号：
 * 单独定 = 第二套排版事实源。它会漂，而且漂的表现是"预览好看、导出难看"
 * （或反过来），而那正是这一单要防的那类事故（AGENTS §3.5 的教训同型）。
 * 放大倍数是**一个**整数，它由上面那两个数推导，改边长时它会跟着变。
 */

/** 成品图的宽（px）。 */
export const EXPORT_CARD_EDGE_PX = 1080;

/** 成品图的比例：高 = 宽 × `ASPECT_H / ASPECT_W`。用两个整数而不是一个浮点数（见文件头）。 */
export const EXPORT_CARD_ASPECT_W = 3;
export const EXPORT_CARD_ASPECT_H = 4;

/** 放大基准：这些排版角色被设计出来时所对应的逻辑宽度（dp）。 */
export const EXPORT_CARD_REF_WIDTH_DP = 360;

/**
 * 成品图的高（px）。
 *
 * 🔴 **必须是整数**：`1080 × 4 / 3` 恰好整除，但公式在别的边长下不一定 ——
 * 而 `EXPORT_CARD_EDGE_PX` 是要改的（换一档分享尺寸）。用 `Math.round` 把这件事
 * 定死在一处：四端如果各自 `width * 4 / 3` 再各自取整，尺寸判据就会在某一端漂。
 */
export const EXPORT_CARD_HEIGHT_PX = Math.round(
  (EXPORT_CARD_EDGE_PX * EXPORT_CARD_ASPECT_H) / EXPORT_CARD_ASPECT_W,
);

/**
 * 排版与间距的放大倍率（= 边长 / 基准宽度）。
 *
 * ⚠️ 它是**推导出来的**，不是第三个规格数：改 `EXPORT_CARD_EDGE_PX` 或
 * `EXPORT_CARD_REF_WIDTH_DP` 都会带着它一起变。写成一个不透明的 `4` 就是
 * "预览一套、导出另一套"的那个 `4`。
 */
export const EXPORT_CARD_SCALE = EXPORT_CARD_EDGE_PX / EXPORT_CARD_REF_WIDTH_DP;

/** 成品图的内容类型（当前只有 PNG：无损、透明通道不需要、四端的栅格化通道都给得出）。 */
export const EXPORT_CARD_CONTENT_TYPE = 'image/png';

/**
 * 文件名里标题部分保留的最大码点数。
 *
 * 标题是用户自己的字，长度不可控；文件系统对单段名字有限制（255 字节是常见下限），
 * 而中文一个码点占 3 字节 ⇒ 上限按**码点**数而不是按 `.length`（UTF-16 长度），
 * 与 `ACCOUNT_DISPLAY_NAME_MAX_CODE_POINTS` 同一口径。
 */
export const EXPORT_CARD_FILE_STEM_MAX_CODE_POINTS = 48;

/**
 * 成品图的**像素尺寸对账**：栅格化之后必须回到这两个数之一。
 *
 * 判据用它，宿主不用它 —— 也就是说宿主**没有**地方可以把尺寸写错而还判绿。
 */
export interface ExportCardSize {
  readonly width: number;
  readonly height: number;
}

export const EXPORT_CARD_SIZE: ExportCardSize = {
  width: EXPORT_CARD_EDGE_PX,
  height: EXPORT_CARD_HEIGHT_PX,
};
