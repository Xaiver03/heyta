# 暗色主题 token 审计 —— 语义层里该回指却写成字面的 46 枚

**范围**：`packages/design-system/src/tokens.css` 的 `[data-theme='dark']` 块（`:697-809`），口径是 `--ht-color-*` 这一族 66 枚语义变量。
**动因**：[`ticktick-design-parity.md`](../ticktick-design-parity.md) 差距 **3.3** —— 亮色侧把「语义名 → 原色阶」写成全派生，暗色侧同一批变量却自己抄了色值，两头不一致，且**与竞品无关**（原文件 §6-1）。**本文不改 `tokens.css`，只做逐枚对账。**

---

## 1. 先统计（命令与读数）

命令在仓库根跑，行号指本仓当前树。

```bash
# 暗色语义色总量
rg -n '^[[:space:]]*--ht-color-[a-z0-9-]+:' packages/design-system/src/tokens.css
#   → 亮色块 103-226 命中 66 枚；暗色块 698-789 命中 66 枚（一一对应，无缺覆盖）

# 裸 hex
rg -n '^[[:space:]]*--ht-[a-z0-9-]+:[[:space:]]*#[0-9a-fA-F]{3,8};' packages/design-system/src/tokens.css
#   → 全文件 78 处：45 处在原色阶定义区 19-94（那是**该写 hex 的地方**），33 处落在暗色块

# rgb()
rg -n '^[[:space:]]*--ht-[a-z0-9-]+:[[:space:]]*rgb\(' packages/design-system/src/tokens.css
#   → 全文件 28 处：暗色块 20 处（--ht-color-* 13 + --ht-material-* 7），
#     另 --ht-shadow-* 5 枚暗色覆盖的 rgb() 不以 rgb 开头、不被该式命中
```

**读数**：暗色 66 枚语义色里 **46 枚是字面值（70%）= 33 裸 hex + 13 rgb()**，只剩 20 枚走 `var()`。
把这 46 枚**去重**：**30 个不同的色值**（23 个 hex + 7 个 rgb 三元组），即 **16 处是同值重复抄写**。
拿这 30 个值去比对原色阶 `:19-94`：**21 个 hex 值原色阶里根本没有**，
**9 个能命中**（hex 侧 2 个：`#1e3a8a`=blue-900、`#1d4ed8`=blue-700；
rgb 侧 7 个三元组**全部**命中已有原色阶：blue-600 / slate-950 / slate-400 / emerald-600 / amber-600 / red-600 / sky-600）。

> ⚠️ **对 3.3 的三处订正**（原读数偏保守或偏大）：
> ① 亮色侧**不是**「0 枚字面」—— `--ht-color-overlay` 是 `rgb(15 23 42 / 0.5)`（`:125`），
> 亮色 66 枚 = **65 var + 1 rgb**，裸 hex 才是 0。
> ② 「21 个色值在原色阶之外」只对 **hex 侧**成立；rgb 侧那 13 枚恰恰是**最该修也最好修**的一批。
> ③ 「仅 2 枚能回指 `blue-700/800`」应为 **`blue-900` 与 `blue-700`**（`heat-1` / `heat-2`）——
> `blue-800` 是 `#1e40af`，暗色块里没出现过。

---

## 2. 逐枚清单

「亮色侧写法」= 同一个 token 在 `:101-227` 的语义写法，也就是暗色侧**本该照抄的形状**。

### A. 暗色表面与中性族（8 枚裸 hex —— 原色阶里**一个都没有**）

| token | 暗色当前值 | 亮色侧写法 | 应回指 |
|---|---|---|---|
| `--ht-color-surface` | `#0d1526` | `var(--ht-white)` | **原色阶无此色** |
| `--ht-color-surface-subtle` | `#101a2e` | `var(--ht-slate-50)` | **原色阶无此色** |
| `--ht-color-surface-raised` | `#131e33` | `var(--ht-white)` | **原色阶无此色** |
| `--ht-color-surface-sunken` | `#080e1a` | `var(--ht-slate-100)` | **原色阶无此色** |
| `--ht-color-border` | `#1e2b45` | `var(--ht-slate-200)` | **原色阶无此色** |
| `--ht-color-border-strong` | `#2b3b5c` | `var(--ht-slate-300)` | **原色阶无此色** |
| `--ht-color-border-subtle` | `#16203a` | `var(--ht-slate-100)` | **原色阶无此色** |
| `--ht-color-disabled-bg` | `#16203a` | `var(--ht-slate-100)` | **原色阶无此色**；与 `border-subtle`、`heat-0` 三处同值 |

