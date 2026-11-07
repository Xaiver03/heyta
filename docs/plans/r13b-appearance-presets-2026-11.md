# R13b · 外观：表面色系预设 + 自动深浅（2026-11-07）

> 上游：[ADR-0085](../adr/0085-appearance-is-device-local-and-never-an-op.md)（外观是设备属性、**零 op**）·
> [PRD](ticktick-parity-prd-2026-11.md) R13 · [R13a](r13a-settings-tree-2026-11.md)（分区已就位）。
> 本文只写**这一轮落了哪几维、判据怎么才会红、哪几维刻意没做**。

---

## 1. 这一轮落了什么

| 维度 | 落法 | 落点 |
|---|---|---|
| **表面色系预设** | `data-theme-preset`（`warm` / `mist`；`default` = **不写属性**） | `tokens.css` 两组块（亮 + 暗）× 2 预设 |
| **自动深浅（跟随系统）** | 三态 `light / dark / system`；`system` = **删键** | `lib/theme.ts` + `App.tsx` 的 `matchMedia` 订阅 |
| 明暗 | 原有 `data-theme`，这一轮补上"**真的跟随**系统变化" | `App.tsx` |

**主题 = 表面色系，明暗 = 那两套语义值。** 两者正交：同一个预设亮暗各一版，
预设**只覆盖表面色那一小组**，不动语义色（`primary` / `danger` / 四象限）——
那些是**意义**，不是外观。判据见 §3 第 3 条。

---

## 2. 为什么是"预设 + 自动深浅"，而不是"28 个主题 + 自定义"

- 取证给的形状是 16 个预览模板 × 运行时生成（[Windows 清单](../research/ticktick-windows-inventory-2026-11.md) §4），
  照抄那套等于把"模板生成器"当成事实源 —— 而我们没有那张生成器表。
- **自定义主题**（用户改一个色 → 生成 token 集）需要"新 token 集过 `check:design` + 逐对算对比度"，
  ADR-0085 §六 残余 4 已把"结构性皮肤"排在射程外。这一轮不碰。
- 预设的每一维都**能算判据**：表面换了，文字还得可读（见 §3）。

**加一个预设要同时改四处**（漏一处就有东西漂）：
`tokens.css` 亮/暗两组块 · `lib/theme.ts` 的 `THEME_PRESETS` · `tokens.spec.ts` 的 `PRESETS` · 两语言词条 `themePreset.<id>`。
第一处漏了 ⇒ 设置页有那个选项但界面不变；第二处漏了 ⇒ 选了没反应；
第三处漏了 ⇒ 没人算对比度；第四处漏了 ⇒ `check:ui-language` 红。

---

## 3. 判据（每条都要能红，附实测）

| # | 判据 | 怎么才会红 | 现量 |
|---|---|---|---|
| 1 | **零 op**：切明暗 / 换预设 ⇒ op-log 与实体条数不变 | 把外观写入改成 `dispatch(op)` ⇒ `theme-prefs.spec.tsx` 红 | ✅ 5 passed |
| 2 | **逐预设 × 逐明暗的真实对比度** | 把 `mist` 的 `background` 写成 `slate-200` ⇒ 三级文字降到 **3.86:1** ⇒ `tokens.spec.ts` 红 | ✅ 135 passed（实测踩过一次，见 §4） |
| 3 | 预设**不动语义色** | 在预设块里写 `--ht-color-primary` ⇒ `tokens.spec.ts` 的"primary 同值"红 | ✅ |
| 4 | 每个预设**都有暗版**，且亮暗表面不同值 | 删掉暗版块 ⇒ "亮暗同值"那条红 | ✅ |
| 5 | `default` = **删属性**，基准一个像素不变 | 把 `applyThemePreset('default')` 改成写 `"default"` ⇒ `theme-prefs.spec.tsx` 红 | ✅ |
| 6 | 「跟随系统」= **删键** | 改成存 `'system'` ⇒ `theme-prefs.spec.tsx` 的"删键"那条红 | ✅ |
| 7 | 新键按 **A 档**登记 | 不登记 `heyta.themePreset` ⇒ `check:persistence-keys` 断言 A 红 | ✅（源码 22 / 表 22） |

---

## 4. 落地时踩到的两件事（都记在这里，免得下一个人重踩）

1. **`mist` 第一版把三级文字压到 3.86:1。** 我把 `background` 设成 `slate-200`、`surface` 设成 `slate-100`，
   "看起来只深了一点点"，而浅灰字 `foreground-subtle` 恰好从 4.87 掉到 4.34 / 3.86 —— 跨过 4.5 的就是那一档。
   **修法不是调字色，是收表面**：现在 surface 用白、background 与它同值，青只留在**边框**上
   （边框不承担文字对比度）。这条也说明"表面色系"这种设计必须先算再选，不能凭眼睛。
2. **`extractVars(css, theme)` 不认预设块。** 预设块与 `[data-theme='dark']` 同特异性、靠文件顺序取胜，
   所以要验证"暖纸的暗版仍可读"，必须把三层（基准 → 明暗 → 预设）按真实层叠顺序合起来算。
   新增 `extractPresetVars(css, preset, theme)` 做这件事 —— 不要用两个 Map 分别看，那样看不到顺序问题。

---

## 5. 我知道但没做的

1. **字号档 / 密度 / 行着色三态 / 应用图标**：这一轮只落了"表面色系 + 自动深浅"。
   - 字号与密度要改的是**排印与间距 token 族**（`font-size.*` / `space.*` 的整套档位），
     与"预设只换表面"不是同一类改动，得单独设计；
   - 行着色三态读**清单色 / 标签色**，属于"读得多、写得零"（ADR-0085 §三.2），
     需要先在列表行里接上颜色读取点；
   - 应用图标在移动端是安装器级资源（ADR-0085 §六 残余 2），不在运行时范围。
2. **自定义主题**（用户改一个色生成 token 集）—— 见 §2，按 ADR 排在射程外。
3. **`TEXT_STYLES` 的 native 侧**：预设只改 CSS 变量，`packages/ui` 的 RN 组件走 `resolveHeytaUiTheme`，
   这一轮没有把"预设的表面色"喂给 RN 层 —— 也就是说**共享组件在 `warm`/`mist` 下仍是基准表面**。
   这是已知不一致，登记在这里；要修得先把预设的表面色并进 `HeytaUiTheme` 的输入。
