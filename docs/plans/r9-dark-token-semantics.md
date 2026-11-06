# R9 暗色主题语义化 —— 处置、改动与判据

**范围**：`packages/design-system/src/tokens.css` 的 `[data-theme='dark']` 块（改动前 `:697-809`，改动后 `:751-882`）里的 66 枚 `--ht-color-*` 语义变量。
**输入**：[`docs/research/decisions/dark-theme-token-audit.md`](../research/decisions/dark-theme-token-audit.md)（清单，本文 §1 是它的复跑与对账）。
**边界**：只动 `tokens.css` 与 `generated/`，不动任何组件／app 文件；不新增依赖；不 commit。
**硬约束**：**零像素变更** —— 每一枚 token 的解析值前后必须逐字节相同（判据见 §4 ④）。

---

## 0. 结论与数字对照表

暗色块的字面值 **46 枚 → 13 枚**，其中 **裸 hex 33 → 0**。剩下的 13 枚是需要登记的 alpha 例外（§2.4），
不是漏掉的活。**代价**：新增 21 枚原色阶（ink 7 + 状态色 8 + 分类色 6），暗色侧改写成 53 枚 `var()`。
**回报**：8 份生成产物（Swift / ArkTS / RN / JSON / GTK / WinUI / 小组件）逐字节不变，549 条测试不变，
`color.category-*` 与暗色表面的取值从此有了名字 —— 而"名字"正是下一次改动不再靠抄的前提。

| 格子 | 处置前 | 处置后 | 现量命令 |
|---|---|---|---|
| 暗色块 `--ht-color-*` 总数 | 66 | 66（覆盖完整性不许变） | `pnpm --filter @heyta/design-system test` 的「暗色主题覆盖完整性」 |
| └ 裸 hex 字面 | **33** | **0** | §7 第 3 条 |
| └ `rgb()` 字面（alpha 例外） | 13 | 13（刻意保留，§2.4） | 同上 |
| └ `var()` 引用 | 20 | **53** | 同上 |
| 暗色字面值合计 | **46** | **13** | `33+13` → `0+13` |
| 这些值里「原色阶没有的」 | 21 个不同色值（=31 枚） | **0** | §7 第 5 条（`inventory.mjs`） |
| 原色阶枚数（值为 hex 的非语义变量） | 45 | **66**（+21） | §7 第 4 条 |
| 全文件裸 hex 总数 | 78（45 产地 + 33 暗色） | **66（全部在产地）** | §7 第 4 条 |
| 亮色块 `--ht-color-*` 字面 | 1（`overlay` 的 rgb） | 1（未动，同一条例外） | §7 第 3 条把行号范围换成 `101-227` |
| 生成产物字节差异 | — | **0 / 8 个文件** | `git status --porcelain packages/design-system/` |
| 暗色对比度读数（7 对 × 亮暗） | — | **逐对相同** | §7 第 6 条 |

🔴 **一条必须先说的读数**：验收 ① 写的是「把任意一枚改回字面值，`check:design` 必须变红」——
**现存的任何一把尺都做不到，且不是选错了尺**。实测见 §4 ①。补丁正文与其红/白取证在 §6，
落库归设计系统线（本工单不许改门禁脚本，硬边界写明「只动 tokens.css 与 generated/」）。

---

## 1. 复跑清单：与审计的差异

### 1.1 复现一致的部分（逐条重跑，非抄数）

| 审计声称 | 我复跑的读数 | 一致？ |
|---|---|---|
| 暗色块 66 枚语义色，一一对应无缺覆盖 | 66 / 66 | ✅ |
| 46 枚字面 = 33 裸 hex + 13 `rgb()` | 46 = 33 + 13 | ✅ |
| 全文件裸 hex 78 处 = 45 产地 + 33 暗色 | 78 = 45 + 33 | ✅ |
| 暗色 `rgb()` 20 处（color 13 + material 7），另 shadow 5 枚不被该式命中 | 20 = 13 + 7，shadow 5 枚以 `0 1px 2px rgb(…)` 开头 ✅ | ✅ |
| 21 个色值原色阶里没有（hex 侧） | 21 个不同的未命中色值，全部是 hex | ✅ |
| 9 个能命中（hex 2 + rgb 三元组 7） | 命中的**不同原色阶** 9 枚；按枚数是 15 枚（hex 2 + rgb 13） | ✅（口径见下） |

### 1.2 三处差异

**① 「30 个不同色值 / 16 处重复抄写」按口径有两个答案，本文取逐字节的。**
按「三元组相同即同值」（忽略 alpha）：30 个值 / 16 处重复 —— 复现审计。
按「字面逐字节相同才算同值」：**33 个值 / 13 处重复**。
差异全在 alpha 上：`rgb(37 99 235 / 0.16)` 与 `/ 0.24`（primary-subtle ↔ subtle-hover）、
`rgb(148 163 184 / 0.12 / 0.14 / 0.2)`（hover ↔ quadrant-4-subtle ↔ active）是**不同的值**，
不是同一枚色抄了两遍。⚠️ 这一格直接影响 `quadrant-4-subtle`：审计自己在 §2-C 已警告
「0.14 与 hover 0.12 / active 0.2 都不同，别顺手并进去」—— 按逐字节口径它自动不会被误并。

**② 「命中原色阶 9 个」是**去重后的色值数**，枚数是 15。**
13 枚 `rgb()` **全部**命中已登记原色阶（三元组逐字节相等），2 枚 hex 命中（`blue-900` / `blue-700`）。
审计 §1 的正文其实写了「rgb 侧 7 个三元组全部命中」，只是标题那句「9 个能命中」容易被读成"9 枚"。

