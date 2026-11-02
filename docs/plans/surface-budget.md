# 界面控件预算（surface budget）：页头只留「图标按钮 + 一枚 ⋯」

> 立项：2026-11-02。产品负责人拿滴答清单的桌面对照图逐屏对比之后的裁决：
> 「我们目前很多东西明明可以用各种 UX 把它收进去……把所有这种铺开式组件全都删掉，全都收拢进来。」
> 前置一轮的结论在本文 §1（那份读数把"设计系统不够全面"这个猜想否证掉了）。

---

## 1. 立之前的读数（为什么不是"设计系统不够全"）

先说清楚**不是**什么。2026-11-02 实测（`grep` 命令在 §6）：

| 维度 | 实测 | 结论 |
|---|---|---|
| 字号 token | 9 档（11/12/14/16/18/20/24/30/36） | 够用 |
| `apps/web` 字号声明 | **132 处，全部 `var(--ht-font-size-*)`，裸 px 0 处** | 完全统一 |
| 颜色 token | 66 个（明暗各一份，共 132 条定义） | 不缺 |
| `apps/web` 裸 hex | **CSS 0 处，TSX 内联样式 0 处** | 严格 |
| 间距 token | 11 档 | 够用 |
| `apps/web` 实际用到的颜色 token | 40 / 66 | 有 26 个没被使用 |

所以「我们的设计系统不够全面」是**错的**，而且错得有点危险 —— 它把责任推给词表，
而词表已经是满分：门禁把"取值必须是 token"守得死死的（0 个裸值就是证据）。

真正的两条病灶：

### 1.1 字号：不是不统一，是**太统一**

132 处声明里 **116 处（87.9%）** 挤在最低三档（`2xs` 22 / `xs` 49 / `sm` 45）。
11/12/14 这 2px 一档的音量，同时承担正文、控件标签、组头、元信息、空态提示五种角色 ——
**一屏没有前景**。而 `row-title` = 16 / `row-meta` = 14 ⇒ 比值 **1.14**，读不出层级。

处理（本轮已落）：`row-title` 字重 400 → **500**、`row-meta` 字号 14 → **12**（比值 1.14 → **1.33**）。
判据从"某个像素值"改成**关系**：`packages/design-system/tests/typography.spec.ts`
的「row-title : row-meta ≥ 1.33」——谁都能调一个数，但"标题与元信息必须一眼分得开"与界面无关。

### 1.2 控件：一个功能一个控件，而**没有一条门禁在量件数**

任务视图页头当时的 9 件：

```
分享按钮（带文字） / 选择任务（ghost 文字按钮） / 批量完成 / 重复警告 / 撤销
排序文字标签（12px）+ 排序原生 select（44px 带框） / 助手图标 / 详情开关图标
```

三种控制语法并列，而排序那一条还 gate 在 `visible.length > 0` —— **空的收集箱里排序整个消失**
（排序是视图属性，不该随数据条数变形）。

列表体里另有一枚「AI 排优先级」：`ht-btn--ghost` 铺满整列 + 一个图标，夹在组头与任务行之间 ——
长得和任务行一样，而它是一次批量写入的入口。

🔴 **共同点不是"难看"，是"增加"**：每加一个功能，页头长一寸、列表体多一行，
而既有门禁**一条都不会红**（字是 token、色是 token、行高对、对比度够、行距 44–56 也在）。
原来的尺量的都是"这一件做得对不对"，没有一条在量"这里该有几件"。

---

## 2. 三条规则（这是本轮真正产出的东西）

| # | 规则 | 一句话理由 |
|---|---|---|
| R1 | **页头 = 标题 + 图标按钮 + 一枚 `⋯`**。不许出现带文字标签的常驻控件、不许原生 `<select>` | 页头形状不能随功能数量变化。加功能 = 加一项菜单项，不是加一格控件 |
| R2 | **动作不许住进列表体**。列表体里只有任务行 | 否则每一行"点下去会发生什么"都要先分辨身份，而动作行和任务行长得一样 |
| R3 | **模式 ≠ 控件**。批量选择、危险确认这类"进入某种状态"的东西，非模式态下页面上不该有它 | 常驻的"进入模式"按钮，在 95% 的时间里只是噪音 |

