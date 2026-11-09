# 交接 · 2026-11-09 目标模式那一轮（逆向学习 → 产品需求）

> 状态：**进行中**
>
> 写给下一个接手的人。**读完这一份就不需要再问"现在到哪了"。**
> 本文只回答四件事：**这一轮的目标是什么**、哪些关了、哪些没关、怎么接着跑。
> 判断依据与口径在 [`product-principles-2026-11.md`](product-principles-2026-11.md) 与
> [`reverse-learning-to-prd-2026-11.md`](reverse-learning-to-prd-2026-11.md)；本文不复述它们。

---

## §0 这一轮的目标（原文，逐字）

> **新会话必须知道这一段，否则会重做已完成的事、或重试已被规则否决的做法。**

```
在 heyta 仓库推进 product-principles-2026-11.md 与 reverse-learning-to-prd-2026-11.md
里已拍板的事项，全部由 agent 自主决策、不等待用户：

1. 界面信息密度减负（J1/J2/J3，不设新门禁，在现量基础上减少说明文字与 tooltip/问号图标用量）。
2. 五档字号接线（§3）：重排排印层级，让已登记但 0 消费的 13px（--ht-font-size-md）获得真实角色；
   不动 20/24/30/36 display 档。
3. R15 加密状态页：显示当前 payloadMode + 服务端可读性 + 开加密后失效功能，
   按 J1 保持界面简洁（状态一行 + 了解更多链接），不出现绝对句。
4. R19 撤销：web 壳绑定 ⌘Z/⇧⌘Z，撤销栈跨刷新（必要时跨会话），不支持的类别给出具名理由。
5. 产品结构图：把现有 ViewKey/侧栏全项画成产品功能结构图（可判读的账本形式）。
6. 补齐 §1 台账里 A 类事实错误：在不擅改规则部分的前提下，通过登记与文档修正
   清理 AGENTS.md:20 等绝对句（必要时加新 ADR，不改既有 ADR 结论）。
7. 补两道守卫脚本 check-field-single-source.mjs 与 check-global-mirror.mjs
   （P10 §7 R1/R3 要求，当前不存在），并各自带自检臂。
8. R13b 的 native 侧：让 packages/ui 的 RN 组件消费预设表面色（warm/mist），
   消除"只改 token 不改组件"在移动端不成立的空头承诺。

每一项都要：先读相关 ADR/计划；实现 + 门禁读数（贴 rc 与现量，不写"全绿"）；
证明判据能红（注入变异后再还原）；过程经验写回 docs/agents 或环境陷阱。
全部完成后提交，工作区不留下本线未提交的改动。
```

**目标没完成。八项里四项完成、一项被规则挡下并写清、三项未动。** 不要读成"收尾阶段"。

---

## §1 这一轮的 15 笔提交（全在 HEAD 祖先里）

| 提交 | 内容 | 归类 |
|---|---|---|
| `d8d5ed935` | 实装 `check:privacy-as-blocker`（§3.7 承诺了它，但 `package.json` 里 0 次） | 目标 7 的旁支 |
| `4cdbc75d5` | ⌘Z / ⇧⌘Z 接上 + 撤销栈跨刷新（引擎 `exportHistory`/`restoreHistory`） | **目标 4 ✅** |
| `a7fc099a1` | 两道守卫 `check-field-single-source` / `check-global-mirror` | **目标 7 ✅** |
| `1e7df50ec` | 产品功能结构表（13 个 `ViewKey`） | **目标 5 ✅** |
| `122daea39` | R15：设置页说出"开加密则托管 AI 用不了" | **目标 3 ✅** |
| `3dc35efbf` | 更正两处错误结论 + 登记三件"没做"（带口径） | 文档 |
| `33250aed0` | 13px 设为设置页说明句 → **下一笔被门禁打回** | 目标 2 的失败尝试 |
| `9cbcbdcd3` | 回退 13px + 删 2 枚重复/复述气泡 | 目标 1/2 |
| `3e6952139` | 加密测试判据片段跟着文案改（第三次） | 测试 |
| `86e0eb569` | 三处「服务端只接收加密内容」是假话 → 改成带条件的说法 | **目标 6 ✅** |
| `6609cf066` | 删「备份」分区那枚复述功能的问号 | 目标 1 |
| `cba2aa133` | §1.2 三条减法 + 四类靶子判据 + §1.3 剩余清单 | 文档 |
| `dc2b1094e` | 删解释「已被 ADR-0082 删掉的权限档」的那枚问号 | 目标 1 |
| `862aacbf4` | 记账：改动被并行提交带走（第二次同型事故） | 记账 |
| `3a041df8e` | §1.3 第 5 项判为「不做」—— 对外披露措辞不归 agent 决定 | **目标 6 的边界** |