**③ 审计 §4「没核到的」第一条现在核到了：`packages/design-system/tests/` 在这棵树里存在。**
`tokens.spec.ts` / `category-colors.spec.ts` 都在，且**都算暗色**：
`tokens.spec.ts` 有独立的「暗色主题对比度」`describe`（`extractVars(CSS, 'dark')` × `AA_PAIRS` 全对），
`category-colors.spec.ts` 的文件头写明「与 surface 的对比度（亮色与暗色各算一遍）」+ 色盲两两色差。
⇒ 审计那句「对比度与色盲门禁是否覆盖暗色块，本文不下结论」可以收口：**覆盖**。
这条直接决定了 §3 的判据强度（改完跑 549 条测试不是装饰）。

---

## 2. 三类处置

### 2.0 先立一条审计没有的判据

审计把「同值」当成「可以互相引用」。同值有两类，后果完全不同：

> **(A) 契约同值**：亮色侧这两枚**本来就指同一枚原色阶**（`quadrant-1` 与 `danger` 都是 `red-600`）。
> 这一对是同一个语义答案抄了两遍 —— 暗色侧写成 `var(--ht-color-danger)` 是**说出已有的事实**。
> **(B) 巧合同值**：亮色侧两枚不同档或不同族，只有暗色下撞在一起（`quadrant-3`=amber-700 ↔ `warning`=amber-600）。
> 这一对写成互相引用，就是**把一次巧合锁成契约**，而亮色侧不同意这份契约。

所以 **(B) 一律回指原色阶，不跨语义引用**。这条判据同时保住了本工单的立项目标
——「暗色侧写成与亮色侧**同样的形状**」。亮色侧除了 `calendar-day-off/work` 一对，
没有任何语义 token 引用另一个语义 token；暗色侧若大面积互相引用，就是造出第二种不一致。

### 2.1 a 类：6 枚（审计估 18 枚）

| 暗色 token | 处置前 | 处置后 | 为什么算 a |
|---|---|---|---|
| `--ht-color-quadrant-1` | `#f87171` | `var(--ht-color-danger)` | (A) 亮侧同为 `red-600` |
| `--ht-color-priority-high` | `#f87171` | `var(--ht-color-danger)` | (A) 同上 |
| `--ht-color-priority-low` | `#38bdf8` | `var(--ht-color-info)` | (A) 亮侧同为 `sky-600` |
| `--ht-color-focus-break` | `#34d399` | `var(--ht-color-success)` | (A) 亮侧同为 `emerald-600` |
| `--ht-color-heat-1` | `#1e3a8a` | `var(--ht-blue-900)` | 阶已存在，直接回指 |
| `--ht-color-heat-2` | `#1d4ed8` | `var(--ht-blue-700)` | 同上 |

**改动量**：6 行值 + 3 处判据注释（quadrant 那一段 / priority 那一句 / focus-break 那一句）。**像素变更 0。**

与审计「18 枚」的差额 = 12 枚，逐条去向：
9 枚是 (B) 巧合同值或分类色板成员（`quadrant-3`、`priority-medium`、`category-1`、`category-3`、
`disabled-bg`、`heat-0`、以及 `border-subtle` 本身）→ 走 b 类回指原色阶；
3 枚是 alpha（`quadrant-1/2/3-subtle`）→ 走 c 类，本轮不动。

⚠️ 为什么 `category-1`（暗色与 `danger` 撞值）**不**跟着引用 `danger`：分类色板的 8 枚是被
`category-colors.spec.ts` 的色盲两两分离约束**联合解出来**的一组，把它挂到 UI chrome 色上，
下一次调 danger 就会静默顶掉一槽可辨识度。它回指 `var(--ht-red-400)` —— 同值、有名字、不耦合。

### 2.2 b 类：27 枚 + 补 21 枚阶

**必须先补阶**（`var()` 右边原本不存在），补阶的族与档号理由：

| 新阶 | 枚数 | 取值 | 为什么加在这一族、这个档 |
|---|---|---|---|
| `--ht-ink-950/900/800/700/600/500/400` | 7 | `#080e1a #0d1526 #101a2e #131e33 #16203a #1e2b45 #2b3b5c` | **独立成族，不塞进 slate**：这 7 枚全是带蓝调的暗面，slate 里没有、也不该有（塞进去等于宣布 `slate-800` 有两种取值）。暗色块原注释已在说"沿用 surface 那套家族，保持同一色相"—— 家族有了名字，这句话才可核对。**档号只表本族明度次序**，只取 Tailwind 真实存在的 7 个档名（950→400）：按"就近取号"会让 `#16203a` 与 `#1e2b45` 挤进同一档，那一档就同时在判两件事。刻意稀疏与 `paper-*`（R15）同例。 |
| `--ht-{red,amber,emerald,sky}-300` 与 `-400` | 8 | `#fca5a5 #f87171 / #fcd34d #fbbf24 / #6ee7b7 #34d399 / #7dd3fc #38bdf8` | 各族**已有 50/600/700**，缺的正是暗色的"提亮档"。取值与 Tailwind 同名档一致（本仓原色阶一直是它的子集），所以**不是发明新色，是补上一直没登记的相邻档**。 |
| `--ht-orange-400`、`--ht-teal-200`、`--ht-cyan-400`、`--ht-fuchsia-400`、`--ht-pink-400`、`--ht-indigo-500` | 6 | `#fb923c #99f6e4 #22d3ee #e879f9 #f472b6 #6366f1` | 分类色板暗色侧的对应档。前 5 枚与同族的亮色档（orange-600 / teal-600 / cyan-700 / fuchsia-700 / pink-700）**同族异档**，照亮侧惯例登记即可；`indigo-500` 是本文件**第一个 indigo 档**（见 §5 的跨族登记）。 |