### B. 状态色「提亮档」（8 枚裸 hex —— 都是各族 300/400 级，而原色阶只登记了 50/600/700）

| token | 暗色当前值 | 亮色侧写法 | 应回指 |
|---|---|---|---|
| `--ht-color-success` | `#34d399` | `var(--ht-emerald-600)` | **原色阶无此色**（emerald-400） |
| `--ht-color-success-strong` | `#6ee7b7` | `var(--ht-emerald-700)` | **原色阶无此色**（emerald-300） |
| `--ht-color-warning` | `#fbbf24` | `var(--ht-amber-600)` | **原色阶无此色**（amber-400） |
| `--ht-color-warning-strong` | `#fcd34d` | `var(--ht-amber-700)` | **原色阶无此色**（amber-300） |
| `--ht-color-danger` | `#f87171` | `var(--ht-red-600)` | **原色阶无此色**（red-400） |
| `--ht-color-danger-strong` | `#fca5a5` | `var(--ht-red-700)` | **原色阶无此色**（red-300） |
| `--ht-color-info` | `#38bdf8` | `var(--ht-sky-600)` | **原色阶无此色**（sky-400） |
| `--ht-color-info-strong` | `#7dd3fc` | `var(--ht-sky-700)` | **原色阶无此色**（sky-300） |

### C. alpha 洗色（13 枚 `rgb()` —— 三元组**全部**命中已有原色阶，只差一个引用写法）

| token | 暗色当前值 | 亮色侧写法 | 应回指 |
|---|---|---|---|
| `--ht-color-primary-subtle` | `rgb(37 99 235 / 0.16)` | `var(--ht-blue-50)` | `--ht-blue-600` |
| `--ht-color-primary-subtle-hover` | `rgb(37 99 235 / 0.24)` | `var(--ht-blue-100)` | `--ht-blue-600` |
| `--ht-color-overlay` | `rgb(2 6 23 / 0.7)` | `rgb(15 23 42 / 0.5)` ← 亮色同样是字面 | `--ht-slate-950`（亮色侧对 `--ht-slate-900`） |
| `--ht-color-hover` | `rgb(148 163 184 / 0.12)` | `var(--ht-slate-100)` | `--ht-slate-400` |
| `--ht-color-active` | `rgb(148 163 184 / 0.2)` | `var(--ht-slate-200)` | `--ht-slate-400` |
| `--ht-color-success-subtle` | `rgb(5 150 105 / 0.16)` | `var(--ht-emerald-50)` | `--ht-emerald-600` |
| `--ht-color-warning-subtle` | `rgb(217 119 6 / 0.16)` | `var(--ht-amber-50)` | `--ht-amber-600` |
| `--ht-color-danger-subtle` | `rgb(220 38 38 / 0.16)` | `var(--ht-red-50)` | `--ht-red-600` |
| `--ht-color-info-subtle` | `rgb(2 132 199 / 0.16)` | `var(--ht-sky-50)` | `--ht-sky-600` |
| `--ht-color-quadrant-1-subtle` | `rgb(220 38 38 / 0.16)` | `var(--ht-red-50)` | `--ht-red-600`；🔴 与 `danger-subtle` 逐字节同值 |
| `--ht-color-quadrant-2-subtle` | `rgb(37 99 235 / 0.16)` | `var(--ht-blue-50)` | `--ht-blue-600`；🔴 与 `primary-subtle` 同值 |
| `--ht-color-quadrant-3-subtle` | `rgb(217 119 6 / 0.16)` | `var(--ht-amber-50)` | `--ht-amber-600`；🔴 与 `warning-subtle` 同值 |
| `--ht-color-quadrant-4-subtle` | `rgb(148 163 184 / 0.14)` | `var(--ht-slate-100)` | `--ht-slate-400`；⚠️ `0.14` 与 `hover 0.12 / active 0.2` **都不同**，看着像复用其实是一档独立取值 |