⚠️ 另有 2 处改动**内容完好但被并行提交带走**（`9f8e27b3c`、`7ca0fde82`）。按文件名找，别按提交信息找。

---

## §2 现量（2026-11-09 09:2x 复读，口径逐条写明）

| 量 | 读数 | 口径 |
|---|---|---|
| 说明气泡调用点 | **45** | `grep -rho "<SettingsInfoTip" apps/web/src --include=*.tsx \| wc -l` |
| 设置页内联说明账本 | **1**（`ProfileOverview` 版本号那一行） | `node scripts/check-settings-no-prose.mjs` |
| 17 条门禁 | 🔴 **2026-11-09 09:3x 复核：`check:design` 是红的**，其余 15 条 rc=0（§5 那张块里数得出 16 条，不是 17 条） | 见 §5 命令块。红的实测：`pnpm check:design` → `🔴 17 处硬编码设计变量`，分布在 `apps/mobile/src/ui/error-boundary.tsx`（绝大多数）+ `apps/desktop/src/main.ts:91`（`padding:2rem`）。**不是本轮改出来的**：那两个文件我一个字没动，`git log` 显示 `b7f6628ef`（2026-11-08 19:27）就带进来了 |
| 六字段编辑器落点 | 各 1（`project` 另有 1 条通路=看板拖拽） | `node scripts/check-field-single-source.mjs` |
| 全局动作 | 5 个 / 镜像 2 / 例外 3 | `node scripts/check-global-mirror.mjs` |
| 撤销测试 | 引擎 14 · 通知 5 · 目标判定 6 | 见 §5 |

---

## §3 没关的四项，各自卡在哪

### ① J2 减法：剩 45 处（目标 1，进行中）

四类靶子已立判据（[`product-principles §1.2`](product-principles-2026-11.md)）：

| 靶子 | 处置 |
|---|---|
| 重复 | 删（同一句在同一位置渲染两遍） |
| 复述界面 | 删（把已看到的控件再说一遍） |
| 复述分区功能 | 删（分区里按钮已自解释） |
| **在解释一个已不存在的东西** | **删，连它描述的对象一起**（判别：这个控件现在还在不在） |
| 🔴 §3.7.2 要求必须出现的**披露** | **不许删** |
| 用户要记住的**顺序**（"先预览再合并"） | 保留 |

**下一条从哪里开始**：`AiSettings.tsx` 那 8 枚**已全部判完**（末 3 枚的逐条结论在
[`product-principles §1.2.1`](product-principles-2026-11.md)：2 保留 / 1 只删半句）。
其中 `keyNotice` 的第三个分句「桌面端会把密钥存进系统钥匙串」是**假话**，已删（依据写在
`AiSettings.tsx` 那条注释里：桌面 GUI 载的就是 `apps/web/dist`，密钥只在内存）。
⇒ 下一个最密的文件：`InboundAutomationSettings.tsx`（**4 处**）、`PasswordPanel.tsx`（**4 处**）。
⚠️ 口径是 `grep -n "<SettingsInfoTip" <文件>`。这个「处」是**JSX 调用点**，不是渲染实例：
`AiSettings.tsx:1623` 那处在通用 `Toggle` 里，它对每个传了 `tip` 的开关各渲染一枚。
所以 45 这个数别再往下拆成「用户能看到多少枚问号」—— 那是另一个量，没人量过。

⚠️ 同一事实错误在 `packages/legal/src/documents/personal-info-list.ts` 里还有一份，
**没动**（对外披露文案走 `check:legal-*`），已登记在 product-principles §1.3 #7。