合计 **21 枚新阶** = 审计「21 个原色阶里没有的色值」，一一对应、无一发明。

b 类 27 枚的去向（值全部不变）：
`surface→ink-900`、`surface-subtle→ink-800`、`surface-raised→ink-700`、`surface-sunken→ink-950`、
`border→ink-500`、`border-strong→ink-400`、`border-subtle`/`disabled-bg`/`heat-0`→`ink-600`（各指各的，见 §2.0 (B)）；
`success/success-strong→emerald-400/300`、`warning/warning-strong→amber-400/300`、
`danger/danger-strong→red-400/300`、`info/info-strong→sky-400/300`；
`quadrant-3`、`priority-medium`→`amber-400`；
`category-1..8`→`red-400 / orange-400 / emerald-400 / teal-200 / cyan-400 / indigo-500 / fuchsia-400 / pink-400`。

**改动量**：21 行新增阶 + 27 行改写 + 4 段族理由注释。

### 2.3 c 类：13 枚 alpha —— 判定为登记过的例外，**不改**

理由（不重复审计，只补它没写的两格）：

1. **改法只有两种，两种都不是"换一种写法"**：`color-mix()` 要先生成器与解析器认识它
   （`css-tokens.ts:177` 的 `resolveVar` 只认整值 `var()`，`normalizeColor` 只认 hex 与 rgb；
   生成器现在把 `rgb(13 21 38 / 0.72)` 展平成 `#0d1526b8`，`color-mix` 展不开就是**产物里出现字符串垃圾**）；
   而"把 alpha 折进 hex 字面"（`#2563eb29`）看起来能引用 —— **它恰恰不能引用**：
   折出来的是一枚新字面量，仍然要登记，等于把 13 枚换成 13 枚。
2. **动它会连带动 14 枚材质 + 亮色 `overlay`**（`--ht-material-*` 也是 `rgb()` 例外，
   且它的三元组 `13 21 38` 现在正好等于新登记的 `ink-900`）。这一族的改造必须一次做完整族，
   不该塞进"暗色语义化"这一刀的中间。
3. **前置条件**（要动之前先满足，缺一就别动）：① `normalizeColor`/`resolveVar`/`resolveAllVars`
   三条路径都支持 `color-mix(in srgb, var(--ht-X) N%, transparent)`；② `generate --check` 在
   8 份产物上证明展平结果与今天的 `#rrggbbaa` 逐字节相同；③ `check:tokens` 的 Android 小组件
   对账跟着过。这三条落地后，c 类 13 枚 + 材质 14 枚 + 亮色 1 枚一起换，账本 `ALPHA_EXCEPTION_MAX` 归零。

许可的具体写法与红/白取证见 **§6**。

---

## 3. 执行记录

改动文件：**1 个** —— `packages/design-system/src/tokens.css`（+110 / −37 行）。
`git status --porcelain packages/design-system/` → 只有 `M packages/design-system/src/tokens.css`，
**`generated/` 与 `src/generated/tokens.native.ts` 不在改动列表里**：codegen 重跑后产物逐字节未变（这就是 §4 ④）。

```
pnpm --filter @heyta/design-system run generate
✅ 已生成 8 个文件（225 个 token；暗色覆盖 78；减少动效 10）
```

前后对照（同一趟里取）：

```bash
cp packages/design-system/src/generated/tokens.native.ts before/  # 以及 generated/tokens.json
pnpm --filter @heyta/design-system run generate                    # 写 8 份产物
cmp before/tokens.native.ts packages/design-system/src/generated/tokens.native.ts   # 无输出＝逐字节相同
shasum -a 256 packages/design-system/generated/* packages/design-system/src/generated/tokens.native.ts
# 8 枚 sha256 与改动前基线逐条相同（见 §4 ④ 的表）
```

---

## 4. 四条验收判据（逐条读数，每条都给了"它怎么红"）

### ① `check:design` 绿 + 改回字面值必须变红 —— **前半绿，后半现尺做不到（实测）**

```
pnpm check:design            → 扫描 660 个源文件…✅ 无硬编码设计变量。  rc=0
pnpm check:design-token-refs → ✅ 141 个 token 引用全部可解析（定义 294 个）  rc=0
```

**变异取证（2026-11-06 实测）**：把已改好的 `--ht-color-surface: var(--ht-ink-900)` 写回 `#0d1526`，
四把尺的读数 ——

| 尺 | rc | 判决 |
|---|---|---|
| `check:design` | 0 ✅绿 | **没看见** |
| `check:design-token-refs` | 0 ✅绿 | 没看见（它只扫 `apps/*` 与 `packages/ui` 的引用） |
| `check:tokens` | 0 ✅绿 | 没看见（解析值没变，产物自然一致） |
| `pnpm --filter @heyta/design-system test`（549 条） | 0 ✅绿 | 没看见 |

⇒ 原话：**"改回字面值"在今天的任何一把现成尺上都不红。** 根因是主循环开头那句
`if (rel.includes('tokens.css')) continue; // token 定义文件是产地`（今天两处：`:347` 与 `:379`）—— 产地本身没有判据。
所以本工单**不是**"选了错的尺"，而是**缺这一格**。
补法（补丁正文 + 白/红/红/白/账本红/未定义 var 红 六种状态的实测）在 **§6**，
落库需要改 `design-system/heyta/check-hardcoded.mjs` 与 `package.json` —— **不在本工单允许写的路径里**，
已按"待裁决要给正文"的原则把可粘贴的补丁与取证一并交出。
`tokens.css` 暗色块的块头注释已把这条规矩与"现在只有注释在管"一起写进源文件。