排序、分享、「选择任务」现在都在 `⋯` 里；批量栏只在 `bulkSelecting` 时存在；
「AI 排优先级」搬进对话助手的正文顶端（`orgActions` 槽，常驻，不是空态的一部分）。

---

## 3. 落了什么

| 件 | 位置 | 判据 |
|---|---|---|
| 共享锚定菜单（门户 + 定位 + 点外面关）—— **全仓唯一一份** | `apps/web/src/lib/menu/AnchoredMenu.tsx` + `styles/app/menu.css` | `check:menu-keyboard`（5 枚 `role="menu"` 全走同一份判断）；`task-sort.spec.tsx` 的菜单分支 |
| 键盘交给既有判断，不新写 | `packages/ui/src/control/menu.ts` + `lib/menu/useMenuKeyboard.ts` | 同上；这是仓里第 3→1 次去重（原本三枚菜单三种键盘答案） |
| 页头收拢成「助手图标 + `⋯` + 详情开关」 | `apps/web/src/App.tsx` 的 `.ht-header__actions` | `check:surface-budget` 格 1–4 + 7 |
| 批量栏改成模式态，入口进 `⋯` | 同上（`bulkSelecting` 才渲染） | `task-sort.spec.tsx`「空列表：`⋯` 仍在、排序三档仍可选、选择任务是禁用而不是消失」 |
| 「AI 排优先级」搬进对话助手 | `AssistantPanel` 新增 `orgActions` 槽；`App.tsx` 的 `aiPrioritizeAction` | `check:surface-budget` 格 5–6 |
| 字号层级修好 | `packages/design-system/src/typography.ts` | `typography.spec.ts` 的 1.33 关系判据 |
| JPEG 铺底色搬进 L0 | `packages/design-system/src/format-matte.ts`（`JPEG_MATTE_COLOR`） | `check:design` / `check:l4`（canvas 不解析 `var()`，字面量必须住 L0） |

---

## 4. 门禁 `check:surface-budget`（7 臂 + 阳性对照）

判**源码形状**，因为渲染层已经有两道判据（`task-sort.spec.tsx` / `share-entry-visible.spec.tsx`），
而它们能被"删测试"绕过；两道一起，改坏要付两次代价。

| 格 | 判据 | 红形 |
|---|---|---|
| 1 | 页头段里有且只有一枚 `task-menu-open` | 删掉 `⋯`，或给它开第二个入口 |
| 2 | 非模式段没有 `<select` | 页头再加一枚原生下拉 |
| 3 | 非模式段没有 `<label` | 把"文字标签 + 控件"塞回页头 |
| 4 | 非模式段没有 `task-sort` / `task-sort-select` | 排序以常驻控件形状搬回页头 |
| 5 | `<AiPrioritize` 只在 `const aiPanels` 之前、且只出现一次 | 动作行搬回列表体 |
| 6 | `orgActions={aiPrioritizeAction}` 仍接着 | 从助手面板上摘掉（源码里看着还在，界面上没了） |
| 7 | `.ht-header__actions` 只有一处 | 另开一个动作区绕开整道门禁 |

⚠️ 格 2/3/4 只量**非模式段**（`bulk-toolbar` 到 `bulk-exit` 之间整段切掉）：
批量栏里那枚"移动到哪个清单"的下拉是**模式内**控件。不切的话这道尺会在
"产品已经做对"的那一天红 —— 而一条指着对的产品的判据，结局一定是被人把规则删掉。
这一格是自检臂 C 抓出来的（第一次跑，合规现状就被报红）。

---

## 5. 读数（2026-11-02）