### ② 字号 13px（目标 2，✅ **2026-11-09 已做**；下面是当时被挡下的经过）

> **结论先写**：13px 现在有第二个角色（设置页说明句/读数行，`md`），全局仍是 6 档、
> `xl` 一个字没动。做法不是"加一档"，而是**先让 `base` 从手写 CSS 退出**（三处标题改吃
> `ht-type-row-title` / `ht-type-headline`）+ 删掉一条零消费者的死规则（`.ht-settings__cardTitle`）。
> 读数与截图证据见 [`product-principles §3.2`](product-principles-2026-11.md) 末节。


试过一次，三道门禁逐条打回，已全部回退（`9cbcbdcd3`）：

| 门禁 | 原文 |
|---|---|
| `check:surface-budget` | `ai-panels.css 用了 6 档字号（单文件上限 5）` |
| `check:surface-budget` | `web 一共用了 7 档（上限 6）—— 加一档必须先删一档` |
| `check:design` | `[md+medium] .ht-settings__subtitle` 属**档位表外的自拼排版** |

⇒ 在这个仓库里"加一个字号档"**不是一行 CSS**，要同时做三件：
① `TEXT_STYLES` 加语义档并**整条消费**（JSX 加 `.ht-type-*`，不许手拼字号+字重）；
② **删掉一个现有档**（候选 `xl`，全 web 仅 3 处，与 `lg` 只差 2px）；
③ 逐屏看截图（`ui-acceptance` 硬规定）。

🔴 并且 13px **不是"没用过"**：它承担 `group-label`（分组标题，8 处）。
所以准确的问题不是"给它一个角色"，而是"**只有一个角色，要不要再加一个**"。

### ③ RN preset 轴（目标 8，未动）

`warm` / `mist` 只有 CSS 一种落地形式，`@heyta/ui` 的主题轴是
`scheme` / `reducedMotion` / `reducedTransparency` / `packagedFonts` —— **没有 preset 轴**。

⚠️ 但**它不是"空头承诺"**：ADR-0085 定的是"外观是本机偏好、零 op"，外观按端各自决定。
要做的话，工作是给 `resolveHeytaUiTheme()` 加一条 preset 轴；
🔴 **不许把 CSS 抄进 RN** ⇒ 那会造出第二份表面色表，`check:theme` 会红，两份一定漂。

### ④ `label` = `text` 同词条（3 处，小毛病）

`InboundAutomationSettings.tsx`、`PasswordPanel.tsx` ×2：气泡的可访问名与正文是同一句话，
读屏会念两遍。记录不硬改。

---

## §4 别再撞的墙（这一轮实测过的死胡同）

1. 🔴 **`git add` 之后立刻 `git commit`，验证放在 add 之前。**
   共享检出上，add→commit 之间插验证会让**并行会话把你的改动带进它的提交**（本会话发生 **2 次**）。
2. 🔴 **被门禁拦住时先读它怎么判，别猜着改。**
   `check:settings-prose` 是**按类名和角色**判的（`.ht-settings__hint` 本身是禁区，
   只豁免带 `role` 的载体）—— 我猜"压缩字数"改了一轮，白改。
3. 🔴 **`data-settings-readout` 标记对"类名判据"不生效**（只对长度那一条生效）。
   我加了又撤回：不生效的标记比没有标记更误导。
4. 🔴 **加词条后必须先 `pnpm --filter @heyta/i18n build`**，否则 web 测试报"词条不存在"，
   而源码里明明有 —— 现场极像"改错文件了"（`main` 指向 `dist`）。
5. 🔴 **测试判据片段必须只在被测的那一支出现。** 同一句里两处都含该片段 ⇒
   变异不红、测试变"永远通过"（加密那条改了**三次**才钉住）。
6. 🔴 **别用 `process.cwd()` 在 web 测试里找仓库根**（`pnpm --filter` 下 cwd 是 `apps/web/`，
   vitest 把 ENOENT 报成 "no tests"）；`import.meta.url` 在 jsdom 下是 `http://` ⇒ 也不行。
   从 cwd 往上找 `pnpm-workspace.yaml`。