### ② 字面值 46 → 13（−33）

统计命令（§7 第 2、3 条）与读数：

| | 前 | 后 |
|---|---|---|
| 暗色块裸 hex | 33 | **0** |
| 暗色块 `rgb()` | 13 | 13（c 类登记例外） |
| 暗色块 `var()` | 20 | **53** |
| 暗色块字面合计 | **46** | **13** |
| 其中"原色阶里根本没有" | 31 枚 / 21 个值 | **0 / 0** |

已处置数 = 33 枚（a 类 6 + b 类 27），恰好等于消失的那 33 枚裸 hex。

### ③ 亮暗对比度不变 —— 7 对 × 2 主题逐对相同

探针**不重写公式**，直接 import 仓内唯一解析器 `src/css-tokens.ts`（§7 第 6 条），
对 HEAD 版与工作树版各跑一遍再 `diff`（空＝全同）：

| 代表 token 对 | 主题 | 前 | 后 | 这一对为什么代表 |
|---|---|---|---|---|
| `color.foreground` on `color.surface` | 暗 | 16.634:1 | 16.634:1 | 被改枚数是 b 类里最多的一族（surface/border 全换成 ink 阶） |
| `color.on-danger` on `color.danger` | 暗 | 7.293:1 | 7.293:1 | 文件注释里钉着"2.77 vs 7.29"那格，`danger` 由 hex 改指 `red-400` |
| `color.quadrant-1` on `color.surface` | 暗 | 6.588:1 | 6.588:1 | a 类跨语义引用（`quadrant-1→danger`）**两端同时改**，最容易出错的一格 |
| `color.heat-1` on `color.surface` | 暗 | 1.759:1 | 1.759:1 | 回指已有阶（`blue-900`），验证不依赖补阶 |
| `color.warning-strong` on `color.surface` | 暗 | 12.638:1 | 12.638:1 | 状态色 300 档新登记 |
| `color.primary` on `color.background` | 亮 | 4.940:1 | 4.940:1 | 亮色侧未被触碰的对照 |
| `color.on-danger` on `color.danger` | 亮 | 4.829:1 | 4.829:1 | 同上 |

`AA_PAIRS`+`GRAPHIC_PAIRS` 的全部暗色配对由 `tests/tokens.spec.ts` 独立复算，549 条测试绿。

### ④ codegen 幂等 + 产物与源一致

| 判据 | 命令 | 读数 |
|---|---|---|
| 产物与 tokens.css 一致 | `pnpm check:tokens` | ✅ 生成产物与 tokens.css 一致（8 个文件，225 个 token）；✅ Android 小组件亮暗颜色逐字节对账通过（2 份） |
| 重跑无 diff（幂等） | `generate` 连跑两趟后 `git status --porcelain packages/design-system/` | 只有 `M …/src/tokens.css`，**8 份产物一个都不在改动列表** |
| 前后逐字节 | 8 枚 sha256 改动前/后各取一次 | `HeytaTokens.ets d1a05889…` / `.swift 40e732af…` / `.xaml 59cc1936…` / `heyta-tokens.h 81c762c1…` / `heyta.gtk.css 9a486bcd…` / `tokens.json 58009cad…` / `typography.css ae73ddee…` / `tokens.native.ts 30aafcf0…` —— **两趟逐条相同**（短哈希只作指纹，长哈希跑命令自取） |

⚠️ 这一条比"比对 `tokens.native.ts` 一枚"更强：改动前我留了全部 8 份的 sha256，
所以 Swift / ArkTS / GTK / WinUI / Android 小组件那条独立管道也一起被证明没被动过。

**门禁汇总**：`check:design` ✅ · `check:design-token-refs` ✅ · `check:tokens` ✅ ·
design-system 测试 549 ✅ · `pnpm --filter @heyta/design-system typecheck` ✅（rc=0）。

---

## 5. 没做 / 不归本工单

| 格 | 状态 | 为什么不顺手做掉 |
|---|---|---|
| `check:design` 缺语义层管辖权 | **已给补丁正文并实测红白**（§6），未落库 | 硬边界只许动 `tokens.css` 与 `generated/`；且判据口径归设计系统线 |
| `category-3` 跨族（亮 `green-600` → 暗 `emerald-400`）、`category-6` 跨族（亮 `blue-700` → 暗 `indigo-500`） | 值不动，**注释已从"每个槽位与亮色同色系"改成点名两处跨族** | 改值 = 改像素 + 要重解色盲两两分离那一组约束，是另一张工单。本轮先把事实写进源文件：`var(--ht-emerald-400)` 让跨族变成读得出来的东西，而不是两枚 hex |
| c 类 13 枚 + 材质 14 枚 + 亮色 1 枚改 `color-mix()` | 未做，前置条件写在 §2.3 第 3 条 | 生成器与解析器都不认 `color-mix`，硬改会把无法展平的字符串写进 Swift/ArkTS 产物 |
| `--ht-shadow-*` 的 `rgb(0 0 0 / α)` | 不在许可范围，也未登记例外 | 原色阶里没有"黑"（无 `--ht-black`）。要不要给它一个名字是另一个判断，纳进本条会立刻误报 |
| `pnpm typecheck`（全包）**红**：135 处错误全在 `packages/ui` | 与本改动无关，**HEAD 状态** | 归因证据：`git status` 显示 `packages/ui` 一个字节没动；错误是 71×TS2307 + 26×TS7006 + 38×TS7031，根因是 `packages/ui/node_modules/react-native` 是**悬空软链**（指向 store 里已不存在的 `react-native@0.84.1_…_b5892f35…`，旁边另有两枚同版本不同 peer-hash 的目录）。像是有别线正在跑重装。`@heyta/design-system` 自己 typecheck rc=0 |
| 审计 §4 三条"没核到的" | 第 1 条已收口（§1.2 ③）；第 2 条由本文 §4 ③ 补上；第 3 条（Tailwind 族名仅用于定位）仍然成立 —— 新阶的档名按 Tailwind 取，本仓此前没登记过 | — |