### D. 功能色板（17 枚裸 hex —— 13 处是别的 token 的复读，2 处能回指，2 处**色相族漂移**）

| token | 暗色当前值 | 亮色侧写法 | 应回指 |
|---|---|---|---|
| `--ht-color-quadrant-1` | `#f87171` | `var(--ht-red-600)` | **原色阶无此色**；🔴 值 == `--ht-color-danger`，应改引语义层 |
| `--ht-color-quadrant-3` | `#fbbf24` | `var(--ht-amber-700)` | **原色阶无此色**；🔴 值 == `--ht-color-warning` |
| `--ht-color-category-1` | `#f87171` | `var(--ht-red-800)` | **原色阶无此色**（red-400）；⚠️ 暗色下与 `danger` 撞值，亮色下不撞 |
| `--ht-color-category-2` | `#fb923c` | `var(--ht-orange-600)` | **原色阶无此色**（orange-400） |
| `--ht-color-category-3` | `#34d399` | `var(--ht-green-600)` | **原色阶无此色**；🔴 值是 **emerald**-400，槽位却是 **green** 族 —— 违反 `:764-767`「与亮色同色系」的承诺 |
| `--ht-color-category-4` | `#99f6e4` | `var(--ht-teal-600)` | **原色阶无此色**（teal-200） |
| `--ht-color-category-5` | `#22d3ee` | `var(--ht-cyan-700)` | **原色阶无此色**（cyan-400） |
| `--ht-color-category-6` | `#6366f1` | `var(--ht-blue-700)` | **原色阶无此色**；🔴 值是 **indigo**-500，槽位是 **blue** 族（`blue-400` 是 `#60a5fa`，不是这个） |
| `--ht-color-category-7` | `#e879f9` | `var(--ht-fuchsia-700)` | **原色阶无此色**（fuchsia-400） |
| `--ht-color-category-8` | `#f472b6` | `var(--ht-pink-700)` | **原色阶无此色**（pink-400） |
| `--ht-color-priority-high` | `#f87171` | `var(--ht-red-600)` | **原色阶无此色**；🔴 值 == `--ht-color-danger`（`#f87171` 在暗色块出现 **4 次**） |
| `--ht-color-priority-medium` | `#fbbf24` | `var(--ht-amber-700)` | **原色阶无此色**；🔴 值 == `--ht-color-warning`（出现 3 次） |
| `--ht-color-priority-low` | `#38bdf8` | `var(--ht-sky-600)` | **原色阶无此色**；🔴 值 == `--ht-color-info` |
| `--ht-color-heat-0` | `#16203a` | `var(--ht-slate-100)` | **原色阶无此色**；与 `border-subtle`、`disabled-bg` 同值 |
| `--ht-color-heat-1` | `#1e3a8a` | `var(--ht-blue-200)` | ✅ **有** → `var(--ht-blue-900)` |
| `--ht-color-heat-2` | `#1d4ed8` | `var(--ht-blue-300)` | ✅ **有** → `var(--ht-blue-700)` |
| `--ht-color-focus-break` | `#34d399` | `var(--ht-emerald-600)` | **原色阶无此色**；🔴 值 == `--ht-color-success`（出现 3 次） |

**合计**：A8 + B8 + C13 + D17 = **46 枚**，与第 1 节读数一致。其中 **16 枚是「同一个已存在的语义 token 被重新抄了一遍色值」**（D 的 quadrant×2 / priority×3 / focus-break + C 的 quadrant-1/2/3-subtle 等，逐行标注见上），**2 枚能直接回指原色阶**（heat-1/2），**2 枚是色相族漂移**（category-3 green→emerald、category-6 blue→indigo）。

---

## 3. 三条修法建议

