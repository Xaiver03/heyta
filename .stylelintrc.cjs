/**
 * CSS 静态规范（stylelint）—— 第一批：**零容忍、存量小、判据确定**的六条。
 * ==========================================================================
 *
 * ## 为什么要有这一层（与既有门禁的分工）
 *
 * 仓里已有的 CSS 相关门禁管的是**设计纪律**：
 *   · `check:design` —— 不许裸 hex / px / ms / z-index（token 纪律）
 *   · `check:control-semantics` —— 四档色调配方只在中央 CSS 一处
 *   · `check:row-single-source` —— `ht-*` 前缀族只减不增
 *   · `check:l4-no-style` —— L4 视图不许内联样式
 *
 * 它们**都不管 CSS 本身对不对**。实测（2026-11-23）：15 个文件里同一个选择器写了
 * 两遍甚至三遍，后一条静默覆盖前一条 —— 这类问题没有任何一层会报，而它恰好是
 * 「改了没生效」最常见的原因。这一层补的就是这个缺口。
 *
 * ## 为什么第一批只有六条
 *
 * 教训写在 `AGENTS.md` §7 元规则 2 与 `check-traps-index-coverage` 的文件头：
 * **一条会大量误报的门禁会教人忽略红色**。所以第一批只收「判据唯一、几乎不可能误报、
 * 存量可控」的六条；`declaration-strict-value`（强制颜色必须走 token）这类存量大的
 * 放第二批 —— 它会先把这条链接变成一堵红墙。
 *
 * ## 🔴 刻意**不继承** `stylelint-config-standard`
 *
 * 试过：它一共报 **477 条**，其中 444 条是 `rule-empty-line-before` /
 * `comment-empty-line-before` 这类**格式**偏好。那正是"一堵没人会读的红墙"——
 * 本仓的 CSS 有自己成文的排版口径，不该被另一套格式规则整批改写。
 * 所以这里只留**判据唯一、与格式无关**的六条；格式不进这道门禁。
 *
 * ## 已显式关闭的两条（不是忘了）
 *
 *   · `no-descending-specificity`：存量极多，且它的正确修法常与"级联顺序可读性"
 *     冲突（本仓 `app.css` 显式维护级联顺序）。开它等于制造一堵没人会读的红墙。
 *   · `selector-class-pattern`：`ht-*` / `hta-*` 两套前缀兼 BEM 变体，强行统一命名
 *     会与 `check:row-single-source` 的族账本打架。命名纪律归那道门禁，不在这里。
 */
module.exports = {
  ignoreFiles: [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/coverage/**',
    // 生成物：`packages/design-system/generated/**` 由生成器产出，改它没用。
    'packages/design-system/generated/**',
  ],

  /* 例外：**设计 token 文件是"产地"**，不是消费点。
     · 它按分区反复打开 `:root`（颜色 / 尺寸 / 动效 / 材质各一段），这是 token 文件的
       正常组织方式，合并成一整段会让 1000+ 行无从定位；
     · `0px` 在它里面是**刻意带单位**的（要拼进 `blur()` / 长度上下文），改 `0` 属于
       另一种写法，不是修 bug。
     消费侧的同样两条照旧生效。 */
  overrides: [
    {
      files: ['packages/design-system/src/tokens.css'],
      rules: {
        'no-duplicate-selectors': null,
        'length-zero-no-unit': null,
      },
    },
  ],

  rules: {
    /* ── 第一批六条：零容忍 ─────────────────────────────────── */

    // 1. 同一文件里同一选择器写两遍 ⇒ 后一条静默覆盖前一条。存量 15 个文件。
    'no-duplicate-selectors': true,

    // 2. 同一规则块里同一属性声明两遍（`color` 写两次）。
    'declaration-block-no-duplicate-properties': [
      true,
      { ignore: ['consecutive-duplicates-with-different-syntaxes'] },
    ],

    // 3. `margin: 0 0 0 0` 这类可折叠的简写。
    'shorthand-property-no-redundant-values': true,

    // 4. `#GGG` / `#12345` 这类非法色值（浏览器直接丢弃，界面上是"没生效"）。
    'color-no-invalid-hex': true,

    // 5. `0px` / `0rem`（零值不需要单位）。
    'length-zero-no-unit': true,

    // 6. 空规则块（`{}`）—— 多半是删声明时留下的残骸。
    'block-no-empty': true,

    /* ── 第二批：正确性规则（判据唯一、非格式、实测存量已归零）─────────────
     * 这批的共同点：**今天存量全是 0**（2026-11-23 逐条量过），
     * 加进来纯粹是防回潮 —— 零成本，且每条都对应一种真实事故：
     *   · `//` 在 CSS 里不是注释，它会把该行后面的声明一起吃掉（且不报错）；
     *   · 先写 longhand 再写 shorthand，前者会被静默覆盖（"改了没生效"）；
     *   · 同一 @import 写两遍；
     *   · `font-family: A, A`；
     *   · keyframes 里的 `!important` 被规范忽略（写了等于没写，还误导人）；
     *   · 未知单位 / 未知属性 / 未知 @规则 / 未知媒体特性 / 未知伪类 —— 拼错即静默失效。
     */
    'no-invalid-double-slash-comments': true,
    'declaration-block-no-shorthand-property-overrides': true,
    'no-duplicate-at-import-rules': true,
    'font-family-no-duplicate-names': true,
    'keyframe-declaration-no-important': true,
    'unit-no-unknown': true,
    'property-no-unknown': [true, { ignoreProperties: ['container', 'container-type', 'container-name'] }],
    'at-rule-no-unknown': [true, { ignoreAtRules: ['container', 'layer', 'property'] }],
    'media-feature-name-no-unknown': true,
    'selector-pseudo-class-no-unknown': [true, { ignorePseudoClasses: ['global', 'local'] }],
    'function-no-unknown': [true, { ignoreFunctions: ['theme', 'env', 'constant'] }],

    /* ── 第三批：语义/取值合法性（实测存量全 0）─────────────────────────
     * `declaration-property-value-no-unknown` 是最有价值的一条：它按 CSS 语法校验
     * **属性与值的组合**，能抓到 `display: flexx`、`align-items: centerr`、
     * `gap: 4` 这类"拼错即静默不生效"的错（本仓手写 CSS 上千行，正是高发区）。
     * 其余几条同理：媒体查询语法、伪元素/元素选择器、`@counter-style` 之外的
     * annotation、`var()` 缺失、空注释/空文件。
     */
    'declaration-property-value-no-unknown': true,
    'media-query-no-invalid': true,
    'selector-pseudo-element-no-unknown': true,
    'selector-type-no-unknown': true,
    'selector-anb-no-unmatchable': true,
    'annotation-no-unknown': true,
    'custom-property-no-missing-var-function': true,
    'comment-no-empty': true,
    'no-empty-source': true,

    /* ── 明确关闭：理由见文件头 ───────────────────────────────── */

    'no-descending-specificity': null,
    'selector-class-pattern': null,
  },
};