| 件 | 读数 |
|---|---|
| `apps/web` 全量单测 | **223 文件 / 2714 通过 / 2 skip**（`--testTimeout=60000`，墙钟 35.4s） |
| `apps/landing` 全量 | 24 文件 / **1455 通过**（含 #7 页头登记处 ⇔ 产品段双向等集） |
| `packages/design-system` | 546 通过（含新增的 1.33 关系判据） |
| `packages/ui` | 825 通过 |
| 与本次改动直接相关的 web spec | `task-sort` 8/8、`share-entry-visible` 5/5、`bulk-repeat-guard` 1/1、`ai-prioritize` 28/28、`ai-panel-chrome` 12/12 |
| `check:surface-budget` | 7 臂 + 阳性对照全绿 |
| 页头件数 | 9 件 → **3 件**（助手图标 / `⋯` / 详情开关），空列表下也仍是 3 件 |

### 5.1 这一轮发现的两处"判据锚在排版上"

| 现象 | 根因 | 修法 |
|---|---|---|
| `apps/landing` 的 #7 页头对账三条一起抛「锚点已失效」 | 判据锚的是整串 `<div className="ht-content">`，而那段 JSX 后来多了两个属性、被格式化成多行 | 只锚 `className="ht-content"`，再退一个 `<` 找回标签起点（排版无关） |
| `packages/ui` 的 `priorityColorToken` 唯一性判据在有 CocoaPods 的机器上红 | 目录遍历对**每个**条目调 `statSync`（连 `.h` 都不放过）⇒ 撞到 `apps/mobile/ios/Pods` 里的**断链符号链接**，`ENOENT` | 改用 `readdirSync(withFileTypes)`：`Dirent` 直接给目录与否、不跟符号链接。**注入第二份定义仍红**（验过） |

---

## 6. 复量命令

```bash
# 1.1 的读数
grep -rhoE "font-size: *var\(--ht-font-size-[a-z0-9]+\)" apps/web/src --include=*.css \
  | grep -oE "size-[a-z0-9]+" | sort | uniq -c | sort -rn
grep -rhoE "#[0-9a-fA-F]{3,8}\b" apps/web/src --include=*.css | sort -u | wc -l   # 0

# 页头件数（现在应当是 3 枚图标/入口）
node scripts/check-surface-budget.mjs --self-test

# 三套单测
cd apps/web && npx vitest run --testTimeout=60000      # 2714 passed
pnpm --filter @heyta/landing test                       # 1455 passed
pnpm --filter @heyta/design-system test                 # 546 passed
```

---

## 7. 刻意没做的

| 件 | 为什么 | 现在是什么 |
|---|---|---|
| 把 rail / 账号菜单 / 习惯菜单三份 `role="menu"` 的 **CSS** 也并进 `AnchoredMenu` | 三处各有自己的定位语义（rail 的 More 跟着 nav 朝向翻、账号菜单贴在 rail 底部）与各自的账本读数；DOM 并了但 CSS 没并，贸然并会同时动三处真浏览器腿 | 键盘已经是同一份（`useMenuKeyboard`），**样式仍是三份**。素材在 `ht-rail__more-menu` / `ht-accountmenu__panel` / `ht-habits__menu` |
| 页头那枚 `⋯` 的族名用 `.ht-header__menu` 而不是中性的 `.ht-menu` | `check:row-single-source` 的 `ht-*` 族棘轮**只减不增**（基线 28）。新开一族会被判红，而"先消掉净增再改常量"是那条规则写明的路径。并进 `.ht-header` 族 ⇒ 净增 0 | 将来三份菜单的 CSS 真并进来时，应当删掉 `ht-accountmenu` 族并把族名改成中性的 —— 那次净增是负的 |
| 移动端同步这套规则 | 本轮范围是 `apps/web`；移动端页头已有自己的模式（FAB + 溢出） | 未动 |
| 日历 / 习惯 / 成长各视图的页头 | 它们各自的动作区不在 `.ht-header__actions` 里（`CalendarHeaderToolbar` 是共享组件、靠插槽挂进来） | 未动；R1 要不要扩到它们，得先量一遍各自的件数 |