**① 可以批量替换的一类 —— 「同值复读」16 枚 + `heat-1/2` 2 枚。**
这 18 枚的改动**一个像素都不动**：`#f87171` 在暗色块出现 4 次且四次都该是同一个语义答案，
所以 `quadrant-1` / `priority-high` 写成 `var(--ht-color-danger)`、
`focus-break` 写成 `var(--ht-color-success)`、`quadrant-N-subtle` 写成对应 `*-subtle`，
`heat-1/2` 写成 `var(--ht-blue-900/700)`。
可验证性来自它**必然能失败**：改前后各生成一次 `generated/tokens.native.ts`
并逐字节比对，不同即说明某枚的解析值被改动了。⚠️ 唯一要留手的是 `quadrant-4-subtle` 的 `0.14`
（第 16 枚不是复读，别顺手并进 `hover`）。

**② 必须先加 token 的一类 —— 21 个「原色阶无此色」的值（A 族 8 + B 族 8 + C 之外的 D 族 5 + 分类 6，去重后 21）。**
这一类**不可能批量替换**，因为 `var()` 的右边压根不存在：原色阶只登记了
red/amber/emerald/sky 的 **50/600/700** 三档，没有 300/400；也没有任何一档暗色蓝调中性面。
要补的是**一族**而不是一枚：a) 暗色表面/边框族 7 个值（`#080e1a … #2b3b5c`，
建议独立成一阶 `--ht-ink-*`，别硬塞进 slate —— 它们是带蓝调的，注释 `:799` 已在说这件事）；
b) `emerald/amber/red/sky` 的 300 与 400 共 8 档；c) `orange-400 / teal-200 / cyan-400 /
fuchsia-400 / pink-400 / indigo-500` 6 档分类暗色阶。
⚠️ 分类那 8 枚受色盲可辨识度约束、**是一组不能单改**（见 `:60-64` 与 `:208-214` 的警告），
必须整族搬；且 `category-3`/`category-6` 的族漂移要在补阶时一并决定
「是改暗色值回到 green/blue，还是改注释承认跨族」—— 这是产品判断，不是文本替换。

**③ 其实是刻意例外的一类 —— 需要 alpha 的 `rgb()`（C 族 13 枚 + `overlay` + 材质 7 枚 + 阴影 5 枚）。**
「色阶 + 不透明度」在 CSS 里只有 `rgb()` 与 `color-mix()` 两种写法，
`var(--ht-blue-600)` 单独表达不了 0.16 —— 所以这批**不是没想到要引用，是当时没有可用的写法**。
不要把它们和第 A/B/D 类混在一次提交里改：改动会连带动两个下游 ——
`generate.ts`/native 侧现在把 `rgb(13 21 38 / 0.72)` 展平成 `#0d1526b8`
（`generated/tokens.native.ts:708-712`），`color-mix()` 展不展得开是另一回事；
`AA_PAIRS`/`GRAPHIC_PAIRS` 的 var 递归展开器（`tokens.ts:442-522`，注释里写明「真实计算每一对」）
也要能解析新写法。
两个可行终点，选一个：**要么**先给解析器补 `color-mix` 分支、再把 C 族整批改成
`color-mix(in srgb, var(--ht-blue-600) 16%, transparent)`（从此真正回指南色阶）；
**要么**承认它是登记过的例外，在 `check:design` 里写死一条窄许可
「语义层只允许 `rgb( + 已登记原色阶三元组 + 透明度`」，让剩下 21 个无主值继续判红。
🔴 反过来，`on-primary` / `on-danger` 用 `var(--ht-slate-950)` 而不是白
（`:705`、`:748`，附实测 2.77:1 vs 7.29:1）**已经是 var() 派生、也确实是刻意的暗色不反相**，
不在本文的"该修"清单里 —— 列出来是为了防止有人批量替换时把它们"顺手改回白色"。

---

## 4. 本文没核到的

- `packages/design-system/tests/`（`tokens.spec.ts`、`category-colors.spec.ts`）**在本工作副本里不存在**，只在注释与 `.run-logs/` 里被引用 ⇒「对比度与色盲门禁是否覆盖暗色块」本文**不下结论**。
- 逐枚改动后的对比度现量：本文只做**回指关系**对账，没重算任何一对 AA 值。
- `#6366f1`→indigo-500、`#34d399`→emerald-400 这类**族名**按 Tailwind 取值表比对得出（本仓原色阶是该族子集），仅用于定位，不是本仓登记过的名字。