---

## 6. c 类的窄许可：补丁正文与红白取证

**插哪里**：`design-system/heyta/check-hardcoded.mjs`，紧接主扫描循环之后、
`console.log(\`\n扫描 ${checked} 个源文件…\`)` 那一行之前（今天的 `:417`）。
它把结果 push 进既有的 `problems` 数组，所以报告与 `exit(1)` 都走现成的路。
**同时**把 `package.json` 改成 `node design-system/heyta/check-hardcoded.mjs --self-test && node design-system/heyta/check-hardcoded.mjs`（与仓内其他门同一形状）。

```js
/* ══════════════════════════════════════════════════════════════════════
   R9 附加检查：语义层（tokens.css 自己）不许再抄色值
   ══════════════════════════════════════════════════════════════════════

   为什么必须加在这一把尺上：上面 9 类只管**消费侧**（apps/* 与 packages/ui），
   而主循环开头那句 `if (rel.includes('tokens.css')) continue; // token 定义文件是产地`
   （今天出现在两处：排版配对循环与主扫描循环）显式跳过了产地。于是产地本身
   反而是唯一没人管的地方 —— 2026-11-06 实测：把暗色块任意一枚改回裸 hex，
   `check:design` / `check:design-token-refs` / `check:tokens` / 549 条测试
   **全部照绿**（值没变，所以对比度与产物都不说话）。症状是"下一次有人调主题
   时只改了语义层那一枚"，而这正是 R9 要消灭的那 46 枚的来历。

   判据（**窄**许可，两条形同虚设的口子都不开）：
     · `var(--ht-*)` —— 且那个名字必须在本文件里真的存在（顺手补上
       `check:design-token-refs` 看不见 tokens.css 内部引用的那一格）；
     · `rgb(<三元组> / <0–1>)` —— 且三元组必须**逐字节等于本文件已登记的某一枚
       原色阶**。`var()` 表达不了不透明度，`color-mix()` 生成器与对比度解析器
       都还不认，所以这批是登记过的例外，不是"没想到要引用"。
     其余一切字面量 ⇒ 红。

   ⚠️ 已知取舍：`primitiveHex()` 是本文件内的第二枚 hex 归一器（3 位展开 + 小写）。
   包的解析器在 `src/css-tokens.ts`（TS），这把尺是零依赖 JS，导入会把设计系统
   变成门禁的构建依赖。归一器只有两行，且被 self-test 的臂 ②（hex 路径）与臂 ④
   （rgb→hex 比对）按住。
*/

const SEMANTIC_FILE = 'packages/design-system/src/tokens.css';
/**
 * 只管这两族。`--ht-shadow-*` 刻意**不在**范围内：它的 `rgb(0 0 0 / 0.4)`
 * 里那枚黑从没登记进原色阶（没有 `--ht-black`），纳进来会立刻误报。
 * 要不要给黑一个名字是另一个判断，不随本条一起改。
 */
const SEMANTIC_PREFIXES = ['--ht-color-', '--ht-material-'];
/**
 * alpha 例外的**账本上限**（与 `check:settings-prose` 同一条纪律）：
 * 现量 = 语义层里「已登记原色阶三元组 + 不透明度」的枚数。
 * 🔴 只许改小。新增一枚半透明字面量 ⇒ 红，逼它先说明"为什么不能回指"。
 */
const ALPHA_EXCEPTION_MAX = 28;

const DECL_RE = /^\s*(--ht-[a-z0-9-]+)\s*:\s*(.+?);\s*$/;
const VAR_RE = /^var\((--ht-[a-z0-9-]+)\)$/;
const RGB_RE = /^rgb\(\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s*\/\s*(\d*\.?\d+)\s*\)$/;
const PRIMITIVE_HEX_RE = /^--ht-(?!color-|material-|shadow-)[a-z0-9-]+$/;

const pad2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

/** 任意 CSS 颜色字面量 → `#rrggbb`（丢 alpha）；解析不了返回 null。 */
function primitiveHex(value) {
  const v = value.trim();
  const hex = v.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
  if (hex) {
    let h = hex[1].toLowerCase();
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return `#${h.slice(0, 6)}`;
  }
  const rgb = RGB_RE.exec(v) || /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(v);
  if (!rgb) return null;
  return `#${pad2(+rgb[1])}${pad2(+rgb[2])}${pad2(+rgb[3])}`;
}

/**
 * 纯函数：一枚语义层声明合法吗？
 * @returns null = 合法；'alpha' = 合法且计入例外账本；字符串 = 红话。
 */