7. 🔴 **对外披露文案（`site.docs.privacy.*`）不归 agent 改** —— 要走 `check:legal-*` 那套口径复核。
   这条**不是** §0.1 禁止的"拿合规当借口"：功能早就做了，过期的只是一句话。
8. 🔴 **别引用别人写的"门禁全绿"，自己跑一遍。** 本文件 §2 原写着「17 条门禁 全部 rc=0」，
   2026-11-09 09:3x 复跑发现 **`check:design` 是红的**（17 处硬编码，`b7f6628ef` 带进来的，
   且那个提交比"全绿"那次读数还早 14 小时）。抄读数 = 抄一份会腐烂的结论；
   这正是本仓元规则「写下来的东西必须有重新校验它的机制」的又一个实例。

---

## §5 复跑命令（每条都贴过 rc 的）

```bash
# 17 条门禁（现量全部 rc=0）
for g in check:docs check:md-tables check:ui-language check:privacy-as-blocker \
         check:field-single-source check:global-mirror check:design check:theme \
         check:overlay check:entry-table check:surface-budget check:settings-prose \
         check:font-size-discipline check:tokens check:ux-coverage check:tip-adjacency; do
  pnpm $g >/dev/null 2>&1 || echo "FAILED: $g"
done

# 本线四条判据的现量
node scripts/check-field-single-source.mjs   # 六字段各 1 落点
node scripts/check-global-mirror.mjs         # 5 动作 / 镜像 2 / 例外 3
node scripts/check-settings-no-prose.mjs     # 账本 1
node scripts/check-privacy-as-blocker.mjs    # 扫 247 个 .md

# 撤销与加密的测试
pnpm --filter @heyta/op-log exec vitest run tests/history.spec.ts
pnpm --filter @heyta/web exec vitest run tests/encryption-mode-section.spec.tsx \
  tests/history-notice.spec.ts tests/editable-target.spec.ts
```

---

## §6 事实 vs 推测（写清，别让下一个人以为是定论）

**事实（有读数或提交）**：§1 的 15 笔提交；§2 的现量；三道门禁打回 13px 的原文；
ADR-0082 已删 `assistantTier`；`@heyta/ui` 主题轴没有 preset。

**推测（未验证，动手前先复核）**：
- 删掉 `xl` 能同时满足"单文件 ≤5、全局 ≤6"——**没试过**，只是按 §3.2 的算法推的。
- ~~`supply.note` 属"必须保留的披露"——按 §3.7.2 判的，但它是 102 字符，
  可能要跟 `check:settings-prose` 的 40 字上限再谈一次。~~ **2026-11-09 已复核，疑虑解除**：
  那把尺只数 `ht-settings__hint` / `__note` / `__lead` 三种容器与 `SettingsSection note=` /
  移动端 `hint:`，**`SettingsInfoTip` 的正文根本不在射程内**（见 `scripts/check-settings-no-prose.mjs`
  文件头「什么算说明文字」）。所以 `supply.note` 交不交这 40 字上限，**不是问题**。
- 站点 `site.docs.privacy.*` 改口径的具体归口人 —— 只知道要走 `check:legal-*`。
  （2026-11-09 追加：`packages/legal/src/documents/personal-info-list.ts` 也有同一句待复核。）

---

## §7 下一轮的建议顺序

1. ~~`AiSettings.tsx` 剩 3 处~~ **已完成 2026-11-09**（详见 `product-principles §1.2.1`）。
   下一步 J2 去 `InboundAutomationSettings.tsx` / `PasswordPanel.tsx`（各 3 处）。
2. **字号**（目标 2）：先只做"删 `xl`"这一半，确认 `surface-budget` 回绿，再谈加档。
3. **RN preset 轴**（目标 8）：先读 `ADR-0085` + `check:theme` 的单源判据，再动 `resolveHeytaUiTheme()`。

⚠️ 不要再开第四件事。这一轮的教训是：一次只做一条能判准的，比铺开五条有效。
⚠️ 但 `check:design` 现在红着（§2）—— 它不算本条线的账，可**也别在任何交付话里写"门禁全绿"**。
