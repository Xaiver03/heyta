# 与 DeepSeek Harness 的设计对齐（实测与决定）

> **状态**：进行中（2026-11-02 立）。第一轮只对齐**字号刻度与角色**，并补了一道门禁；
> 圆角 / 间距 / 卡片解剖**尚未对齐**，清单在 §6。
>
> **为什么要有这份文件**：产品负责人明确要求「UX 必须跟 DeepSeek Harness 对齐」，
> 理由是曾经因为对不齐而出现「各种卡片组件都是坏的、字体大小设计也是坏的」。
> 那种坏法的特征是**不报错**：浏览器静默回退、界面只是"看起来不对"，没有任何一层会说话。
> 所以这份文件做两件事：把两边的**真实量值**记下来（可复跑），
> 以及把「刻意没对齐」的地方写明理由 —— 否则下一个人会把它"顺手对齐"掉。

---

## 1. 测量方法（可复跑）

DSH 的源码在仓库外：`~/Desktop/Agent-Harness-Lab/deepseek-harness`（MIT，`dsh-0.1.6-alpha.2`）。
它的设计系统**不是 token 化的**：`packages/client/ui-theme/src/styles/design-platform.css`
里 330 个 `--dsw-*` 全是**颜色**（static / alias / specific 三层），
布局与排印是组件 CSS 里的**字面量**。所以对齐只能对齐**量值**，不能照搬命名。

```bash
# DSH：真实字号用量（top 5）
grep -rhoE "font-size:\s*[0-9.]+px" ~/Desktop/Agent-Harness-Lab/deepseek-harness/packages/client/ui-*/src \
  | grep -oE "[0-9.]+px" | sort | uniq -c | sort -rn

# DSH：圆角与间距用量
grep -rhoE "border-radius:\s*[0-9.]+px" .../ui-*/src | grep -oE "[0-9.]+px" | sort | uniq -c | sort -rn
grep -rhoE "gap:\s*[0-9]+px"              .../ui-{chat,primitives}/src | sort | uniq -c | sort -rn

# heyta：现有刻度
grep -nE "\-\-ht-(font-size|radius|space)-" packages/design-system/src/tokens.css
```

---

## 2. 三方对照

### 2.1 字号

| 档位 | DSH 实测用量 | heyta 对齐前 | heyta 对齐后 | 落点 |
|---|---|---|---|---|
| 11px | 6 | `2xs` | `2xs` 不变 | |
| 12px | 12 | `xs` | `xs` 不变 | |
| **13px** | **3** | **缺失** | **`md`（新增）** | `group-label` |
| 14px | **14（最高频）** | `sm` | `sm` 不变；`numeric-body` 16→14 | |
| 16px | 1 | `base` | `base` 不变；`section-title` 18→16 | |
| 18/20/24/30/36 | 采样集内 0 | `lg`…`4xl` | 保留（display 档，DSH 采样集不覆盖大标题） | |

🔴 **heyta 原来从 12 直接跳到 14**，于是「分组标题 / 次级标签」这一类文字只能**借** 14
（比正文重）或**借** 12（像脚注）。补 `md` 就是为了让它不必再借 —— 这是本轮
"字体大小设计坏了"的最直接成因。

### 2.2 圆角 / 间距 / 卡片解剖

| 档 | DSH 实测 | heyta 对齐前 | 本轮 |
|---|---|---|---|
| 圆角 | 6×45 / 8×42 / 12×39 / 10×25 / 4×18 / 2×8 | `sm`4 / `md`8 / `lg`12 / `xl`16 / `full` | 卡片边已经是 12 ✓；**6 与 10 仍缺**（见 §6） |
| 卡片边 | **0.5px**（三张卡全一样） | `border-width-thin` 1px | ✅ 新增 `hairline` 并用到 4 张卡 |
| 卡片 padding | `12×16`（HoverCard）/ `16×20`（AskQuestionCard）| `space-4` 四边 16 | ⏸ 未改（见 §6） |
| 卡片内 gap | 8 / 16 | `space-1` 4 | ⏸ **刻意不改**：那个 4 有实测依据（52+4=56，落在 macOS 44–56 上沿，见 `sheets.css` 的注释） |
| 卡片内正文 | 14（`--dsh-content-font-size` 默认 14） | 已落在 11–14 区间 | ✓ |
| 间距档 | gap 8×15 / 6×9 / 4×8 / 12×8 | `4/8/12/16/20/24…` | **6 与 10 仍缺**（见 §6） |