function semanticDeclarationProblem(name, value, primitives, defined) {
  const v = value.trim();
  const varRef = VAR_RE.exec(v);
  if (varRef) return defined.has(varRef[1]) ? null : `引用了本文件里不存在的 ${varRef[1]}`;
  const rgb = RGB_RE.exec(v);
  if (!rgb) return '语义层只许 var(--ht-*) 或已登记原色阶的 rgb()';
  const owner = primitives.get(primitiveHex(v));
  if (!owner) return 'rgb() 的三元组没有登记在原色阶里';
  const alpha = Number(rgb[4]);
  if (!(alpha > 0 && alpha < 1)) return '不透明度必须落在 0 与 1 之间（ opaque 请直接 var() ）';
  return 'alpha';
}

function checkSemanticLayer() {
  const file = join(ROOT, SEMANTIC_FILE);
  if (!existsSync(file)) return { problems: [], alpha: 0, scanned: 0, primitives: 0 };
  const raw = readFileSync(file, 'utf8');
  // 剥块注释但保留行数，报出的行号才准（与上面主循环同一做法）。
  const lines = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).split('\n');

  const primitives = new Map();
  const defined = new Set();
  for (const line of lines) {
    const m = DECL_RE.exec(line);
    if (!m) continue;
    const [, name, value] = m;
    defined.add(name);
    if (PRIMITIVE_HEX_RE.test(name)) {
      const hex = primitiveHex(value);
      if (hex && !primitives.has(hex)) primitives.set(hex, name);
    }
  }

  const problems = [];
  let alpha = 0;
  let scanned = 0;
  lines.forEach((line, i) => {
    const m = DECL_RE.exec(line);
    if (!m) return;
    const [, name, value] = m;
    if (!SEMANTIC_PREFIXES.some((p) => name.startsWith(p))) return;
    scanned++;
    const verdict = semanticDeclarationProblem(name, value, primitives, defined);
    if (verdict === 'alpha') {
      alpha++;
      return;
    }
    if (verdict === null) return;
    problems.push({
      file: SEMANTIC_FILE,
      line: i + 1,
      text: `${name}: ${value.trim()}`,
      kind: `语义层字面值（${verdict}）`,
      hint: '回指原色阶 var(--ht-…)；缺档先补阶（规则 3），半透明只许 rgb(<已登记三元组> / <0–1>)',
    });
  });

  if (alpha > ALPHA_EXCEPTION_MAX) {
    problems.push({
      file: SEMANTIC_FILE,
      line: 1,
      text: `alpha 例外 ${alpha} 枚 > 账本 ${ALPHA_EXCEPTION_MAX} 枚`,
      kind: '语义层字面值（账本只许改小）',
      hint: '新写一枚半透明之前先问：它能不能 var()；能就该换掉',
    });
  }
  return { problems, alpha, scanned, primitives: primitives.size };
}

/** --self-test：这把尺必须先证明它会红（AGENTS §6 工作流 2）。 */
function selfTestSemanticLayer() {
  const primitives = new Map([['#2563eb', '--ht-blue-600'], ['#ffffff', '--ht-white']]);
  const defined = new Set(['--ht-blue-600', '--ht-white', '--ht-color-primary', '--ht-color-surface']);
  const arms = [
    ['① var 引用已定义 ⇒ 白', semanticDeclarationProblem('--ht-color-primary', 'var(--ht-blue-600)', primitives, defined), null],
    ['② 裸 hex ⇒ 红', semanticDeclarationProblem('--ht-color-surface', '#0d1526', primitives, defined), '语义层只许'],
    ['③ 已登记三元组 + alpha ⇒ 记入账本', semanticDeclarationProblem('--ht-color-primary-subtle', 'rgb(37 99 235 / 0.16)', primitives, defined), null],
    ['④ 未登记三元组 ⇒ 红', semanticDeclarationProblem('--ht-color-x', 'rgb(12 34 56 / 0.16)', primitives, defined), '没有登记在原色阶'],
    ['⑤ 拼错/未定义的 var ⇒ 红', semanticDeclarationProblem('--ht-color-y', 'var(--ht-emerald-9xx)', primitives, defined), '不存在的'],
    ['⑥ alpha=1（该写 var）⇒ 红', semanticDeclarationProblem('--ht-color-z', 'rgb(37 99 235 / 1)', primitives, defined), '0 与 1 之间'],
  ];
  const failures = arms.filter(([label, got, want]) =>
    label.includes('记入账本') ? got !== 'alpha' : !(want === null ? got === null : String(got).includes(want)),
  );
  if (failures.length > 0) {
    console.error('❌ check:design 的语义层臂自检失败（这把尺是钝的）：');
    for (const [label] of failures) console.error(`   ${label}`);
    process.exit(1);
  }
  console.log(`✅ 语义层 self-test 通过（${arms.length} 枚臂）`);
}

