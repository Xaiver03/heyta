/**
 * 「hey.」品牌字标。
 *
 * 为什么内联成组件、而不是 <img src="/hey.svg">：
 *   1. **跟随主题**。静态 SVG 里的色值是烘死的，暗色下 blue-600 压在深底上会发闷。
 *      用 currentColor + 父级给的语义 token，亮色走 blue-600、暗色自动走 blue-400。
 *   2. 少一次网络请求，且能用 CSS token 控制尺寸，不写死像素值。
 *
 * 为什么不用渐变（曾经有一份带渐变的 `public/hey.svg`）：
 *   CSS var() 在 SVG **表现属性**里不生效（表现属性不参与变量替换），
 *   要渐变就得写死色值 —— 那正是 check:design 要拦的东西。
 *   而且导航里字标只有 24px 高，渐变在这个尺寸上根本看不出来。
 *
 * 🔴 `public/hey.svg` **已经删除**（2026-09-27）。
 *   它当时是同一套几何（262×144）的第二份拷贝，只有注释里的一个"⚠️ 改一个
 *   务必改另一个"在维系一致性 —— 那不是约束，是祈祷。**两份几何一定会漂移**，
 *   而且它没有任何使用者（favicon 是另一个文件，`index.html` 不引用它）。
 *   将来若真的需要一份静态 SVG（比如 `og:image`），**从本组件导出**，
 *   不要再手抄一份路径数据。
 */
export function BrandMark() {
  return (
    <svg className="lp-brand__mark" viewBox="0 0 262 144" aria-hidden="true" focusable="false">
      {/* h：竖干 + 半径 19 的半圆肩；e：横杠 + 逆时针扫 290° 收笔（开口要大于端帽，否则读成 θ）；
          y：两笔斜线收到 (185,96)，右笔顺势下探勾回；末尾圆点是品牌句点，坐在基线上。 */}
      <path
        d="M32 22V100 M32 81a19 19 0 0 1 38 0V100 M99 81h38a19 19 0 1 0-12.5 17.85 M166 62l19 34 M204 62l-19 34 M185 96q0 26-18 26"
        fill="none"
        stroke="currentColor"
        strokeWidth={16}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={230} cy={92} r={8} fill="currentColor" />
    </svg>
  );
}