🔴 卡片这一栏的取法是**读组件而不是读 token**：DSH 没有卡片 token，
`radius: 12` 与 `border: 0.5px` 是直接写在 `ui-tool/…/AskQuestionCard.module.css`、
`ui-attachment/…/FileCard.module.css`、`ui-primitives/…/HoverCard.module.css` 里的。

---

## 3. 已对齐（本轮）

| 项 | 改动 | 判据 |
|---|---|---|
| 补 13px 档 | `--ht-font-size-md` + registry `font-size` 组 + 8 份生成产物 | `check:tokens`、`tokens.spec.ts`（546 条） |
| 分组标题 | `group-label` 14 → 13 | `组标题档压得住它管辖的每一档说明` |
| 区块标题 | `section-title` 18 → 16 | `check:design-tokens` 全绿 |
| 数值正文 | `numeric-body` 16 → 14 | 同上 |
| 发丝线 | 新增 `--ht-border-width-hairline`(0.5px)，用于 **4 张卡片的边**（设置主卡 / 订阅计划 / 订阅订单 / AI 卡） | `check:tokens`(222 token)、546 测试、Web 构建 |

---

## 4. 🔴 刻意**没有**对齐的项（不要"顺手"改掉）

**`row-title` 保持 16px，不降到 DSH 的 14。**

本仓有一条已上闸的设计规则：

> `row-title : row-meta` 的字号比 **必须 ≥ 1.33** —— 1.14 等于没有层级
> （`packages/design-system/tests/typography.spec.ts`）

DSH 的正文 14 / 说明 12 = **1.17**，低于这条线。实测把它降到 14 时，
那条测试**当场红**（本轮试过）。这不是"heyta 更保守"，而是**两者约束不同**：

- DSH 是对话界面，一段话有上下文，14/12 靠**留白与气泡**分层；
- heyta 是**列表**，一行里标题与元信息紧邻，没有别的线索 —— 中文又没有大小写提示，
  只能靠字号与字重。所以 16:12 = 1.33 是它成立的最低条件。

⇒ 对齐的是**刻度**（补 13、去 18/20 的滥用），不是**把每一档都压到 DSH 的数值**。
谁要推翻这一条，得先给出"列表里 14:12 仍能一眼分层"的证据。

---

## 5. 新增门禁：`check:design-token-refs`

`var(--ht-does-not-exist)` **不会报错**，只会静默回退。本轮实测抓到的真事故：

```
--ht-font-size-caption   被引用 4 处，而这个 token 从来没有定义过
                         ⇒ 那 4 处字号全部在放大
```

`check:tokens` 对的是**生成产物**一致，样式门禁管的是"不许裸值"，中间这一格一直是空的。
新门禁钉三格：

| 格 | 判据 | 红形 |
|---|---|---|
| 1 | 每个 `var(--ht-*)` 都能解析到定义或白名单 | 拼错 / 想当然的 token 名 |
| 2 | 白名单条目写明的**注入点文件必须还在** | 运行时注入被删了，白名单变死条目 |
| 3 | 自检（`--self-test`）能证明这把尺会红 | 有人把判据写成永远通过 |

已进 `pnpm check` 链（紧跟 `check:design`）。白名单只有 6 条，每条都写了注入点或
fallback 依据（列宽、rail 标签位置、可选覆盖）。

---

## 6. 待办（下一轮）

1. **圆角 6 / 10、间距 6 / 10**：DSH 用量最大的是 6（45 次）与 10（25 次圆角、若干间距），
   而 heyta 这两档都没有 —— 组件只能借 8 或 12。补档本身安全，**迁移**才需要卡片清单。
2. **卡片 padding 16×20**：DSH 的主卡是纵向 16 / 横向 20，heyta 是四边 16。
   ⏸ **没改**：它会让内容区变宽，属于"必须有视觉验收才敢动"的那一类 ——
   而本轮没有截图验收（理由见 §7）。`gap 4` 则**刻意保留**（有实测的行高依据）。
3. **截图验收**：本轮**没有做**视觉验收（`pnpm screenshot:capture` 需要本地站点，
   不擅自起服务）。字号改动只验到了刻度与构建，没有验到"看起来对不对"。
4. **产品负责人指认**：如果某张具体的卡片仍然是坏的，给出页面名即可 ——
   现在的对齐是**从刻度往上推**的，缺的是"哪张卡片"这条信息。