if (process.argv.includes('--self-test')) {
  selfTestSemanticLayer();
  process.exit(0);
}
const semantic = checkSemanticLayer();
problems.push(...semantic.problems);
console.log(
  `语义层（${SEMANTIC_FILE}）：扫 ${semantic.scanned} 枚声明，` +
    `原色阶 ${semantic.primitives} 枚，alpha 例外 ${semantic.alpha}/${ALPHA_EXCEPTION_MAX} 枚。`,
);
```

### 6.1 它怎么白

对**改完之后的 `tokens.css`** 跑（`/tmp/r9-rig` 里那份补丁副本，扫描根用软链指回真仓）：

```
✅ 语义层 self-test 通过（6 枚臂）
语义层（packages/design-system/src/tokens.css）：扫 151 枚声明，原色阶 66 枚，alpha 例外 28/28 枚。
扫描 660 个源文件（…），检查 9 类硬编码。
✅ 无硬编码设计变量。        rc=0
```

`151 = 66 亮 + 66 暗（--ht-color-*）+ 14 材质 + 5 枚 reduced-transparency 覆盖`；
`28 = 13 暗色 alpha + 1 亮色 overlay + 14 材质`。**账本此刻正好满格**：
所以 §2.3 那句"c 类一批连材质一起改"落地时，`ALPHA_EXCEPTION_MAX` 必须**跟着降**，
它涨不回去 —— 这正是账本要的效果。

### 6.2 它怎么红（五枚实测，逐条给原文）

| # | 注入 | 尺说的话 | rc |
|---|---|---|---|
| B | `--ht-color-surface: var(--ht-ink-900)` → `#0d1526` | `762: --ht-color-surface: #0d1526 ← 语义层字面值（语义层只许 var(--ht-*) 或已登记原色阶的 rgb()）` | 1 |
| C | `--ht-color-hover: rgb(148 163 184 / 0.12)` → `rgb(148 163 183 / 0.12)`（**蓝通道差 1**） | `781: --ht-color-hover: rgb(148 163 183 / 0.12) ← 语义层字面值（rgb() 的三元组没有登记在原色阶里）` | 1 |
| D | 撤掉 C | 回到 6.1 的白 | 0 |
| E | `--ht-color-quadrant-4: var(--ht-slate-400)` → `rgb(148 163 184 / 0.5)`（三元组**已登记**、alpha 合法） | `1: alpha 例外 29 枚 > 账本 28 枚 ← 语义层字面值（账本只许改小）` | 1 |
| F | 同上一枚改指 `var(--ht-slate-4400)`（**拼错的阶名**） | `818: --ht-color-quadrant-4: var(--ht-slate-4400) ← 语义层字面值（引用了本文件里不存在的 --ht-slate-4400）` | 1 |

**E 与 F 是这条许可"窄"在两处各自的牙**：E 证明即使三元组在白名单里，
想多开一枚半透明仍然要动账本（而账本只许改小）；F 证明补阶时把 `emerald-400` 写成
`emerald-440` 这种"看起来一样"的错，在这把尺上立刻红 —— 那一格 `check:design-token-refs`
今天看不见（它的 `SCAN_ROOTS` 不含 tokens.css），是这轮实测顺带挖出来的第二个管辖权缺口。

⚠️ 臂 ③ 的头一版夹具是错的（`primitives` 里没有 red-600 却期望它记入账本），
`--self-test` **第一次跑就 rc=1 把它抓了出来**，改成 `blue-600` 三元组后才过 ——
这段留在这里是因为它正好是"不能失败的检查没有价值"的现场证据：自检的失败早于任何使用。

同一组状态在**本文正文这版补丁**（从文档抽回 → splice → `node --check` → 跑）上又过了一遍，
这次抽的是 `border` 与 `active` 两枚：`776: --ht-color-border: #1e2b45`、
`782: --ht-color-active: rgb(148 163 183 / 0.2)`、账本臂与拼错臂同前 ——
**红话逐字相同，白态读数逐字相同**（`扫 151 枚声明，原色阶 66 枚，alpha 例外 28/28 枚`）。

---

## 7. 复现命令（本仓根目录跑；行号会漂，所以每条都是现量）

```bash
# 1) 暗色块边界（不要抄文中的 751-882）
grep -n "^\[data-theme='dark'\] {" packages/design-system/src/tokens.css

# 2) 暗色块字面值枚数（前 46 / 后 13）
awk '/^\[data-theme=.dark.\] \{/{on=1} on&&/^\}/{on=0} on' packages/design-system/src/tokens.css \
  | grep -E '^[[:space:]]*--ht-color-[a-z0-9-]+:' \
  | sed -E 's/^[[:space:]]*--[a-z0-9-]+:[[:space:]]*//; s/[[:space:]]*;.*$//' \
  | awk '/^#/{h++;next} /^rgb\(/{r++;next} /^var\(/{v++;next} {o++}
         END{print "hex:",h+0," rgb:",r+0," var:",v+0," 其他:",o+0," 字面合计:",h+r}'

# 3) 全文件裸 hex 总数 + 落在暗色块里的枚数（前 78/33 → 后 66/0）
rg -n '^[[:space:]]*--ht-[a-z0-9-]+:[[:space:]]*#[0-9a-fA-F]{3,8};' packages/design-system/src/tokens.css

# 4) 原色阶枚数（前 45 → 后 66）
rg -o -P '^\s*--ht-(?!color-|material-|shadow-)[a-z0-9-]+:\s*#[0-9a-fA-F]{3,8};' packages/design-system/src/tokens.css | wc -l

# 5) 逐枚对账（每枚：值 / 命中的原色阶 / 与谁同值 / 未命中去重数）—— 正文在本文末尾
node /tmp/r9-probe/inventory.mjs "$PWD"

# 6) 对比度前后逐对（HEAD vs 工作树）
git show HEAD:packages/design-system/src/tokens.css > /tmp/r9-probe/tokens.before.css
node /tmp/r9-probe/contrast.mjs "$PWD" /tmp/r9-probe/tokens.before.css > /tmp/before.txt
node /tmp/r9-probe/contrast.mjs "$PWD"                                      > /tmp/after.txt
diff /tmp/before.txt /tmp/after.txt && echo "对比度无变化"

# 7) 门禁与产物
pnpm check:design && pnpm check:design-token-refs && pnpm check:tokens
pnpm --filter @heyta/design-system test
pnpm --filter @heyta/design-system typecheck
git status --porcelain packages/design-system/     # 期望：只有 M …/src/tokens.css
```

第 5、6 条用的探针：都只吃 `argv[2]=仓库根`（`contrast.mjs` 另吃 `argv[3]=可选 CSS 路径`，用来喂 HEAD 版），
import 仓内唯一解析器，**不复写公式、不写任何产物**。正文照抄即可复现（本次实测就在 `/tmp/r9-probe/`）：

```js
// loader.mjs —— 把 .ts 里写的 './tokens.js' 解析回 './tokens.ts'（Node 类型剥离不做这步重映射）
import { existsSync } from 'node:fs';
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
    const candidate = new URL(specifier.slice(0, -3) + '.ts', context.parentURL);
    if (existsSync(candidate)) return next(candidate.href, context);
  }
  return next(specifier, context);
}
```

```js
// inventory.mjs —— 逐枚对账：暗色块每一枚字面值 → 命中的原色阶 / 与谁同值 / 未命中去重数
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
const REPO = process.argv[2];
register('/tmp/r9-probe/loader.mjs', import.meta.url);
const { extractVars, extractThemeVars, resolveAllVars, normalizeColor } = await import(
  `${REPO}/packages/design-system/src/css-tokens.ts`
);
const CSS = readFileSync(`${REPO}/packages/design-system/src/tokens.css`, 'utf8');

const base = extractVars(CSS);          // 基准 :root（含原色阶）
const darkOnly = extractThemeVars(CSS, 'dark'); // 只含暗色块**显式写出**的声明
const dark = extractVars(CSS, 'dark');  // 基准 + 暗色覆盖，用于展开引用

const primitives = new Map();           // '#rrggbb' → --ht-blue-600
for (const [name, value] of base) {
  if (/^--ht-(color|material|shadow)-/.test(name)) continue;
  if (!/^#[0-9a-fA-F]{3,8}$/.test(value.trim())) continue;
  primitives.set(normalizeColor(value), name);
}

const rows = [];
for (const [name, raw] of darkOnly) {
  if (!name.startsWith('--ht-color-')) continue;
  const v = raw.trim();
  if (/^var\(/.test(v)) continue;               // 已经是引用，不在账上
  const isHex = /^#/.test(v);
  const hex = normalizeColor(v);                // 含 alpha 的 8 位形态，用于找同值
  const tripleHex = normalizeColor(v.replace(/\/\s*[\d.]+\s*\)/, ' / 1)')); // 丢 alpha 比阶
  const hit = primitives.get(isHex ? hex : tripleHex);
  const twins = [...darkOnly.keys()].filter(
    (o) =>
      o !== name &&
      o.startsWith('--ht-color-') &&
      /^(#|rgb\()/.test(darkOnly.get(o).trim()) &&
      normalizeColor(resolveAllVars(darkOnly.get(o), dark)) === hex,
  );
  rows.push({ name, v, kind: isHex ? 'hex' : 'rgb', hit: hit ?? '-', twins: twins.join(' ') });
}
rows.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind.localeCompare(b.kind)));
for (const r of rows) {
  console.log(`${r.kind.padEnd(4)} ${r.name.padEnd(38)} ${r.v.padEnd(28)} 阶:${String(r.hit).padEnd(18)} 同值:${r.twins}`);
}
console.log(`\n字面枚数=${rows.length}  hex=${rows.filter((r) => r.kind === 'hex').length}  rgb=${rows.filter((r) => r.kind === 'rgb').length}`);
console.log(`命中原色阶=${rows.filter((r) => r.hit !== '-').length}  未命中=${rows.filter((r) => r.hit === '-').length}`);
console.log(`未命中去重后不同色值=${new Set(rows.filter((r) => r.hit === '-').map((r) => r.v)).size}`);
console.log(`已有阶去重后=${new Set(rows.filter((r) => r.hit !== '-').map((r) => r.hit)).size}`);
```

⚠️ 探针的**口径**要和本文对齐才能复现 §1.2 ①：`primitives` 与同值兄弟都按**逐字节（含 alpha）**比，
只有"命中哪一枚阶"这一列按**丢 alpha 的三元组**比 —— 所以它输出「未命中去重 = 21」而暗色字面合计是 46。

```js
// contrast.mjs —— 7 对代表配对 × 亮暗，跑 HEAD 版与工作树版各一次再 diff
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
const REPO = process.argv[2];
register('/tmp/r9-probe/loader.mjs', import.meta.url);
const { contrast, colorOf, extractVars, resolveAllVars } = await import(
  `${REPO}/packages/design-system/src/css-tokens.ts`
);
const { cssVarName } = await import(`${REPO}/packages/design-system/src/tokens.ts`);
const CSS = readFileSync(process.argv[3] ?? `${REPO}/packages/design-system/src/tokens.css`, 'utf8');

const PAIRS = [
  ['color.foreground', 'color.surface'],
  ['color.primary', 'color.background'],
  ['color.on-danger', 'color.danger'],
  ['color.foreground-subtle', 'color.surface-raised'],
  ['color.warning-strong', 'color.surface'],
  ['color.quadrant-1', 'color.surface'],
  ['color.heat-1', 'color.surface'],
];
for (const theme of ['light', 'dark']) {
  const vars = extractVars(CSS, theme === 'dark' ? 'dark' : undefined);
  const raw = (token) => resolveAllVars(vars.get(cssVarName(token)), vars);
  for (const [fg, bg] of PAIRS) {
    const ratio = contrast(colorOf(fg, vars), colorOf(bg, vars));
    console.log(`${theme.padEnd(5)} ${(fg + ' on ' + bg).padEnd(46)} = ${ratio.toFixed(3)}:1   (${raw(fg)} on ${raw(bg)})`);
  }
}
```

