# Goal：全局 UX 系统整改（分层契约与四档验收）

> 状态：**九批（P0–P8）全部收口（2026-10-28），P6 那两格意思表示层于 2026-10-29 补迁完**（关闭口径收进表里新增的 `modal-deferrable` 那一行）；
> 这一行只是入口，不是裁决，也不要在这里复述任何一档的读数（那会变成会漂的抄件）。
> 审计基线：起建 SHA `244ec9d32`；本计划中的符号与账本读数在每一批开工前必须现量重取，不把本文里的行号或数量当作当前事实。
> 规范真源：[界面结构原则](../agents/ux-principles.md) §10、[浮层与反馈](../agents/overlay-feedback.md)、[设计系统](../agents/design-system.md)、[界面验收](../agents/ui-acceptance.md)。
> 本文只记录整改顺序、边界、判据与状态，不复制上述规则形成第二份裁决。

---

## 1. 一句话诊断

本仓的取值层已经较完整，真正缺的是**控件语义层、组合契约层和能证明结构正确的验收层**。因此同一排界面可以全部使用合法 token，却仍然长出多套按钮、把键盘焦点伪装成选中态、把危险确认写成普通对话框，并把“元素存在且能点”误当成 UX 通过。

整改顺序不是按页面美观度排，而是按用户损失排：

1. 先切断会丢失数据、误导危险操作、破坏键盘可访问性的路径；
2. 再补齐一份可消费的控件原语与状态矩阵；
3. 最后用账本逐页收编，不允许功能页继续绕开系统。

---

## 2. 审计证据与当前边界

本计划依据三条独立只读审计线，并已在当前检出复核：

- 设计系统与控件实现线：Web 按钮只有 primary/ghost 两档，danger 寄居在回收站 CSS，secondary 由设置页覆盖 ghost 形成；共享层没有统一 Button/IconButton。
- 交互原则线：脏表单关闭、危险确认、删除撤销、菜单键盘模型、自绘模态焦点、渐进披露与空态动作均有规范漂移。
- 门禁线：`pnpm check` 主链覆盖 token、浮层、表单解剖、单源与真实浏览器测试，但主要证明取值、元素存在和部分行为，不证明状态矩阵、空间归属与可访问焦点。

本审计不把所有原生控件算作缺陷。`<select>`、checkbox、radio、日历日期格、分段控件等可以是合理平台形态；被判定的是**同一语义存在多套状态实现、控件与控制对象分离、关闭/确认/焦点契约漂移**。

---

## 3. 分层模型与唯一落点

| 层 | 回答的问题 | 唯一落点 |
|---|---|---|
| 取值层 | 颜色、字号、间距、圆角、时长取多少 | `packages/design-system` 的 token 与 `check:design` |
| 控件语义层 | 是动作、导航、选择还是开关；每种状态怎么表达 | 共享状态判断 + Web/Mobile 各自渲染器 |
| 组合与交互层 | 控件控制谁、如何分组、如何关闭、如何回执 | `packages/ui` 浮层/菜单原语与 `docs/agents/` 原则 |
| 规范执行层 | 已有规则是否强制，存量债是否只减不增 | 共享原语入口、账本式门禁 |
| 验收层 | 上述四层是否真在运行时成立 | 源码约束、语义测试、几何/计算样式、状态截图矩阵 |

### 3.1 状态矩阵

共享判断至少覆盖：

- tone：`primary | secondary | ghost | danger`
- role：`action | navigation | selection | toggle | disclosure | menuitem`
- state：`rest | hover | pressed | selected | focus-visible | disabled | loading`

硬约束：

1. `focus-visible` 只能用独立焦点环，不得靠底色表达；否则已选中控件聚焦时画面无变化。
2. `hover` 不得伪装成 `selected`。
3. 幽灵开关 selected 保持透明底、主色前景；实底只表达主按钮权重。
4. danger 不得回落成 primary 实底。
5. 展示 chip 与交互 chip 分型；展示徽标不强制 44px，交互控件必须满足触控下限。

判断归共享层，渲染器归各端。`packages/ui` 不得 import i18n；文案由宿主通过 labels 注入。

### 3.2 空间归属

每枚页头控件先声明：

- 控制对象；
- 控件角色；
- 为什么与该对象同组；
- 窄屏保留还是进入溢出菜单。

布局插槽不能代替信息架构。左侧栏开关靠近页标题左端、右侧详情开关位于右端、日期导航与日期标题同组。

---

## 4. 分期计划

每一期必须按同一顺序完成：**先写能失败的判据 → 确认当前代码使判据精确红 → 改实现 → 回归与截图 → 人实际查看 → 更新账本与状态**。不得先改代码再补测试。

### P0：焦点安全与唯一焦点实现

**目标**：按钮、tab、菜单、select、summary、链接都有独立可见焦点环；焦点不改变背景或文字前景，已选中控件聚焦时仍能看出焦点。

**范围**：Web 全局焦点 CSS、被全局规则覆盖的局部焦点块、焦点 e2e、控制语义源码门禁、对应规则指针。

**不在本批**：不重排所有控件底色，不改组件 API，不处理危险/脏表单。

**判据**：

- 文本输入正对照臂证明探针通路可用。
- 当前已选中的 rail tab 聚焦后要求可见环，且聚焦前后背景相同。
- 日历侧栏开关的局部环不能再被全局规则吃掉。
- 🔴 **环必须"画得出来"，不是"样式里有"**：环带（盒子外扩 `outline-offset + outline-width`）
  的四边要同时落在**视口**与**每一个裁剪祖先**之内。`outline` 会被 `overflow` 非 `visible`
  的祖先裁掉，而"控件铺满滚动容器的内容宽"在本仓是一族 —— 现量：rail tab 环带
  `top 65 / left 7 / right 57` 对容器 `.ht-rail__tabs` 的 `68 / 10 / 54`，三条边被切，
  图上只剩底下一条线。计算值 `outline-width: 2px` 是绿的，画面是坏的。
  修法是那一层把 `--ht-focus-ring-offset` 指成负数（表集中在
  `apps/web/src/styles/app/borderless-controls.css`），**不**在那一层再画一枚环。
- 全键盘扫描：逐视图（任务/日历/习惯/便签/回收站）× 两档宽度（1440/375），
  键盘走到的每一枚控件都量一次 —— 这条是全称命题，新出现的滚动容器会自己报出来。
- 宽/窄、亮/暗各代表性控件的未聚焦与键盘聚焦截图。

**能红**：把全局环改回 `outline: 0`，局部环探针与已选中控件探针必须红；
把 `--ht-focus-ring-offset` 从滚动容器那张表里删掉一条，全键盘扫描必须红。

**完成定义**：焦点实现收成一个入口；冗余局部环删除；新门禁进入主链；截图逐张查看。

---

### P1：脏表单关闭保护

**目标**：任何有未保存输入的浮层，scrim、Esc、X 三通道先询问是否放弃，不能静默丢内容。

**范围**：添加习惯、日历快速捕获、加入共享清单、共享邀请浮层；补 `popover-dirty-form` 模型，接入既有 `closePolicyOf`、`dismissActionFor`、`OverlayModal`。

**不在本批**：不迁所有模态；法律同意面板保持现有强制确认形态；不建立第二套 discard 对话框。

**判据**：干净态可关闭；脏态关闭三通道只触发确认且原值仍在；取消确认后焦点归还原控件；选择放弃才卸载。

**门禁**：含受控输入且自报 dialog/aria-modal 的落点必须显式登记脏策略；账本只减不增。

**交付（2026-10-27）**：

- 共享层补上 `popover-dirty-form` 那一档（`packages/ui/src/overlay/dismissal.ts`），三通道一律 `ask-discard`、
  不自动消失、必须有显式关闭钮；契约在 `packages/ui/tests/overlay-dirty-popover.spec.ts`（含一枚对照臂：
  普通 `popover` 仍全是 `dismiss`，防止这一档把锚定层整体改宽）。
- Web 侧接线收成一个入口 `apps/web/src/lib/form/useDirtyDismissGuard.tsx`：判断只问共享那张表，**渲染就地**
  （成因与否证见 §7 第 606 条）。
- 接了保护的落点：**5 格** —— 计划点名的四格（添加习惯、日历快速捕获、加入共享清单、共享邀请面板）
  加**门禁自己现量出来的第五格** `CategoryCreateDialog`。立项时谁都没提它，这条门禁的价值就在这儿。
- 门禁 `scripts/check-dirty-form-policy.mjs` 已接进 `pnpm check`（定义 `check:dirty-form-policy`，
  自带四枚自证臂每次一起跑）。它登记**两种**非绿读数：`verified-exempt`（现量只有 `AuthPanel`，理由是
  凭据不是用户 authored 的内容，并写了翻案条件）与 `owed`（**欠判定，计入分母、只减不增**）——
  没核过的格子不许写成豁免，那等于给缺陷上户口。
- ⚠️ 臂 ② 第一版红过，且红的是夹具不是判据（合成树里只有假文件，账本 8 格全读成"不再是候选"）；
  修成配对臂后 `coverage` 那条单独成函数。棘轮下限（已接保护的格数掉了就红）补的是另一种失法：
  接了保护的那几格不在任何表上，形状一漂出门禁看不见。
- e2e `e2e/tests/dirty-form-guard.spec.ts` 逐条满足判据：干净可关（对照臂）、脏三通道只触发确认且原值仍在、
  取消后焦点归还原控件、选"放弃"才卸载。

---

### P2：危险确认收编

**目标**：不可逆动作只有一套危险确认语义，档位由 `resolveDangerTier` 派生，不在界面层比字符串。

**范围**：回收站 purge、Vault 设备移除等 Web 原生确认/自绘危险框。

**边界**：不改变 ADR-0048 四态；不承诺“X 天内可恢复”；对不可撤销动作不给撤销出口；移动端原生 `Alert.alert` 留待共享原语可消费后再清。

✅ **那一格已判定并落地（2026-10-29）**（下面 2026-10-28 的原文按现量改口，保留判断过程）：`apps/web/src/features/settings/AiSettings.tsx` 的
「重置 AI 设置」是**就地两档确认**（`role="alert"` 的清单 + danger 主按钮），门禁 R1/R2 都过（无 ×、主按钮是 danger），
但它**没有问过那张表**。这格的档位只取决于一个尚未写进任何文档的判断 ——
**清掉用户填的 API 密钥算不算 `destroysIrrecoverableResource`**：

```sh
# 现量（两种答案差一档，且第二档要求模态表态）
node --input-type=module -e "import {resolveDangerTier, requiresModalCommitment as r} from './packages/domain/dist/index.js';
const s=(d)=>({affectedCount:1,undoAvailable:false,destroysIrrecoverableResource:d,collateralImpact:0});
console.log(resolveDangerTier(s(false)), r(resolveDangerTier(s(false))));
console.log(resolveDangerTier(s(true)),  r(resolveDangerTier(s(true))));"
```

⇒ 不算 ⇒ `popconfirm`，那一格的就地形状本来就够；算 ⇒ `alert` ⇒ **需要模态表态**，就地那层就是欠一层。

🔴 **裁决：算**（2026-10-29，产品口径由本线拍）。三条依据都在界面上写着，不是推测：
代价清单第 4 条逐字是「存在这台设备上的密钥与令牌」；这一格没有撤销出口，而同一块上那句
`keepsCorrections` 恰恰说明**只有**纠正过的偏好跟着 op-log 走，密钥不在那一档；密钥是**打码存的**，
用户看不到自己填过什么 ⇒ "再输一遍"不等于"恢复"，他得回服务商控制台重新取。
⇒ 与撤设备同一结论：这类动作"可撤销"的前提不成立，重档模态确认是正确结论，不是欠账。

**已落地**：`apps/web/src/features/settings/AiSettings.tsx` 那一格换吃 `DangerConfirmDialog`
（档位由新落点 `settings/resetAiDanger.ts` 派生，界面只读结果），三条通道与焦点不再由宿主各写一遍。
判据四档齐：源码尺 `check:danger-confirm` 现量候选 **3 格 / 违规 0**（并把眼睛验过 —— 临时把原语摘掉
⇒ 读数 3 ⇒ 2，还原后回 3）；语义测 `ai-settings.spec.tsx` **80 条**（原 79 条一字未改全绿 + 新增一条
钉"模态 + 焦点在安全侧 + 背景不关 + Esc 等价取消"，且那句焦点断言就是裁决的锚：把
`destroysIrrecoverableResource` 改回 `false` 精确红在它上面，还原 `cmp` 一致）；真浏览器
`e2e/tests/ai-reset-danger.spec.ts` **2 条**（亮暗各一）；图 `apps/web/evidence/ai-reset-danger/confirm-{light,dark}-1440.png` 逐张看过。

**判据**：无 X；安全动作初始焦点；背景不可确认；Esc 等价取消；危险主按钮使用 danger；焦点不逃出对话框；关闭后归还触发者；失败回执持续可见。

**能红**：手填 `undo` 降档应导致契约测试红；重新加 X 或改回 primary 应导致几何/源码门禁红。

**现状读数（2026-10-27 立项后补，会漂 —— 逐条给现量命令，别抄数）**：

- 🔴 **`resolveDangerTier` 与 `requiresModalCommitment` 零调用点**：现量
  `grep -rn 'resolveDangerTier(\|requiresModalCommitment(' packages/*/src apps/*/src`
  ⇒ 只命中 `packages/domain/src/danger-tier.ts` 里那两行**定义**，加上 `packages/ui/src/overlay/DangerDialog.tsx`
  文件头**两句注释**（注释里说"宿主拿到 tier 后要用 `requiresModalCommitment()` 收窄"—— 今天没有任何宿主这么做）。
  同一条查法要**限定到 `src`**：不限定的第一发会吃进 `apps/*/dist/*.map`，11.9 MB 的源映射把"调用点"数成一堆假命中。
  ⇒ 档位派生这一层**写完了、单测绿了、界面一行没用** —— 正是本轮审计的全局病灶（规范 / 代码 / 界面三层断了中间那一环），
  不是"缺一个函数"。P2 的第一件产出物因此是**一枚真消费者**，不是再补单测。
- 🔴 **`DangerDialog` / `OverlayModal` 在两端也都没有消费者**：`grep -rln 'DangerDialog\|OverlayModal' apps/*/src`
  在 Web 只命中 `useDirtyDismissGuard.tsx` 的**注释**（那两句讲的正是"为什么这里不用它"，见 §7 第 606 条）。
  ⇒ "共享浮层原语零消费者"不是 P6 才开始的事实，而是**现在时**；P2 若直接把回收站那格迁进 `DangerDialog`，
  会同时撞上第 606 条那格未判定的坑 ⇒ **P2 先用 Web 就地画的那一层做危险确认语义与 tone 的收编，`DangerDialog` 的接入等 P6 前置**。
- **回收站"彻底删除"那格**：自绘确认层（`apps/web/src/features/trash/TrashView.tsx` 里的 `role="dialog"` + `aria-modal="true"`），
  不可逆主按钮用的是 `ht-btn--primary`（蓝）而不是 danger tone ⇒ 判据"危险主按钮使用 danger"当场红。
  现量：`grep -n 'ht-btn--primary\|ht-btn--danger' apps/web/src/features/trash/TrashView.tsx`。
- **Web 上真·原生框只剩一格**：`window.confirm` 现量 `grep -rn 'window\.confirm(' apps/web/src` ⇒ 只有 Vault 设备移除那一格
  （`apps/web/src/features/sync/VaultSettingsPanel.tsx`）。其余几处看着像的 `confirm(` 是**本地同名函数**，不是原生框
  —— 按名字数会把它们错记成缺陷（`check:overlay` 的 R1 账本按形状扫，所以数得对）。
- `.ht-btn--danger` 变体已在 P0/P1 那一趟落进 `apps/web/src/styles/app/controls.css`（透明底 + danger 文字），
  **填充式危险按钮不在本批**：那要先补 `on-danger` 语义 token（现在没有），它属于 P4。

---

### P3：删除撤销与回执链

**目标**：单条与批量删除在真正可撤销的实体上采用同一恢复策略，失败不得静默。

**范围**：任务、便签、清单、习惯的可撤销删除；批量 undo 计时与失败回执；移动端同语义计时。

**边界**：tag、purge、注销、撤权、分享发布、AI 出网、数据销毁六格不得给撤销承诺。时长、暂停和失败回执不能成为第二套本地业务判断。

**判据**：删除成功出现带对象数量的 undo；hover/focus 暂停计时；过期自然消失；撤销失败保留可见 `role="alert"`；不可撤销档位不出撤销按钮。

**现状读数（2026-10-28 立项时取）**：

⚠️ 这一组是**立项前**的形状，本期已经把下面每一格改掉 ⇒ 那些行号与那几条 `grep`
今天大多读回 0（这正是 §6 "带时态的声称"那条在册的坑）。要**现在**的量请跑
`node scripts/check-undo-receipt.mjs`（它自己打违规候选、已接落点与账本条数）。
留这一组不是为了存档，是因为**判据的靶子必须是修之前的形状** —— 没有它，
"改完了"这句话就没有可比的东西。

- 🔴 **本仓 0 套 toast/共享回执**，而有 **4 处各写各的 5000ms 撤销窗口**：
  现量 `grep -rn "setTimeout(() => set[A-Za-z]*[Uu]ndo" apps/web/src apps/mobile/src`。
  其中 `apps/web/src/App.tsx:523`（批量）与 `QuadrantBoard.tsx:223`（移动）各配一枚**没有暂停**的裸 `<button>`，
  移动端 `TasksScreen.tsx:732,740` 是同形状的第三、第四处。
  ⇒ 时长这一格在代码里**根本没有权威**：`dismissal.ts` 的文件头明写"Toast/Snackbar 不在那张表里，
  规则在时长那一条上"，而那条一直没人实现。这就是本期的第一产出物。
- 🔴 **撤销失败被咽掉的两格**：`App.tsx` 那枚按钮的 `onClick` 是 `void action.run()`
  （reject 直接掉地上）；`QuadrantBoard.tsx:391` 把失败写进 `role="status"` 那句成功文案里 ——
  读屏用户听到的是同一类消息，而"没撤销成"和"撤销成了"是两回事。
- 🔴 **四条单条删除里三条一个回执都不给**：任务（`App.tsx:1702`）、便签（`NotesView.tsx:113`）、
  清单（`ProjectsPanel.tsx:334`）、习惯（`HabitDetailCard.tsx:230`）。四家的删除都是**进回收站**
  （ADR-0048 的 `deletedAt`），撤销真的可执行 —— 不给出口等于把"捞回来"的门槛
  从一次点击抬成了"知道回收站在哪儿"。
- ⚠️ **四家的 `restore*` 返回布尔而不是抛错**（`tasks/store.ts:107`、`notes/store.ts:71`、
  `projects/store.ts:54`、`habits/store.ts:70`）⇒ 直接把布尔递给回执会把它读成**成功**：
  回执整条消失，屏幕上什么都不剩，而对象还在回收站里。所以接线必须过一枚
  `restoreOrRefuse`（把"没恢复成"变成一次拒绝），四处共用一份。
- **撤销资格不在界面层判**：判据是 `@heyta/domain` 的 `isUndoableDeletion()`
  （名单正文 = ADR-0048 的四态），标签那一格恒假（`§7.1 P-1` 标签不进回收站）
  ⇒ 判据"不可撤销档位不出撤销按钮"由这一枚函数保证，不靠门禁数按钮。

---

### P4：共享控件语义层

**目标**：补一份状态判断与两端薄渲染，结束 primary/secondary/ghost/danger 多头定义。

**范围**：新建共享 `control/states` 判断；Web CSS 变体收编；Mobile `Button`/`IconButton` 转薄壳；toggle 的 selected/expanded 状态；Provider 登记与 `packages/ui` 导出追加。

**不在本批**：不在共享层造第三份 RN 渲染器；不批量迁移所有按钮；不要求 Web 与 Mobile 版面逐像素一致。

**判据**：tone/role/state 穷尽矩阵；功能 CSS 不得再声明交互控件外观；Web 计算样式逐态读取；Mobile AX 状态回读。

---

### P5：共享 Menu/Popover 键盘模型

**目标**：视觉相同的菜单拥有相同键盘行为，关闭后焦点回触发者。

**范围**：Rail More、习惯 More、已有 AccountMenu；抽出 roving menu 判断，不在三处复制事件处理。

**判据**：ArrowUp/Down 环游、Home/End、类型查找、Esc、焦点进入和归还；嵌套 dialog 不抢外层焦点组。

---

### P6：自绘浮层迁移

**目标**：把 `OverlayModal`、`DangerDialog`、`BottomSheet` 从零消费者推进为真实消费者，逐步清空既有债务账本。

🔴 **P6 原本的隐含前提是错的，2026-10-27 由 P1 现量否证**：这一档写的是"迁到 `OverlayModal`"，
而 `OverlayModal` 的外壳是 react-native-web 的 `Modal`。P1 第一次在真实浏览器里用它时，那一层没出现、
零 console 报错，同一棵树上 jsdom 契约测试全绿（逐条读数与已排除的假设在 §7 第 606 条）。
P1 的出路是**判断留在共享表、渲染分端**（Web 就地画确认层）。
⇒ **开工前置**：先跑第 606 条那句定死成因的断言（真浏览器里同量三项：`document.body` 子节点增量、
`[aria-modal]` 计数、`[role=dialog]` 计数）。
读 RNW 源码已知的形状是 `aria-modal` 无条件、`role="dialog"` 取决于 `active`，而 `active` 来自
`ModalAnimation` 的 `onShow`（只有 `animationType !== 'none'` 时才靠 `animationend` 触发）
⇒ 三种读数**互相不一致**＝"挂载了但没激活"（那 P6 仍可迁，只是 role 定位与焦点陷阱要另修）；
**全为 0**＝"没挂"（那 Web 侧的迁移目标不是 `OverlayModal`，而是先把外壳换成 Web 原生 portal）。
**这一格没量出来之前，不许按"能迁"排 P6 的工期，也不许把 `use-modal-dismiss` 的退役排在它后面。**

✅ **2026-10-28 这一格量完了，前置解除**（装置：`apps/web/probe/overlay-modal.html` +
`e2e/tests/overlay-modal-mount-probe.spec.ts`；读数落 `apps/web/evidence/overlay-modal-mount/probe.json`）：
真 Chromium 里 `ariaModalCount=1`、`roleDialogCount=1`、内容在 DOM、而 `bodyChildDelta=0`。
⇒ **`OverlayModal` 挂载了、也激活了**（`role="dialog"` 在场说明那条 `onShow` 真跑到了），
但 RNW 的 `Modal` 在 Web 上是**就地渲染、不 append 到 `body` 末尾**。
所以两件事要分开说：
  · **可以按"迁到 `OverlayModal`"排 P6**；
  · 但焦点陷阱与 `[role=dialog]` 定位必须按"就地渲染"写 —— 祖先的 `overflow`/`z-index`/`contain` 全都算数，
    这正是第 607 条那格 `popover(500) > modal(400)` 倒挂的机制来源。
**那两条候选已分开（同趟，同一枚探针加两发对照）**：同一次任务里"点完立刻读" ⇒ 三项全 0，
与 P1 那晚逐字相同 ⇒ **是"测早了"，不是"被宿主挡住"**。
⇒ 本期的量法纪律：**量浮层之前必须先等 commit**（跨一次往返或等一帧）——
同任务里点完就读，量到的是"还没渲染"，而它与"渲染不出来"长得一模一样。
（②没有被单独否证，它不需要出现就能解释这次读数，所以它不再挡 P6 的路。）
完整三发读数与归族见 §7 第 610 条（第 606 条的观察本身不改，改的是它被读成的那句一般命题）。

**顺序**：AuthPanel → CategoryCreateDialog → ConflictDialog → Trash 余壳 → App 其他模态 → 退役 `use-modal-dismiss`。每迁一枚先定向跑该面 e2e，再删账本一行。
⚠️ 2026-10-28 实到之后更正两点：① **顺序按"语义是否已对得上表"排，不按文件位置排** —— `CategoryCreateDialog`（现量 Esc 关 + 背景关 + 含表单 = `modal-dirty-form`）是纯机械迁移，先做；
`AuthPanel` 现有"Esc 关、背景不关"在表里**没有对应行**，迁它等于改关闭口径，要单独拍；
② 每迁一枚要同时盯**四格**：testID 保号、可见**且可点**（`toBeVisible()` 不算可点）、表单提交、标题可访问名 —— 后两格共享层的 `View`/`Text` 形状装不下，只能留在 `children` 里靠真浏览器复量。

**最大回归风险**：DOM 形状改变导致 testID 丢失。迁移必须显式传 testID，并以"账本与扫描面交集为空即红"的探针防门禁自己变瞎。

✅ **那枚探针已验证两向都有牙（P6 立项那行写的是**要求**，今天它是**已验证的事实**）** —— 就在既有的
`scripts/check-overlay.mjs` 里，**不需要为 P6 新建门禁**：
```sh
# A) 账外加一处自绘标记（aria-modal 1→2）
cp apps/web/src/features/categories/CategoryCreateDialog.tsx{,.mut-bak}
perl -0pi -e 's/(\s+)aria-modal="true"/$1aria-modal="true"$1      aria-modal="true"/' apps/web/src/features/categories/CategoryCreateDialog.tsx
node scripts/check-overlay.mjs   # ⇒ rc=1「R2 自绘模态变多：… 现量 2 > 账本 1」
cp apps/web/src/features/categories/CategoryCreateDialog.tsx{.mut-bak,}   # cmp 逐字一致
# B) 反向：摘掉它那一层（模拟"迁走了但账本没跟着改小"）
perl -0pi -e 's/\n\s+role="dialog"\n\s+aria-modal="true"//' apps/web/src/features/categories/CategoryCreateDialog.tsx
node scripts/check-overlay.mjs   # ⇒ rc=1「R2 账本里的文件不再被扫到：…」
```
⇒ 迁每一枚之后**删账本那一行**这件事是被 B 那一向逼着的，不靠人自觉。

🔴 **开工前新量出来的第二个前置（决定每一枚的成本，先定方向再动手）**：
`OverlayModal` 自己渲染 layer / scrim / panel / header / title / close / body / footer 八块，
样式全在它内部的 RN `StyleSheet` 里，**没有任何宿主类槽**；而 Web 这些待迁的壳
（`AuthPanel` 的 `ht-sheet__auth*` 两栏、`CategoryCreateDialog` 的 `ht-category-create-dialog__*` + `<form onSubmit>` + `<h2>`）
都带自己的 CSS 族与**语义元素**。⇒ "迁到 `OverlayModal`"只有两条路：
  ① 给共享层加宿主类槽（`DangerConfirmDialog` 当年正是因为缺这个才自己画了一层，见 §7 第 606 条）；
  ② 重写宿主 CSS 去贴共享层的 DOM（成本落在每一枚上，且会动到 `check:design` 盯的那些格子）。
🔴 ** 已被实测否证（同日，本线自己拍的、自己推翻的）**：给一枚 RNW `View` 传 `className="probe-classname-on-view"`，
真浏览器里 `document.querySelectorAll('.probe-classname-on-view').length` 实测 **0** ——
RNW 的 `View` **不透传 `className` 到 DOM**。所以"宿主类槽"这件事在 `OverlayModal` 的
RN 结构上**根本落不了地**，①不是"成本高"，是不存在。

**⇒ 方向改拍 ③（2026-10-28，本线自决）：Web 侧的迁移目标不是 `OverlayModal`，而是一枚 Web 原生共享壳。**
理由：本线已经有两枚先例走的都是这条路 —— P1 的 `useDirtyDismissGuard`（判断共享、渲染分端）
与 P2 的 `DangerConfirmDialog`（Web 原生 portal 壳 + 查同一张 `closePolicyOf` 表）。
所以 P6 的形状是：**新增一枚 Web 原生模态壳**（portal + `role="dialog"`/`aria-modal` + 焦点陷阱 +
三条通道全查 `dismissal.ts`），Web 各壳往它身上迁；`OverlayModal` 留作原生端那一枚壳；
**两枚壳共用同一张策略表**，`use-modal-dismiss` 迁完后退役。
②（重写宿主 CSS 去贴 RN 的 DOM）随 ① 一起作废 —— 它贴的那套 DOM 拿不到宿主类名，等于要连布局一起重写。
③ 同样保住那条最值钱的性质：**宿主 CSS 不动 ⇒ 零视觉变化**，
所以"迁完还是那样"这件事可以用截图证；而策略判断仍然只有一张表，
不会出现"Web 一套、原生一套"的第二份答案。
🔴 一条附带的硬约束：**类槽不许空着落地**——加槽必须与第一枚真消费者同趟走
（`check:selection-single-source` 判据 D 罚的就是"槽位建了、界面上没有"）。
第一枚消费者定为 `CategoryCreateDialog`（275 行、外壳单一、`category-dialog-ux` 与
`dirty-form-guard` 两套 e2e 已在册）。
⚠️ 迁移那一趟要额外盯的两格（共享层是 `View`/`Text`，宿主的 `<form onSubmit>` 与 `<h2>` 待不进结构里）：
**表单提交**与**标题的可访问名**必须真浏览器复量，jsdom 契约测证不到这两格。
另：`<form>` 与 `h2` 这类语义元素在共享层是 `View`/`Text` —— 迁移时它们只能待在 `children` 里，
所以"表单提交/标题可访问名"两格必须在每一枚迁移后**真浏览器复量**，不能只靠 jsdom 契约测。
⚠️ 第二条回归风险是本轮新登记的：**层画出来了但够不到**（§7 第 607 条，`popover(500) > modal(400)` 倒挂）。
迁移每一枚时"可见 + 可点"两件事都要量，`toBeVisible()` 不算可点。

### P7：页头原语、Chip 分型与空态动作

🔴 **P3 顺带登记给本期的格（2026-10-28，看图照出来的，不是 P3 引入的）**：
象限那一格撤销回执住在 `QuadrantBoard` 的**尾部**（脚注 `details` 之后），
所以 1280 宽档上"任务被移进了中间那一格"与"撤销移动"那枚按钮隔着一整个板面 ——
回执说的动作发生在板上，出口在页底。原来那个裸按钮也在同一处 ⇒ **不是回归，是旧形状**，
但它是本期的主题（空间归属决定动作该住在哪儿）。取证：
`apps/web/evidence/undo-receipt/quadrant-receipt-1280.png`。
判据：回执与它说的那次变更**在同一块区域内可见** —— 不要求像素相邻，要求不需要滚动去找。

**范围**：日历 capture/reset/view controls、交互 chip、展示 badge、EmptyState 动作槽；按控制对象重排页头。

**边界**：Web 原生 select 与移动端分段控件可以不同；不能把所有 chip 都撑成 44px；不能新开 CSS 族绕过族基线。

**判据**：同排控件高度只有一档；交互目标 ≥44px；展示徽标不增高；空列表、无权限、失败态有正确动作，纯无内容态不制造假动作。

### P8：渐进披露与四档验收收口

**范围**：任务详情属性组默认展开策略；建立全局控件状态覆盖矩阵；把 P0-P7 的可复用探针接入主链。

**四档验收**：

1. 源码约束：谁消费原语、功能 CSS 不得重声明外观。
2. 语义测试：role、ARIA、控制目标、状态同步。
3. 真实浏览器：相对几何、同排高度、计算样式、焦点与状态。
4. 截图矩阵：宽/窄、亮/暗、默认/悬停/选中/焦点，且人实际查看。

---

## 5. Web、Mobile 与共享层边界

| 必须一致 | 可以不同 |
|---|---|
| 关闭策略、危险档位、控件 tone/role/state、表单字段判断、ARIA 语义、撤销资格、空态该不该给动作 | 对话框/全屏卡片、页头/把手位置、原生 select/分段控件、动画与手势、动作条常驻方式 |

共享层拥有判断，端侧 kit 拥有渲染；功能页只拥有布局、显隐、宽度与业务动作接线。

**P1 的一条真实端差（不是"某一端漏做了"）**：移动端 `TaskDetailSheet` 的关闭是
**提交式**的 —— `onBlur={commitTitle}` / `onSubmitEditing`，且 `close` 在关之前先跑
`commitTitle(); commitNote();`（`apps/mobile/src/screens/TaskDetailSheet.tsx:318-323`）。
所以那一格**不丢内容**，`ask-discard` 不适用；给它加一道"放弃修改？"反而是把成本
转嫁给每一次正常操作。Web 侧之所以要问，是因为它的草稿住在组件本地 `useState`
且卸载即丢。⇒ 两端的**结果**必须一致（不静默丢内容），**手段**允许不同：
一端提交、一端先问。判据按结果下，不按手段下。

---

## 6. 账本与防误判

新门禁采用显式登记与账本制，不用“按钮标签/类名形状”一刀切：

- 原生 `<select>`、checkbox、radio、日期格、tab、menuitem 必须按角色分档。
- 展示 chip 与交互 chip 必须显式登记 kind。
- 每个豁免项写理由；已登记条目必须在当前树仍能命中，否则门禁红。
- 账外新增红；账内读数上涨红；读数下降却不同步账本也红。
- 起步基线必须由脚本现量打印，本文不抄会漂移的数字。
- 🔴 **扫描类判据要写清它量的是哪一分母**。P0 那条全键盘扫描量的是
  "默认态下 Tab 走得到的每一枚控件" ⇒ 它**不覆盖**关着的抽屉、收起的「更多」菜单、
  未打开的对话框里的控件。把这一条读成"全仓焦点都已验过"就是拿一层的读数当整类。
  那些面各有自己的定点判据（`rail-geometry`、`habit-create-shape`、`keyboard-cursor` 等），
  覆盖率的分母由那一份份 spec 各自负责，不在这条扫描的账上。

---

## 7. 依赖、冲突热点与停止条件

**依赖**：P0 是 P4/P5/P7 的状态表达前提；P4 是 Mobile 危险确认迁移前提；P1/P2 可复用现有浮层契约，不等待 P4；P6 必须在 `packages/ui` 重建后验收。

**冲突热点**：`App.tsx`、`HabitsView.tsx`、Web CSS 聚合、`packages/ui/src/index.ts`、i18n 词条和 Playwright helpers。同一文件不得并行改；主链 `check` 是串行热区。

**停止条件**：

1. 需要 bump schema 或改不可逆线协议：停，另走 ADR。
2. 需要改变 ADR-0048/0054 等既有决策：停，新写决策。
3. 需要覆盖并行会话未提交 hunk：停，先核对归属。
4. 新门禁无法在违规夹具下红：先修探针，不带病继续。
5. 同一批连续两次出现“改判据让它变绿”：停止并复盘。
6. 为 UX 整改引入新的第三方依赖：先过可维护性与许可证两道门，否则不实施。

---

## 8. 执行状态

| 批次 | 状态 | 完成证据 |
|---|---|---|
| P0 焦点安全 | ✅ 已收口 | 实现收成一个入口（`borderless-controls.css`）+ 裁剪容器例外表集中在同一处；门禁 `check:focus-single-source` 已在主链（`node scripts/check-gate-wiring.mjs` 现量链路段数）。**环"画得出来"用真实浏览器几何判**：`focus-visible-matrix` 里环带四边对裁剪祖先逐边比 + 5 视图 × 2 宽度的全键盘扫描。能红验过两次（删表里一条 ⇒ 扫描精确红，从 `/tmp/bc.mut-bak` 还原 `cmp` 逐字一致）。截图逐张看过 `selected-tab-1440-dark`、`calendar-focus-375-dark`、`calendar-focus-1440-light`：四边环都在、选中态不再靠底色块。16 套相关套件串行重跑 **82 passed / 1 failed**，那 1 条是旧契约（见 P1 行）。 |
| P1 脏表单 | ✅ 已收口 | 共享层补 `popover-dirty-form` 档（契约 5 条含"普通 popover 仍全 dismiss"的对照臂）；Web 侧一个入口 `useDirtyDismissGuard`，**判断共享、渲染分端**（成因见 §7 第 606 条）。接线落点 **5 格** = 计划点名 4 格 + 门禁现量出的第 5 格 `CategoryCreateDialog`。门禁 `check:dirty-form-policy` 四臂 + 保护棘轮，真树两次变异取证（摘保护 ⇒ 两条红；两个 dialog 标记一起漂 ⇒ 棘轮单独红），均从 `.mut-bak` 还原并 `cmp` 一致。**旧契约按作用面找全**：`category-dialog-ux`／`calendar-capture`／`collab-journey` 同跑全绿，同一族只有 `habit-create-options` 那一格钉着"取消即静默丢弃"，已改走新契约并复验绿。 |
| P2 危险确认 | ✅ Web 侧收口（移动端腿按边界留待共享原语可消费；§P2 那格"未判定"已于 2026-10-29 判定并落地，四档读数见本节末段） | 回收站"彻底删除"＋ Vault 设备移除两格都收进 `apps/web/src/lib/dialog/DangerConfirmDialog.tsx`：× 出口删除、主按钮 danger tone、初始焦点给安全侧、Tab 不外逃、关闭归还触发者、scrim 不响应、Esc 等价取消，**档位第一次真的被派生**（`purgeDanger.ts` 是 `resolveDangerTier` 在全仓的首个运行时消费者）。Web 侧 `window.confirm` 现量归零（`node scripts/check-overlay.mjs` ⇒ 原生框 **7 处 / 4 文件**，剩下的都在共享层与移动端）。门禁 `check:danger-confirm` **七臂**、真树读数 违规 2 ⇒ 0（现量 `候选 3 格 / 违规 0 条 / 账本 0 条`），且**候选下限**那条治住了"迁完之后门禁自己看不见东西"这种绿；`--self-test` 里 ⑤/⑥ 两臂专治"同一个缺陷换个 JSX 写法就漏"。单测 6 条含两枚对照臂，并**否证了本计划原先那句能红口径**（"翻 `undo` 会降档"指错开关，真开关是 `destroysIrrecoverableResource`，短路顺序在 `danger-tier.ts:131`）。e2e：回收站那格 **13 条全绿**（N2 那枚 Esc 回归是我上一趟删了旧监听没接回去，已修并复跑）；Vault 那格单跑 **3 条全绿**，判据最后一格"失败回执持续可见"补了独立一条 —— 撤销打 401 后回执**过 5.5 秒仍在**，并用一枚真变异（在 `.catch` 后加 4 秒自清计时器）证明它**只红第二发**、第一发照绿，还原后 `cmp` 逐字一致。截图按 `switchTheme` + `data-theme` 逐张看过（第一版用 `classList.add('dark')` 拍出来的"暗色"是假的，已重拍）。 |
| P3 删除撤销 | ✅ Web 收口（移动端换了计时语义；回执 UI 归 P4） | 时长那一格第一次有了权威：`packages/ui/src/feedback/receipt-timing.ts`（`undo` 8000ms + hover/focus 双暂停 + 失败恒不自消；`notice` 4000ms 且**不许带动作**），契约 5 条 + 两枚真变异（8000→5000 只红"下限"那条；摘掉 `pauseOnFocus` 只红 focus 那条），还原 `cmp` 逐字一致。Web 渲染收成一个入口 `apps/web/src/lib/feedback/UndoReceipt.tsx`，单测 7 条含 `kind="notice"` 对照臂（**把 8000 抄进组件的话这条先红**）与"失败推进 10 倍窗口仍在"。接线 **5 格**：批量删除（正文改成带条数那句）、单条任务／便签／清单／习惯（原来三条一个字都不给），象限移动回执一并收编。四家 `restore*` 返回布尔这件事由一枚 `restoreOrRefuse` 统一变成拒绝 —— 直接把布尔递给回执会把它读成"成功"。移动端两处 5000ms 改读同一张表（门禁账本因此清零，只剩 `ShareFeature` 那格**复合动作不给撤销**的豁免，带翻案条件）。门禁 `check:undo-receipt` 七臂已进链（链段 137⇒138，`check:gate-wiring` 绿）。⚠️ 两枚自证臂当场是坏的、被抓出来才修：R1 谓词的前缀写成 `[^)]*` 会**恒读 0**（永不红的尺），棘轮那臂断"下限 + 1 必红"测的是我对下限的猜测而不是尺能不能红。🔴 **看图照出一枚我引入的回归**：收编象限回执时把旧的 `.then(() => setDropNotice(''))` 连着旧形状一起删了，末帧上留着一句已经不成立的"任务已移动到「交给别人」" —— 已修（撤销成功才收那句）并补了一条 `toHaveCount(0)` 断言，让它下次红在断言而不是红在图上。 |
| P4 控件原语 | ✅ **A2+A3 已落地，移动端设备腿 2026-10-28 补跑并逐张人眼看过 ⇒ P4 收口**（四档 + 重量档 + 禁用档在设备上都有现量读数，触屏没有 hover 这一态写在证据格里） | **A2（Web 侧档位收编）2026-10-28 落地**：共享表 `packages/ui/src/control/states.ts` 加**重量档** `ControlEmphasis`（`inline` 默认 / `commit`）与 `hasCommitOverride`，覆盖表里只有 `danger` 有条目；新 token `color.on-danger`（亮 `--ht-white` 4.83:1 / 暗 `--ht-slate-950` 7.29:1，两条配对进 `AA_PAIRS`，暗色沿用白只有 2.77:1）。中央 `controls.css` 加 `.ht-btn--danger.ht-btn--commit`，`DangerConfirmDialog` 两枚定档（取消=次要档、确认=实底危险档），**15 枚**不带色调的 `.ht-btn` 显式定成 `--secondary`（复量 `grep -rn 'className="ht-btn"' apps/web/src --include='*.tsx'` ⇒ 0；立项现量 18 处含对话框那一枚）。<br>能红验证：契约测 39 条 + **五枚真变异**（默认档改 commit ⇒ 2 红；commit 前景换 `foreground-inverse` ⇒ 1 红；给 primary 建零消费者覆盖 ⇒ 1 红；`controlPaletteOf` 忽略重量参数 ⇒ 1 红；编造色名 ⇒ 2 红），全部从 `.mut-bak` 还原 `cmp` 逐字一致。⚠️ 其中"零消费者槽位"那一枚**第一次是打不到的**：原判据比的是"两档配方是否相同"，而空槽位恰恰长得和原来一样（注入后 38 条全绿）⇒ 改成按**覆盖表的键存在性**判，并把机制写进 `hasCommitOverride` 的注释。<br>新门禁 `pnpm check:control-semantics`（A1 表→CSS 逐格 / A2 CSS→表 / A3 重量档 / A4 幻影类 / A5 零消费者 / A6 功能 CSS 重声明外观 / A7 推导变量名必须存在 / A8 裸档归零 + 候选下限）：**14 枚 self-test 臂全过**、两次真树变异（中央 CSS 漂一格 ⇒ 精确红一条；把 `commit` 换成不存在的类 ⇒ A4+A5 各红一条）还原 `cmp` 一致；已进主链（`check:gate-wiring` rc=0）。账本两本：幻影 1 行（`ht-btn--outline`，全仓零条规则，归注册登录标准套件线名下那格，**不代改**）、外观 2 行（`sheets.css` 设置页换底，owner = P7/P8）。<br>界面取证：`e2e/tests/control-semantics.spec.ts` **3 条真跑全绿**，期望值全部由浏览器现算（探针挂到真属性上读，因为自定义属性的计算值是代入前的 `var(...)`，直接比永远不等），截图逐张看过 `purge-confirm-1440-{light,dark}.png` 与 `purge-confirm-390-light.png`：实底红/浅红两档都读得出"这枚才是按下去的那一枚"，行内那枚仍是透明底红字。⚠️ 第一次跑红在 hover：`getComputedStyle` 在过渡中读到的是**起点色**（`rgb(220,38,38)` 而非终值 `rgb(185,28,28)`）⇒ 假红的是探针不是实现，改成 `expect.poll` 到终态。<br>✅ **那一格本趟量到了**（2026-10-28 补）：禁用档 `opacity` 在真浏览器里读回 **0.38**，与 token
`state.disabled-opacity` 逐字相同，另带一枚对照臂（同一排里没禁用的那枚必须读 1，否则这把尺分不清两态）。
原来"量不到"的判断本身没错——`vault-unlock`/`vault-create` 在未建库/未配服务器时确实不渲染那枚按钮；
错的是**只在那一屏找**：新建习惯那一格"名称为空 ⇒ 提交禁用"是零前置的默认态。
判据落 `e2e/tests/control-semantics.spec.ts` 的「禁用档」那一条（该套现量 **4 条全绿**），
能红验证＝把 `controls.css` 的 `.ht-btn:disabled` 换回裸值 `0.5` ⇒ 该条精确红并点名 `token=0.38`，
从 `/tmp/cc.mut-bak` 还原 `cmp` 逐字一致；取证帧 `apps/web/evidence/control-semantics/disabled-opacity-habit-create.png`。
静态面复量：`check:design`／`text-color`／`theme`／`l4`／`selection-single-source`／`rn-aria`／`tokens`／`overlay`／`scripts-parse`／`e2e-specs-parse`／`md-tables`／`doc-citations`／`docs`／`gate-wiring` 逐条 rc=0。`check:ui-language` 仍 rc=1（4 处，全在 `App.tsx:2560-2561` 的 `t(条件式)`，与 P3 收尾那一趟读数相同、本趟未改变）。<br>**A3（移动端薄壳）未开始**；本轮另记一条环境事实：`packages/design-system/dist` 与 `packages/ui/dist` 是陈旧产物时会造出"token 在真表里索不到"这种假红（本趟开工第一条红即此因），跑契约测前先 `pnpm --filter @heyta/design-system build`（已入 §7 第 608 条）。<br>**A3（移动端薄壳）2026-10-28 同日落地**：`apps/mobile/src/ui/kit.tsx` 的 `Button` 删掉本地那份 `Record<ButtonTone, { bg; fg; border }>` 抄件，改读 `controlPaletteOf(tone, emphasis)`；`ButtonTone` 收成共享词表的别名；默认色调取 `DEFAULT_CONTROL_TONE`、默认重量取 `DEFAULT_CONTROL_EMPHASIS`；词表外的名字**不画**（兜成任何一档就是"新加一个 tone 名静默画成次要按钮"那个毛病）。三处顺带收掉的第二份答案：`secondary` 的 `color.surface` → 表的 `surface-sunken`、`danger` 恒实底 → 默认行内档、按下反馈的**裸 `opacity: 0.85`** → `motion.press-scale`（`IconButton` 原来那一格是换底，一并收成缩放）。⚠️ 那个 `border` 字段**从来没被读过**（样式里恒 `borderWidth: 0`），删的是死码。<br>重量档按位置显式落：**4 枚**确认层里的按钮写 `emphasis="commit"`（注销账号的对话框那枚、恢复导入的确认、退出共享空间的 armed 态、回收站彻底删除），**5 枚**留在行内档（注销页的触发钮、退出所有会话、任务详情行的删除、批量删除条、AI 端点删除）。判据：`check:control-semantics` 新增 **A9**（这一端不再引用 `controlPaletteOf` ⇒ 红；本地又出现色调配方字面量 ⇒ 红），自测臂 ⑮/⑯ 各钉一头，共 **16 枚臂全过**。<br>共享表另收一格类型：`ControlColorToken = Extract<TokenName, \`color.${string}\`>` —— 原生 token 表是"一键一型"（`color.*` 串、`state.*`/`motion.*` 数），拿 `TokenName` 索引出来是 `string | number`，在 RN 的 `ColorValue` 上过不去；用 `as string` 绕过等于把"这格必须是颜色"从类型里删掉。<br>复量：`packages/ui` 契约测 39 条、`apps/mobile` 全套 **1184 条 / 91 文件**、`apps/web` 全套 **2621 条 / 212 文件**、`check:rn-aria`／`check:design`／`check:tokens`／三端 typecheck 逐条 rc=0。<br>✅ **那条设备腿 2026-10-28 补上了**（载体是 `linux-dev`，不是 windows-pc —— 安卓载体早已整体迁走，上一条里"本机跑不了 Android（归 windows-pc）"那句是旧抄件，按现量改口）：`assembleRelease` 产物 sha256 `54b7f6983ab0a35e…` / 69,827,016 B，**直接在载体上 `adb -s emulator-5556 install`**（那台在 launcher 空转；5554 是协作线在用，没碰），per-app 语言 `zh-CN`，屏幕 1080×2340 @440dpi。装置与逐张判词在 `apps/mobile/evidence/global-ux-control-tiers-20261028/RESULT.md`，四张图人眼看过：顶栏搜索/同步两枚图标静止色在亮暗两档都比标题低一档（= `foreground-muted`）；`标记为完成` 是 `#f1f5f9`/`#080e1a` 填充（= `--ht-slate-100` / 暗档 `surface-sunken`，与 Web `.ht-btn--secondary` 同一枚 token）；`删除` **无填充**、字与图标 `#dc2626`/`#f87171`（= 亮 `--ht-red-600` / 暗 `--ht-color-danger`）⇒ 三处"只有看图才能判"的变化都在，且设备上画出来的每个值都能回指到 token 表里那一格，没有第三个值。取色现算的对比度：次档字/底 16.30（亮）/17.62（暗）、危险行内字/面板底 4.83/6.02，都过 AA；次档底/面板底 1.10/1.16 只登记不判红（识别靠标签+图标，Web 同形 ⇒ 不是移动端缺陷，要改得连 Web 一起改，属取向题）。按下档另量一发：填充与字色逐像素同静止帧，只有药丸 485×121px → 469×117px（两轴同比例 0.967）⇒ 触屏那一档确实是 `motion.press-scale`；静止帧高 121px ÷ 2.75 = **44.0dp**，与 `touch-target.min` 逐字相等。<br>✅ **那两格随后也补上了（同一趟）**：`emphasis="commit"` 的实底档走 `我的 → 设置 → 数据管理 → 回收站 → 彻底删除`（回收站那一行**不在** `我的` 那一列里，它住在 `dataActions` 那一格，`ProfileScreen.tsx:1452` —— 之前 8 次滑动没走到是找错了页）。亮暗两帧现量：`取消` = `#f1f5f9`/`#080e1a` 底，`彻底删除` = **`#dc2626` 实底 + `#ffffff` 字**（暗档 `#f87171 + #020617`，正是暗色档 `on-danger` 那一格，没跟着亮档写白）。`disabled` 档**零前置**就有 —— `任务 → 选择任务` 之后批量条那三枚在没选中任何一条时就是 `enabled=false`（`TasksScreen.tsx:1255/1263/1270`），不必造 `busy`；并由画出来的像素**反解不透明度**（`O = αF + (1-α)C`，C 取同一带上按钮间隙的容器底）得 α≈0.358（次档底）/0.376（行内危险字），对着 token `state.disabled-opacity = 0.38`（`tokens.css:563`）—— 写成裸 `0.5` 会解到 0.5 附近。四张新帧与一张按钮带拼图见同一证据目录。⇒ **P4 判为收口**；仍要说清的边界：触屏没有 hover 档，移动端那句"逐态"按静止/按下/禁用三态判，不拿 Web 的 hover 冒充。 |
| P5 菜单键盘 | ✅ **Web 侧收口**（移动端今天没有自绘菜单，共享判断是端无关的，将来直接复用） | **立项现量是三枚菜单四种答案**：`AccountMenu` 一套完整的（Esc 关+还焦点、Tab 关不还、上下环绕、Home/End）／`RailNavigation` 的 More **只接 Escape**（进去出不来）／`HabitsView` 的 More **一条键都没接**，却另挂了一条 `document` 上的 Escape（关掉后焦点停在已卸载的菜单项上）。三处都没有任何测试会红。<br>**形状**：判断住 `packages/ui/src/control/menu.ts`（纯函数 `menuActionOf`：一枚键 + 当前状态 → `focus`/`close{refocusTrigger}`/`activate`/`ignore`，**不碰 DOM**），渲染那一半住 `apps/web/src/lib/menu/useMenuKeyboard.ts`（数项、挪焦点、转关闭），三枚菜单各只留一行接线。类型查找的缓冲计时归钩子、查哪一项归共享层。<br>契约测 **34 条**穷举（含 18 种键 × 3 个 activeIndex × 2 个项数的越界检查），**六枚真变异各红恰好一条**（Tab 与 Esc 写成同一格／刚打开时两向改对称／摘掉嵌套层让位／查不到甩到第一项／无焦点时 Enter 凭空激活／去掉组合键让位），还原 `cmp` 逐字一致。<br>新门禁 `pnpm check:menu-keyboard` 四臂（M1 画了 `role="menu"` 没接钩子／M2 菜单项没有 `tabIndex={-1}` ⇒ 额外 Tab 停靠／M3 界面绕过钩子直接用判断／M4 共享层碰 DOM）+ 两枚候选下限，**9 枚 self-test 臂全过**、已进主链（`check:gate-wiring` rc=0）。⚠️ 门禁自己抓出两枚**装置缺陷**并已修：① 按子串判 `role="menu"` 会把 `keyboard-cursor.ts` 里的 **CSS 选择器** `[role="menu"]` 读成第四枚菜单（打宽）；② `selftest()` 是 async 而调用处没 `await` ⇒ **九枚臂一条都没跑、一个字没打印、退出码 0**（"永远通过的尺"最纯的版本）。<br>界面腿真跑：`e2e/tests/menu-keyboard.spec.ts` 三枚菜单各走同一条序列（焦点进入→逐项 `tabindex=-1`→向下→末项环绕→首项向上环绕→Home→中文类型查找→Esc 归还→Tab 收起）**3 条全绿**。两处红的是装置：`page.keyboard.press('应')` Playwright 不认非 ASCII 键名（中文界面必须派发真 `keydown`）；面板关掉后再用 locator 读焦点＝等一个不存在的东西（60s 超时）。<br>🔴 **真浏览器抓出的两格真缺陷**（都不是"接线"问题）：① 焦点还没进菜单（还在触发者上）时按 Tab，面板的 `onKeyDown` 收不到 ⇒ 菜单**留着开着**而人已走 —— 补在钩子里（目标不在面板内时按同一份判断处理），不在各菜单里各补一份；② 两种关闭都 `preventDefault` ⇒ Tab 之后焦点停在正在卸载的菜单项上，"按了什么都没发生"，且与 Esc 那格混成同一个答案。第二格 e2e **量不出来**（账号菜单面板 `createPortal` 到 `body` 末尾，Tab 的浏览器环绕本来就会回到文档开头那枚触发者），改由 `apps/web/tests/menu-keyboard-hook.spec.tsx` 直接数 `trigger.focus` 调用次数钉住（Esc 恰好一次、Tab **零次** + `defaultPrevented` 两格相反），5 条 + 四枚变异各红一条。<br>回归面：`apps/web` 全套 **2626 条 / 213 文件**、`packages/ui` 39+34、`check:menu-keyboard`／`check:control-semantics`／`check:gate-wiring`／`check:docs` 逐条 rc=0；`account-menu`／`rail-geometry`／`habit-create-options`／`dirty-form-guard` e2e 全绿。⚠️ `rail-roving` 那条 dnd-kit 共存用例**间歇红**（5 次跑法 4 红 4 绿，红在前置"Space 有没有进拖拽模式"），机制上可排除本期改动（那条文档级监听只在 More 菜单开着时挂载，而该用例从不打开菜单）——逐次读数与"判它是不是这一条的断言"记在 `BLOCKED.md` B240，**没做那个实验之前它只是候选成因**。 |
| P6 浮层迁移 | ✅ **在册八枚真消费者全部有真浏览器读数**（2026-10-29 第三批再收两枚：`PrivacyConsentSheet` 与 `LegalReconfirmSheet`）（危险确认 13 条／新建清单 33 条／新建习惯 11 条／分享面板＋入群 `verify:collab-journey` ⇒ `RESULT=OK steps=3`／`ConflictDialog` 走真并发的 `verify:vault-web` 那一条，读数见本节末段）；能机械收编的模态已收完，剩下一格（`AuthPanel` 自己那层）写明了为什么不是换壳 —— 那是**判过的边界**，不是没做完 | **先量后动**（这一期的规矩）：§7 第 610 条把 #606 那句"未判定"用三发对照读数分开了 —— 同一次任务里点完立刻读 ⇒ `aria-modal=0`/`role=dialog=0`/内容不在 DOM（与 P1 那晚逐字相同），跨一次往返 ⇒ `aria-modal=1` 而 `role=dialog=0`，等 1.2s ⇒ 两个都 1。⇒ 是**测早了一帧**，不是被宿主挡住；顺带立了一条量法纪律：**量浮层前先等 commit**。<br>🔴 **原计划的前提被实测否证**：给 RNW `View` 传 `className`，真浏览器 `querySelectorAll('.probe-…').length === 0` —— RNW 不透传类名 ⇒ "给 `OverlayModal` 加宿主类槽"（我先拍的 ①）**不存在这条路**，同日改判 ③：Web 侧走一枚**原生共享模态壳**，`OverlayModal` 留作原生端那一枚，两枚壳查同一张 `dismissal.ts` 表。<br>**已落地**：`apps/web/src/lib/dialog/WebModalShell.tsx`（遮罩+面板+`role=dialog`/`aria-modal`/`aria-labelledby`/testID、三条通道全查表、焦点三件事复用 `useModalFocusIsolation`、**就地画在宿主堆叠上下文**）。第一枚消费者是**已有**的 `DangerConfirmDialog` —— 它改成消费新壳，**DOM 逐字不变**，所以 P2 那 13 条 e2e 直接当验收用（含 N5 初始焦点在安全侧、N6 Tab 不外逃）。⚠️ 刻意不建"零消费者槽位"：壳与它的第一枚消费者同趟落地。<br>账本按**它自己写的翻案条件 ②** 换行：`DangerConfirmDialog` 那一行删、换成 `WebModalShell` 一行（`aria-modal`/`role` 各 1，总数不变）⇒ 此后每迁一枚界面，账本只会**少**一行。②里"原生 portal"那半句同步更正为"就地渲染"（依据 #607）。<br>能红验证：`check:overlay` 两向各注一次都抓得到（账外加一处自绘标记 ⇒「现量 2 > 账本 1」；摘掉一层不改账本 ⇒「账本里的文件不再被扫到」），还原 `cmp` 逐字一致。<br>顺带抓到一处**本线自己制造的旧口径载体**：`danger-confirm-trash` 的 N4 还钉着"主按钮字色 = danger"，那是 A2 分两档**之前**的契约 ⇒ 已按两档重写（确认层那枚：底 = `danger`、字 = `on-danger`，并保留"不许等于 primary"的分辨力）。<br>复量：`apps/web` 全套 **2626 条**、`danger-confirm-trash`＋`vault-settings`＋`dirty-form-guard`＋`auth-panel-esc` **23 条**、`check:overlay`／`check:danger-confirm`／`check:dirty-form-policy`／`check:ui-provider`／`check:design`／`check:l4` 逐条 rc=0。<br>**第二枚消费者已迁：`CategoryCreateDialog`（2026-10-28 同日）** —— 它是纯机械迁移的那一枚（现量：Esc 关 + 背景关 + 含表单 ⇒ 正对表里 `modal-dirty-form` 那行，且 P1 的"先问一句"已接在上面）。它一次带来四样东西：
  ① **壳缺三格**：`aria-busy`、遮罩层内的确认层槽（`overlayChildren`，确认框必须与面板同堆叠上下文）、以及**背景通道改走 `mousedown` + 目标判定**（用 `click` 的话"在输入框里按下、松手在背景上"会被误判成点背景）；
  ② **壳缺一条守卫**：提交中（`busy`）任何通道都不许关 —— 原来这一格是宿主那 44 行里的 `busyRef`，收进壳后每一枚都不用重写；
  ③ **抓出一个真缺陷并根治**：草稿 state 原本挂在"关掉后仍存活"的组件上，重开那一帧 DOM 里还是上一份草稿（实测 `value="诊断清单"`、色槽 1 `aria-pressed=true`），清草稿的 effect 在 commit 之后才跑 ⇒ "刚点开就按 Esc"会弹「放弃这次的修改？」问用户**从没输入过**的内容。旧代码看着对，只因为它的 Esc 监听和清草稿在同一个 effect 里注册（把缺陷伪装成"没反应"）。根治是**让草稿随开合挂载**（外层只判开合，state 全在内层），不是把 effect 提前的绷带。全文见 §7 第 611 条；
  ④ **棘轮抓到扫描器瞎了一格**：把 `role="dialog"` 交给壳之后，`check:dirty-form-policy` 认不出这一格是对话框（已接保护 5 ⇒ 4，当场红）。修的是眼睛（`<WebModalShell` 也算自报对话框），**没有**把下限降到 4；分母回到 13（迁移前也是 13，12 是瞎的那一眼）。
壳自身判据：`apps/web/tests/web-modal-shell.spec.tsx` **10 条**（含"不忙时两向都能关 / 忙时都不关"、"forced-read 两向都不关"这对配臂）+ **五枚真变异各红恰好一条**（S1 确认层挪进面板、S2 `aria-busy` 无条件写、S3 无视策略、S4 去掉点击隔离、S5 摘掉 busy 守卫），还原 `cmp` 逐字一致。
账本：`CategoryCreateDialog` 那一行**删**（它不再自带模态语义），自绘标记读数 44 ⇒ **42**、文件 20 ⇒ **19**，`check:overlay` rc=0。
复量：`apps/web` 全套 **2636 条 / 214 文件**；`category-dialog-ux`＋`dirty-form-guard`＋`danger-confirm-trash`＋`categories`＋`settings-category-ux` **33 条**全绿；`check:dirty-form-policy` 四臂 + `check:ui-provider`/`design`/`l4`/`gate-wiring` 逐条 rc=0。
**第三枚到第五枚消费者已迁（2026-10-28 同日第二批，四枚一起）** —— `HabitsView` 新建习惯、`ShareFeature` 分享面板、`JoinSharedListDialog` 入群、`ConflictDialog` 冲突解决。自绘标记 42 ⇒ **34 处 / 15 文件**（现量 `pnpm check:overlay`），账本删四行。这一批带来三样：
① **壳缺两格**：`overlayStyle`/`dialogStyle`（待迁的几枚用的是一整份内联 `cssVar` 样式对象而不是类名，接不住就等于"换壳顺手改了一次外观"，而外观变化只有看图才判得了）与 `portalToBody`（**整层**搬 `body`：入群那一枚挂在 `position: sticky` 的侧栏列里，sticky 必然创建层叠上下文 ⇒ 就地画的 `fixed` 面板**看得见、点不到**，那是 2026-10-10 实测过的形状，不是审美。搬的是整层，确认框仍画在遮罩里面板之前，所以第 607 条那条不变量不受影响）。
② **抓出 P4 那把尺的一枚形状盲区**：A8 原来只认 `className="ht-btn"`，注释写着"别的形状由 A4/A5 兜"——那句是**错的**：A4/A5 比的是"引用的档在不在中央 CSS 里"，而 `ht-btn` 当然在，所以三元里的 `: 'ht-btn'` 两边都不红。落点是 `features/sync/ConflictDialog.tsx:218`（一枚真的裸档）。谓词改成按**字符串整枚等于**判，并加自测臂 **⑰**（正向抓三元写法、反向断"带后缀的档不许误伤"），臂数 16 ⇒ **17 全过**；那一枚定成 `ht-btn--secondary`。
③ **顺手治掉一枚与第 611 条同族的真缺陷**：习惯对话框那十格草稿住在"关掉后仍存活"的组件上，而 `closeCreateForm` 不清它 ⇒ 确认框说的是"这次的修改会丢掉"，重开时名称框里躺着的还是刚才那一句。判结果不判手段：新增一条真浏览器断言（放弃 → 重开 ⇒ 值必须为空，`habit-create-options.spec.ts:64`），变异取证（摘掉 `resetDraft()` ⇒ **该条精确红**）后从 `/tmp/hv.mut-bak` 还原 `cmp` 逐字一致。

**两格档位口径（本线拍的，附翻案条件）**：`ConflictDialog` 归 `modal-readonly` —— 关掉它**不**清冲突状态、SyncBar 仍会提示（`ConflictDialog.tsx:126-128` 那句注释就是依据），丢弃无代价 ⇒ 背景该能关；这与它原来"背景不关"不同，是有意的更正而不是顺手改。它**不**传 `busy`：`status.kind === 'syncing'` 是常驻态，拿它锁三条通道会把"边看同步条边关窗"变成按不动。翻案条件：一旦出现"关窗就等于放弃解决"的判定（比如后端把未决冲突自动 LWW），这一格要升回 `modal-dirty-form`。

复量：`apps/web` 全套 **2636 条 / 214 文件**；habit／dirty-form／menu 相关 e2e **23 + 11 条**；`check:overlay`（34/15 与账本一致）／`check:dirty-form-policy` 四臂＋棘轮／`check:control-semantics` 17 臂／`check:danger-confirm`／`check:menu-keyboard`／`check:gate-wiring` 逐条 rc=0；web typecheck 除别线那枚 `inbound-hosted-extraction-ui.spec.tsx:81`（`'root' is possibly 'undefined'`，文件本线未碰）外无错。
🔴 → ✅ **那三枚宿主的真浏览器读数补上了（2026-10-28 同日，`pnpm verify:collab-journey` ⇒ `RESULT=OK steps=3`）**：这一趟把上面那句"没量的腿"变成了有量的。旅程里被真跑到的三格：① `JoinSharedListDialog` 在**真 sticky 侧栏**里经 `portalToBody` 画出来并且**点得动**（bob 贴 token → 同意闸落盘 → `share-join-done` → × 关层 → 侧栏只落一行清单），这一格证的正是"搬整层而不是搬面板"那一判据；② `ShareFeature` 的面板在壳里跑完失败回执（409 fixture ⇒ `share-panel-error` 可见）；③ owner 那枚 × 走的是壳里的 `modal-dirty-form` —— 面板里还留着一句没发出去的邀请邮箱，所以 × **只触发「放弃这次的修改？」**，选放弃才真的关。
> 那一格第一次是**红**的：旅程钉的是旧口径"× = 直接关"（`collab-journey.spec.ts:387`）。红因不是我这次换壳换出来的语义，而是**换壳把 P1 那条契约真的接到了这一层上** —— 契约本身在 `dismissal.ts` 的表里。处置与 P1 对 `habit-create-options` 那一格同一味道：**改契约、不放宽判据**，并把"确认框出现时面板不许先没掉"这一格补进断言（它钉的是"问"不是"关"）。改完 `RESULT=OK`。
> ✅ **那格补上了（2026-10-28 同日第四批）**：`ConflictDialog` 有了真浏览器读数，而且是**真并发**造出来的，不是把 store 手改成 `conflict`。装置 `e2e/vault/conflict-dialog.spec.ts`（跑法 `node scripts/verify-vault-web-journey.mjs vault/conflict-dialog.spec.ts` ⇒ 1 passed / 9.6s）：同一账号两个真 context（各自 clientId 与本机日志）、A 那台 `setOffline` 改标题、B 那台在线把同一条改成另一版并先上传、A 恢复在线同步 ⇒ 服务端判 `CONCURRENT`、`suggestConflictResolution` 落 manual、`store.ts:834` 自动弹层。读数逐条：`[role=dialog]` 现量 **1** 枚、`conflict-dialog` 可见、框内**两边标题并排**（本机「A 台改的」/ 对端「B 台改的」+「Newer」标）、`保留这一版` **2 枚**、点完那一枚之后层关掉、A 再同步 + B 拉一次 ⇒ B 列表里那一行变成 A 保留的那一版（截图 `apps/web/evidence/conflict-dialog-browser/{conflict-dialog,converged-on-b}-1280-light.png`，两张都人眼看过）。能红验证：把 `store.ts` 那句自动打开摘掉 ⇒ 该条精确红在「A 同步完没有出现冲突对话框」，从 `/tmp/ux-store.mut-bak` 还原 `cmp` 逐字一致。<br>三趟踩出来的前置（都写进那枚 spec 的注释，别再来一遍）：① 第二台**必须先同步一次再刷新**才看得到密钥包 —— 向服务端要那一枚包只发生在"创建会话的那一次装配"里（`lib/vault-session.ts:117-122`），没刷新一台就画成建钥表单；② 两侧都要用**改名**，一边改名一边勾选会让那条被完成态收出默认视图，"列表里没有"就分不清成因；③ 点完"保留这一版"**要本机再同步一次**，那条重写走的是正常上传队列，产品从不承诺点一下就把对端推平。<br>⚠️ 顺带量到一枚**别线名下**的红（本线不代改，登记在 `BLOCKED.md` B246）：`verify:vault-web` 那两条既有测在当前 HEAD 上恒红在"设置浮层里没有「同步」那一节" —— 设置浮层分节之后每一节是 `hidden` 切换，要先点 `[aria-controls="settings-group-sync"]`；本线新那条用的是当前形状。
🔴 → ✅ **意思表示层那两枚已迁（2026-10-29 第五批）** —— `PrivacyConsentSheet` 与 `LegalReconfirmSheet` 一起改吃 `WebModalShell`，关闭口径落进 `CLOSED_OVERLAYS` 新增的那一行 `modal-deferrable`（背景 deny／Esc dismiss／系统返回 dismiss／给 ×）。<br>① **这一格原先登记的理由被两条现量否证**：计划原文写 `PrivacyConsentSheet` 归 `modal-forced-read`"形状合"——**不合**，那一档 Esc 是 deny，而链 5 的对外口径（`docs/plans/legal-compliance-before-filing.md` §4 第 4 条）明写"Esc 与点 X 收起面板⋯点背景（遮罩）**不许**关闭"；`LegalReconfirmSheet` 那句"Esc = 延后再说，是对外法律表征口径，不代拍"也不成立 —— 移动壳那枚 `apps/mobile/src/screens/LegalReconfirmSheet.tsx` 早就把 `onRequestClose` 接成 `deferLegalReconfirm`，也就是**同一个答案另一端已经落地了**，Web 只是没吃表。⇒ 这一格做的不是替谁拍法律口径，是把两端已有的同一个答案收进一张表。<br>② **为什么单独成一行**（不复用两行里任一行）：误点遮罩是**无意**动作 ⇒ 不该把一次法律表态推掉；Esc 与那枚写着「以后再说」的出口是**有意**动作 ⇒ 允许退出，而关掉不等于同意（闸门仍关、下一次要出门的动作再问）。不升成 `modal-forced-read` 是因为"强制当场表态"对本就允许拒绝的单独同意是**反向诱导**（PIPL 16 / 《认定方法》那条）。判据两向都有牙：`overlay-dismissal-model.spec.ts` 断言它与 `modal-readonly`、`modal-forced-read` **都不同形**。<br>③ **壳补了一格**：Esc 真的被这一层接住时不再往下传（`stopImmediatePropagation`；判成 deny 或提交中 ⇒ **不吞**）。迁移前这一格是隐私面板自己挂捕获监听做的，契约由它的 spec 钉着，收进壳后八枚消费者共用同一个答案。⚠️ 影响面现量过是空的：全仓挂在**窗口冒泡**阶段的 keydown 监听只有壳自己与 `useModalFocusIsolation`（只吃 Tab），其余各层（`use-modal-dismiss`、搜索、助手、rail、菜单、日历捕获）挂捕获或 `document` ⇒ 早于壳执行、吞不到。所以**"一次 Esc 只关一层"仍然不是全仓真命题**（更早挂载的捕获层照旧会一起收），那条边界归 `lib/use-modal-dismiss.ts` 文件头登记的那一格（要先有"谁是顶层"的判断）。<br>④ **视觉为零是量出来的**：临时夹具把两枚面板换壳**前后**的 DOM 逐节点导成 JSON 对比 ⇒ 节点数 21／20 前后相同、无新增无消失，属性差异只有三处：遮罩多 `data-testid="…-scrim"`、两层多挂 `ht-web-modal__overlay`／`ht-web-modal__dialog`（全仓 grep 这两个名字**零条 CSS 规则**，只有壳与它的 spec ⇒ 惰性钩子），内联 style 串逐字相同。夹具跑完即删。<br>⑤ **判据与能红验证**：`packages/ui` 契约 +2（该文件 11 ⇒ **13**）、壳自身判据 +2（10 ⇒ **12**，含"接住了才吞／deny 时不吞"这对反向臂）、两枚面板 spec +3（隐私那条"点背景"从只发 `click` 改成发 **mousedown→mouseup→click** 整串 —— 壳认的是 mousedown＋目标判定，只发 click 会让那条退化成空判据），新真浏览器套 `e2e/tests/deferrable-sheet.spec.ts` **5 条**（遮罩铺满／面板水平居中／宽度等于档值且带"宽屏必须真的跑到档值"那枚反作弊臂／点遮罩不关且不落盘／Esc 关且不落盘、刷新后仍再问）。变异三发：宿主 `policy` 改 `modal-readonly` ⇒ 隐私 spec 的"点背景"红 1 条 **且** 浏览器套红 1 条；改 `modal-forced-read` ⇒ 两条 Esc 判据红；每发还原后 `cmp` 逐字一致、复跑全绿。<br>⑥ **看图**：`apps/web/evidence/deferrable-sheets/consent-{light,dark}-{1440,390}.png` 四张逐张看过（暗色那张确认遮罩压深、焦点环落在面板、两枚按钮不同档）。⚠️ 顺带量到一条**取证时机**坑：链 5 与 G-27 那两套自己的截图拍在首屏动画还没退场时（`#heyta-boot` 的 z=900 压在模态 z=400 之上）⇒ 整张像蒙了一层白，与 10-02 入库图 83% 的差里有一大块是这个 + 27 天的外壳漂移，不是这次换壳（换壳那半有 ④ 的逐节点对比兜）。新套把"等 `#heyta-boot` detached"写成会红的断言。<br>⑦ **账本与复量**：`MODAL_LEDGER` 里这两行**跟着删**，`check:overlay` rc=0；四档台账 +1 族（意思表示层关闭口径）。`packages/ui` **825 条／55 文件**、`apps/web` 全套 **2643 条／215 文件**；真浏览器 `privacy-consent-zero-egress` **7**＋`legal-reconfirm-gate` **6**＋`danger-confirm-trash`＋`dirty-form-guard` **19**＋`deferrable-sheet` **5**；`check:overlay`／`check:dirty-form-policy`／`check:ux-coverage`／`check:l4`／`check:design`／`check:gate-wiring` 逐条 rc=0。⚠️ 同批现量到 `check:row-single-source` 断言 B 是**别线的既有红**（`85999fd3a` 2026-10-25 引入 `.ht-accountmenu` ⇒ 前缀族 29 > 基线 28），本线没动它、也没替它改基线（已登记）。<br>

**剩下没迁的与为什么**（不再是"未开始"，是逐格判过的边界）：`AuthPanel` 自己那层是 `.ht-sheet`（**没有自己的遮罩**），而壳是"遮罩 + 居中面板"的形状 —— 它是抽屉/面板族，不是模态族，硬套壳会凭空给它加一层背景；`CalendarCapturePopover` 是锚定层（`placeAnchoredPanel` + portal + resize 重定位）；`App.tsx` 那三处刻意 `aria-modal="false"`（搜索面/设置面要让下层留在 DOM 里，有断言钉着）；`InboxBell` 与 `CompactRailNavigation` 是非模态弹出；AI 面板那 16 枚 `role="dialog"` 是 prop 转发给 `packages/ui/src/ai/AiPanel.tsx`，不是自绘层。退役 `use-modal-dismiss` 要等 `AuthPanel` 那一格有结论。
 |
| P7 页头/Chip/空态 | ✅ **五格都收口**（象限回执空间归属／chip 分型／EmptyState 动作槽／z 刻度／页头同排高度），各带能红的判据；最后欠的那半格「只读徽标不增高」今天有了真浏览器读数（`e2e/tests/chip-typing.spec.ts` 第二条，2 passed）| **象限回执搬到板子那一段**：它原来排在折叠帮助**之后**，1280 档上"任务被移进『交给别人』"那句与「撤销移动」隔着一整个板面（P3 看图照出来的旧形状）。判据落在真浏览器几何 + DOM 顺序两枚（`quadrant-move-ux` 1280/375 **2 条全绿**）：回执顶边必须在帮助之前，且 DOM 顺序恒为"板子→回执→帮助"。<br>⚠️ **第一版判据是我猜的、当场被读数否证**：写的是"回执顶边减板子底边 ≤ 24px"，375 那一档实测 **40px** 就红了 —— 那个 24 是对上边距的猜测，而窄档板子下面本来就还有自己的一段，它量的是猜测不是命题。改成按**形状**判（顺序），并把"不许拿猜来的数字当阈值"这条留在 spec 注释里。<br>能红验证：把回执搬回帮助之后 ⇒ 断言精确红（`回执排在折叠帮助之后 ⇒ 刚做完动作时出口在页底`），从 `/tmp/qb.mut-bak` 还原 `cmp` 逐字一致；复跑 2 条绿。**看图**：`apps/web/evidence/undo-receipt/quadrant-receipt-1280.png` 末帧现在是"四格板面 → 紧接一句带「撤销移动」的回执 → 最底下才是 ▸ 帮助"，出口与它说的动作在同一屏里。<br>**chip 分型已收口（2026-10-28 同日第二格）**：`.ht-chip` 这一族今天同时被"可点的动作"（行尾那排 备注/子任务/截止/提醒/AI，载体是 `<summary>` 与 `<button>`）与"只读的徽标"（`task-note-badge-*` 那几颗 `<span>`）共用，于是"触控目标 ~20px"（`ai-panels.css:57` 那句产品负责人的话）与"徽标不许长高"是**同一份样式在互相拉扯**。分型后：新增 `.ht-chip--action { min-block-size: var(--ht-touch-target-min); cursor: pointer }`，`cursor: pointer` **从基档挪走**（基档留给只读徽标 —— 它原来替徽标撒了"我可点"这个谎），**6 枚**可点落点显式定档（第 6 枚 `ReminderPanel.tsx:258` 是那枚提醒 `<summary>` —— 它是新门禁现量出来的，立项时只点了 5 格）。<br>新门禁 `pnpm check:chip-typing` 四臂（C1 可点没带 --action／C2 只读带了 --action／C3 CSS 里没有这条规则、下限写成裸值、或基档还留着 pointer／C4 候选下限 9 与 6）+ **9 枚 self-test 臂全过**、已进主链（`check:gate-wiring` rc=0）。界面腿 `e2e/tests/chip-typing.spec.ts` **1 条真跑绿**：下限**不抄 44**，从同一页把 `--ht-touch-target-min` 算成 px 再逐枚比（行尾现量 ≥3 枚可点 chip 全部 ≥ 下限）；能红验证＝把 `min-block-size` 换成 `1rem` ⇒ 该条精确红并点名"下限=44px"，从 `/tmp/ap.mut-bak` 还原 `cmp` 逐字一致。回归面：`task-row-density`＋`keyboard-cursor` 同跑 **14 条全绿**（chip 长高没把行搞坏）。截图看过 `apps/web/evidence/chip-typing/row-chips-1280.png`。<br>⚠️ 两枚**当场是坏的探针**被抓出来才修：① 新门禁第一版把 `scanJsxTree` 的 `node.end` 当"开标签结束"用 —— 那是**整个子树的末尾**，于是一枚 `<div>` 会因为里面躺着一枚带 `--action` 的 button 而被判成"只读元素被撑高"（干净夹具读成 C2 红），改成用 `findTagEnd` 现算开标签终点；② CSS 判据没剥注释，注释里那句"`cursor: pointer` 原来挂在这一族上"是**讲历史**，被读成"基档今天还带着它"（假红）。<br>✅ **那一格补上了（2026-10-29）**：只读徽标"不增高"与"不像能点"两半现在都有真浏览器读数 —— spec 文末那第二条用例把面单打开（徽标只在"栏里画着面单"时才挂在行上），取到 `task-note-badge-${id}` 后逐句量：先 `toBeVisible()` + `boundingBox() !== null` + `height > 0` 三句钉住"它真的被画出来了"（第一版假绿在这里 —— 截图里那一行根本没有徽标，而两句几何判据都绿），再断"出现它的那一行高变化 ≤ 0.5px"、"它自己 < 触控下限"、"不带 `ht-chip--action`"、"cursor 不是 pointer"。下限仍然不抄 44，从同一页把 token 算成 px。复量：`pnpm --dir e2e exec playwright test chip-typing.spec.ts` ⇒ **2 passed**，图 `apps/web/evidence/chip-typing/row-badge-1280.png` 人已看过（右侧栏里是面单、行尾那枚小胶囊就是被量的徽标）。

**EmptyState 动作槽已收口（2026-10-28 同日第三格）**：共享 `EmptyState` 原来**根本没有动作槽**（`EmptyStateSlots` 只有 icon/title/hint/detail/size/illustration…，`packages/ui/src/empty-state/model.ts:89`），于是"下一步做什么"只能以**一句描述**存在 —— 习惯那一屏写着"添加一个习惯，从今天开始记录"，而能做那件事的控件是页头一枚**只有图标**的 `+`：句子把动作说成了别人的事。现在槽位是 `action?: ReactNode`（**不是** `() => void`：本包不 import i18n、也不许知道各端控件形状 ⇒ 判断共享、渲染分端），**没有默认值也不许有**。第一枚真消费者同趟落地（`HabitsView` 空态里那枚「添加习惯」，用既有词条 `web.habits.add`，零新文案）。<br>判据三档：模型层 3 条（含对照臂"只给 hint 不许凭空造控件"）、jsdom 渲染层 3 条（给了⇒恰有一枚真 `<button>` 且点得动；**不给⇒`button, a[href], [role=button]` 必须读回 0**，这一条治的就是"槽位自带一枚刷新"）、真浏览器 1 条（点空态里那枚 ⇒ 新建面板真的开，`habit-create-options` 现量 **6 条全绿**）。能红验证两枚：给 `EmptyState` 塞一枚默认按钮 ⇒ jsdom 对照臂精确红（`expected 1 to be 0`）；把 `check:empty-state` 的扫描修好后在共享空态**之外**手写一句 `t('web.habits.empty')` ⇒ 门禁 rc=1 并点名"直接渲染空态词条"；两次都从 `.mut-bak` 还原 `cmp` 逐字一致。<br>🔴 **顺带把 `check:empty-state` 的一枚眼睛缺陷修了**（它是我这次改动**逼出来**的）：`sharedEmptyStateRanges` 用 `/<EmptyState[\s\S]*?\/>/` 认"这一格是共享的"，而 P7 之前共享元素内部永远不会有 `/>` —— 加了动作槽之后 `action={<button … />}` 让非贪婪匹配在**宿主按钮中间**收口，`HabitsView` 当场被读成账外新空态。中途改用 `scripts/lib/jsx-tree.mjs` 的共享树**被实测否证**：`NotificationsScreen.tsx` 里有它文件头自认处理不了的 `<`（比较运算符），三处真共享空态它只认出一处（tree 给 1 个 range、旧正则给 3 个）⇒ 换过去会把两格合规站点读成违规，**判据的眼睛不能比它替掉的更瞎**；最终改成按**花括号深度**自己走一遍（字符串里的括号不算数，深度 0 上第一个 `/>` 才是元素结尾）。修完 `check:empty-state` rc=0、扫 247 文件 24 站点与基线一致。<br>⚠️ 另两格审计点名的"空态里没有出口"**刻意不补**：`InboundAutomationSettings.tsx:524` 与 `InviteActivityCard.tsx:145` 的创建/复制按钮**就在同一屏上方**，再往空态里放一枚就是给同一个目的地摆两枚控件 —— 登记为"已判定：不需要"，翻案条件是那两个控件离了这块区域。<br>🔴 并行线的一格**没代改**：`ShareCommentsSection.tsx` 那条"登记站点已消失"的提示在本线开工前就在（基线 `fa907e7cd` 实测同样打印且 rc=0，不判红），账上那一行归协作线自己收。

**z 刻度已收口（2026-10-28 同日第四格）**：这一格的病因在第 607 条就写明了 —— 习惯新建那层占的是 `--ht-z-splash`(900)，那是**启动屏**那一档；于是嵌在它里面的确认框永远压不住面板（"画得出来点不动"），当时的绕法是给确认框另开一档 `z.modal-commitment`(550)，等于**再参加一次数字竞赛**。这一趟做的是把刻度立成尺、并拆掉那一枚越级：`.ht-habit-create-dialog` 改回 `z.modal`(400)（底栏是 `z.sticky`(100)，本来就压得住；原文那句"怕底栏标签透上来"的英文注释连同越级一起删了）。<br>新门禁 `pnpm check:z-ladder` 三臂 + **7 枚 self-test 臂全过**、已进主链（`check:gate-wiring` rc=0）：**Z1** 断言十档按用途严格单调（base<sticky<dropdown<overlay<modal<popover<modal-commitment<toast<tooltip<splash，缺一档就红、不许"没这一档所以不用判"）；**Z2** 断功能 CSS 里 `z.splash` **零消费者**（现量账 0，不是留例外；判之前先剥注释 —— 注释里讲历史不是声明，这是 ④ 号臂反向钉住的）；**Z3** 候选下限取**尺自己扫出来的读数**（32 文件 / 33 条声明），不是手数的那 37 —— 手数把注释与 `.tsx` 内联也算了进去，写进代码当阈值会当场红（这条与 chip 那格的"24px 是猜的"同一个毛病，第二次踩到，已入记忆）。<br>🔴 **为什么 `popover(500) > modal(400)` 留着不改**：从对话框里开出去的锚定层（日期、重复规则）必须压住它所属的面板，否则点开选择器却选择器在面板底下。真正的不变量是"**必须按下去的那一层**压过任何锚定层"（`modal-commitment` 550 在 `popover` 500 之上），Z1 钉的就是这条；把它读成"模态必须压过一切"会把另一族点不开。界面侧复量：`habit-create-shape`＋`habit-create-options`＋`dirty-form-guard` 同跑 **18 条全绿** —— 其中 S1 断"动作按钮在视口内且不用滚动就点到"（对话框降档后没被底栏压住）、dirty-form-guard 那几条断的是"确认框出现且两枚按钮点得到"（第 607 条那枚倒挂在真浏览器里仍然是正的）。<br>⚠️ 两处讲着旧形状的注释一并重述（`useDirtyDismissGuard.tsx:132`、`DangerConfirmDialog.tsx:33`）：都改成"那一枚已在 P7 拆回 `z.modal`，由 `check:z-ladder` 守着不再回来"，并把"为什么确认层仍要 `modal-commitment`"的理由写清 —— 作废口径不许留在注释里当"今天还这样"。

**页头那一排已量并立尺（2026-10-28 同日第五格）**：判据两句都是几何的（"同排只有一档高度"、"交互目标 ≥44px"），源码尺量不到，所以先**量**再决定改不改。现量（1440 与 390 两档各一枚，读数逐枚打印在 spec 里）：页头 6 枚可点控件 **全部恰好 44px**，下限 token 也是 44px ⇒ **这一格本来就合规**，缺的只是一把会红的尺。新增 `e2e/tests/header-controls.spec.ts` **2 条全绿**：断（a）每枚可点控件的实测高 ≥ 从同一页现算的 `--ht-touch-target-min`；（b）同排最高与其余各枚之差 ≤0.5px；（c）这一排至少量到 3 枚（防"选择器写歪了所以零枚、于是全都通过"）。<br>能红验证：给 `.ht-header select` 注入 `block-size/min-block-size: 28px` ⇒ 断言精确红并点名 `{"tag":"select","name":"视图","height":28}`，从 `/tmp/cc2.mut-bak` 还原 `cmp` 逐字一致。⚠️ **第一次注入没红**，因为只写了 `block-size: 28px` —— 基档那条 `min-block-size: var(--ht-touch-target-min)` 把它顶回来了；这说明这一排的 44px 是**结构性的**（有硬下限），不是巧合，第二刀把下限一起压掉才红。<br>看图：`apps/web/evidence/header-controls/calendar-header-1440-light.png` —— 一行里"‹ 2026年10月 ›｜回到今天｜+｜视图 月 ⌄"五组动作齐平，按控制对象分得开（移动段位 / 复位 / 捕获 / 视图切换）。<⚠️ 390 那一档第一趟出现过一次 **60s 超时**（不是断言红，是等页面）。这一格随后专门量了复现率：
`pnpm --dir e2e exec playwright test tests/header-controls.spec.ts --retries=0 --workers=1 --repeat-each=5`
连跑 **10 条全绿（46.9s，含 5 次 390）** ⇒ 结论写成「一次未复现的等待超时」，不写成产品缺陷、不据此放宽判据，
也不留成「偶发慢」这种没有分母的说法 —— 现量命令就在上面，下一位可以直接重跑。

**未做的四格（下一趟从这里接）**：① **z 刻度纵切** —— `--ht-z-popover: 500` 高于 `--ht-z-modal: 400` 是第 607 条那枚"画得出来点不动"的根因，今天靠 `z.modal-commitment`(550) 绕过去；现量 `grep -rn "z\.popover" apps/web/src packages/ui/src` 有 **21 处**引用（含注释），真要重排必须先把每一处按"它是页内锚定层还是从模态里开出去的锚定层"分类，因为**单纯把 popover 降到 modal 之下会让从对话框里打开的日期/重复选择器沉到遮罩底下**（`DueEditor.tsx:347,363`、`TaskRepeat.tsx:377` 就是那一类），所以这一格需要的是**加一档语义**而不是改一个数；② 页头按控制对象重排（日历 capture/reset/view 三组控件）；③ 交互 chip ≥44px 与展示 badge 不增高（判据要能分辨"同一排两档高度"那族，见 `docs/agents/design-system.md` 行内动作条那一节）；④ EmptyState 动作槽：空列表/无权限/失败态给对的出口，纯无内容不造假动作。 |
| P8 全局验收收口 | ✅ **三件都收口**（详情面渐进披露策略有了会红的判据；四档覆盖矩阵建成并由 `check:ux-coverage` 守着，现量 **11 族**；P0–P7 的浏览器探针整批挂在 `check:ai-e2e` 那条真跑链上，截图矩阵补齐见下） || **渐进披露（任务详情属性组）**：先量后判，现量 `[详情面披露] {"details":[{"summary":"高级","open":false}],"dateCells":42}` —— 面里**只有一处折叠**（重复规则的「高级」）且默认关着；截止的整月日历**摊开在面上**，那是 §8.146 的裁决（栏就是来编辑的地方），以前只有散文没有任何东西会在被改掉时红。新增 `e2e/tests/detail-disclosure.spec.ts` **1 条真跑绿**：断（a）面里折叠数恒为 1 且是关的（多出一处默认收起 ⇒ 有核心字段被藏起来了）；（b）日历格 ≥28 枚可见（把它收进折叠就先红一次，逼一次显式决定）。能红验证：给 `task-repeat-advanced` 注入 `open` ⇒ 断言精确红（`那处折叠默认是开的：{"summary":"高级","open":true}`），从 `/tmp/tr.mut-bak` 还原 `cmp` 逐字一致。看图 `apps/web/evidence/detail-disclosure/task-pane-1440-light.png`。<br>**四档覆盖矩阵 + 门禁**（计划末尾那段 `ux-coverage` 围栏块）：9 个控件族（按钮四档×重量／chip 分型／菜单键盘／脏表单／危险确认／撤销回执／焦点环／z 刻度／浮层关闭通道）+ 每族四档落点。新门禁 `pnpm check:ux-coverage` 五臂（C1 块在不在／C2 引用的门禁**必须真在 `check` 链上**／C3 落点必须存在／C4 四档不许空并点名缺哪档／C5 行数与门禁枚数下限）+ **7 枚 self-test 臂全过**：其中 C2 那条治的正是本仓付过代价的那种假绿（脚本写了没人跑 = 没有）。<br>⚠️ 语义测那一档对**源码类规则**（chip 分型、焦点环、z 刻度）指的就是那枚门禁自己的 `--self-test` 夹具臂 —— 对"源码形状"这条命题，夹具臂就是它唯一有意义的语义测；判据在围栏块的表头注释里写明，不是偷偷放宽。<br>⚠️ **几何类判据没有源码尺**（页头同排高度、详情面披露）：它们的 `check:header-controls`/`detail-disclosure` 只有真浏览器 + 截图两档，**故意不进这张四档表**（进去就得给 ① 编一个假门禁）。已收的几何族：页头同排（`e2e/tests/header-controls.spec.ts`，1440+390 两档各 6 枚全 44px）与详情面披露（上面那一条）。<br>**同一趟量到并修掉本线自己的一笔缺陷**：`check:chip-typing` 第 ⑨ 枚自测臂（「拼错的旗标必须非 0 退」）是先写臂、后补闸门 —— 脚本里**根本没有拒跑那一格**，于是那枚臂从落地那天起就一直不过、`pnpm check` 整条链是红的，直到 P8 这趟逐条复量才发现。形状与 §7 那条「不能失败的检查比没有检查更糟」同族，方向相反：**不能通过的自测臂同样是噪声**。修法是把闸门补上（`KNOWN_FLAGS` 之外的旗标 ⇒ `exit 2`），不是把臂删掉。<br>**整线四档复量（2026-10-28 收尾这一趟，逐档现量）**：① 源码尺 —— `check:ux-coverage`／`check:control-semantics`／`check:chip-typing`／`check:z-ladder`／`check:overlay`／`check:dirty-form-policy`／`check:danger-confirm`／`check:menu-keyboard`／`check:empty-state`／`check:gate-wiring`／`check:e2e-specs-parse`／`check:md-tables`／`check:docs`／`check:doc-citations` 逐条 rc=0；② 语义测 —— `packages/ui` **823 条 / 55 文件**、本线在 `apps/web` 的五枚 spec（菜单键盘钩子／空态动作槽／浮层壳／危险档派生／冲突对话框）**35 条 / 5 文件**，全绿；③ 真实浏览器 —— 本线在册 spec 一次跑 **68 条全绿（6.1m，`--workers=1 --retries=0`；那一次的枚数是当时在册的 14 枚，今天这份名册以 §10 四档台账里的 `spec:` 列为准 —— 它由 `pnpm check:ux-coverage` 逐条验存在，所以不在这里抄数）**，另加 `e2e/vault/conflict-dialog.spec.ts` 1 条（真服务端 + 两台真设备）；④ 截图 —— 四张设备帧拼一张 `tier-zoom-sheet.png`、Web 侧 12 格矩阵拼一张 `contact-sheet.png`，都逐张看过。⚠️ 那一次 14 枚的跑会把 37 张**本线已入库**的帧重画（逐张与 HEAD 比过，差异 45～5,228 px / 约 130 万像素，是光标与抗锯齿噪声）⇒ 已 `git checkout` 还原，不拿噪声冒充"证据更新"；同一次跑还重画了 6 张**别线名下**的帧（`vault-panel/*` 与 `settings-finish/quadrant-move-375.png`），同样还原。<br>复量：`check:ux-coverage`／`check:gate-wiring`／`check:docs`／`check:md-tables` 逐条 rc=0；detail-disclosure 1 条绿。 <br>**四档验收第 4 档「截图矩阵」已建成（2026-10-28 同日第五批）**：`e2e/tests/button-tier-matrix.spec.ts` 把**四档按钮 × 亮/暗 × 1440/390** 一次拍全（12 格，落 `apps/web/evidence/button-tier-matrix/`，另出一张 `contact-sheet.png` 供人一眼看完（那张是**手工拼的看图辅助**，不由 spec 重画，12 格本体才是每次跑都重出的产物）—— 已看过：实底红/浅红两枚在暗色档仍分得出轻重，行内那枚四格都是透明底红字）。四档全部取自**真界面**（习惯空态动作按钮 = primary、回收站彻底删除确认层 = secondary + danger/commit、批量条那枚 = danger 行内），不是把 class 摆进页面里拍 —— 摆出来的夹具只能证明 CSS 自己等于自己，证明不了"这一档真的用在这个位置"。每格同时读**算出来的色**并与页面自己算的 token 比（`tokenRgb` 那枚探针），所以"图看起来对"与"值确实等于表里那一格"两件事一起判。<br>**矩阵随后把「悬停」这一维也量进来了（同日第五批补）**：§P8 第 4 档原文是"默认/悬停/选中/焦点"，第一版只拍了默认档 ⇒ 那句话当时只兑现了一半。四枚按钮各在**自己还在场上的时刻**量悬停后的算出来底色/字色，并与页面自己算的 `primary-hover` / `color.hover` / `danger-subtle`+`danger-strong` / `danger-strong`+`on-danger` 比；能红验证＝把 `.ht-btn--danger.ht-btn--commit:hover` 的底换成 `primary-hover` ⇒ 精确红在「悬停之后没换到 hover 档（要 rgb(185,28,28)，实际 rgb(220,38,38)）」，从 `/tmp/ux-cc2.mut-bak` 还原 `cmp` 逐字一致。⚠️ 第一版把四枚悬停全堆在用例末尾 ⇒ 等 `habits-empty-add` 等到 **60s 测试超时**（那一段早就切去回收站了）：这是"探针跑错时机"那一族，与 #606/#609 同味，红因不是产品。悬停读数一律 `expect.poll` 到终值，理由就是 #609（过渡中读到的是起点色）。看图：`apps/web/evidence/button-tier-matrix/confirm-hover-{light,dark}.png`（暗色档悬停后那枚明显转浅，静止帧与悬停帧分得开）。<br>**矩阵再把「选中」这一维补上（同日第五批再补）**：§P8 第 4 档四态里只剩"选中"没有读数 —— 落在日历页头那枚 `aria-pressed` 侧栏开关上（ghost 档：基态字色 `foreground-muted`、pressed 换 `color.primary`，**只靠颜色表达**，掉了就没人看得出"开着"）。两版探针各栽一次、都写进注释：① 第一版按"点击前一定是关着的"分配哪次是 pressed ⇒ 红在把 idle 当 pressed（读数：期望 `foreground-muted` 拿到 `rgb(37,99,235)`）⇒ 改成**把 `aria-pressed` 与字色同一时刻一起读回来**；② 第二版仍红，因为 390 档读到的是 `rgb(67,87,120)` 这种**过渡半程值**（§7 第 609 条同一个坑，第二次踩）⇒ 改成 `expect.poll` 到终值再比。能红验证：把 `aria-pressed='true'` 的字色换成 `foreground-muted`（= 选中与未选中同色）⇒ 精确红在「开关当前这一档读到的字色不对」，从 `/tmp/ux-cc2.mut-bak` 还原 `cmp` 逐字一致。看图 `apps/web/evidence/button-tier-matrix/pressed-{light,dark}.png`。⇒ 至此 §P8 第 4 档那句"默认/悬停/选中/焦点"在这一族四态齐（焦点那一维由 `focus-visible-matrix` 守，同一族两个落点在 §10 矩阵里各自成行）。能红验证：把 `.ht-btn--danger.ht-btn--commit` 的底换成 `transparent`（= 确认层那枚退回行内档那个老形状）⇒ 四条里精确红在被点名的那句（读数 `确认层那枚危险按钮的底不是 danger / Received: "rgba(0, 0, 0, 0)"`），从 `/tmp/ux-cc.mut-bak` 还原 `cmp` 逐字一致。矩阵加一行「档位矩阵（四档×亮暗×宽窄）」⇒ `check:ux-coverage` 现量 **11 族**四档齐。 |

---

## 9. 本计划的完成判据

只有同时满足以下条件，才可把本线判为完成：

1. P0-P8 各批都有能红的判据与对应变异或反向夹具，不是只有正向绿灯。
2. 全局焦点唯一实现，所有代表性控件在已选中状态仍可见键盘焦点。
3. 所有脏表单和危险确认走共享策略；撤销只出现在真正可撤销的动作上，失败有持续回执。
4. Web 与 Mobile 的按钮、toggle、chip、menu 状态由同一判断派生，各端只保留必要渲染差异。
5. 四层验收进入主链，同类缺陷在违规夹具下能被机器发现。
6. 代表性页面亮暗宽窄与四状态截图实际存在并经过人工查看。
7. 全仓账本相对本计划立项时只降不升，且每条豁免仍能解释其合理平台差异。
8. 没有覆盖并行 inbound、协作或其他会话的未提交改动；所有提交可按路径审计归属。

---

## 10. 四档覆盖矩阵（`pnpm check:ux-coverage` 的读数来源）

这一段是**机器读的**，不是散文：`scripts/check-ux-coverage.mjs` 解析下面的围栏块，
逐格断言"门禁真在 `check` 链上、落点真存在、四档没有空格、行数与门禁枚数不低于下限"。
表头那一行会被跳过（它是给人看的）。

**列的读法**：① 源码尺（`gate:`，可多枚，逗号分隔）② 语义测（`file:`；**源码类规则**这一格
指的就是那枚门禁自己的 `--self-test` 夹具臂 —— 对"源码形状"这条命题，夹具臂才是它唯一
有意义的语义测）③ 真实浏览器（`spec:`）④ 截图矩阵（`file:`，人看过的那一帧）。

<!-- ux-coverage:begin -->
控件族 | 源码尺 | 语义测 | 真实浏览器 | 截图
按钮四档×重量档 | gate:check:control-semantics | file:packages/ui/tests/control-states.spec.ts | spec:e2e/tests/control-semantics.spec.ts | file:apps/web/evidence/control-semantics/purge-confirm-1440-light.png
档位矩阵（四档×亮暗×宽窄） | gate:check:control-semantics | file:packages/ui/tests/control-states.spec.ts | spec:e2e/tests/button-tier-matrix.spec.ts | file:apps/web/evidence/button-tier-matrix/confirm-light-1440.png
chip 分型（动作 vs 徽标） | gate:check:chip-typing | file:scripts/check-chip-typing.mjs | spec:e2e/tests/chip-typing.spec.ts | file:apps/web/evidence/chip-typing/row-chips-1280.png
菜单键盘模型 | gate:check:menu-keyboard | file:apps/web/tests/menu-keyboard-hook.spec.tsx | spec:e2e/tests/menu-keyboard.spec.ts | file:apps/web/evidence/account-menu-ia/account-menu-1440-light-zh.png
脏表单关闭保护 | gate:check:dirty-form-policy | file:packages/ui/tests/overlay-dirty-popover.spec.ts | spec:e2e/tests/dirty-form-guard.spec.ts | file:apps/web/evidence/dirty-form-guard/habit-create-asks.png
危险确认与档位派生 | gate:check:danger-confirm | file:apps/web/tests/trash-purge-danger-tier.spec.ts | spec:e2e/tests/danger-confirm-trash.spec.ts | file:apps/web/evidence/danger-confirm/purge-confirm-1440-dark.png
撤销回执（时长/暂停/失败） | gate:check:undo-receipt | file:apps/web/tests/undo-receipt.spec.tsx | spec:e2e/tests/quadrant-move-ux.spec.ts | file:apps/web/evidence/undo-receipt/quadrant-receipt-1280.png
焦点环唯一实现 | gate:check:focus-single-source | file:scripts/check-focus-single-source.mjs | spec:e2e/tests/focus-visible-matrix.spec.ts | file:apps/web/evidence/focus-visible-matrix/calendar-default-1440-light.png
浮层刻度（z 阶梯） | gate:check:z-ladder | file:scripts/check-z-ladder.mjs | spec:e2e/tests/habit-create-shape.spec.ts | file:apps/web/evidence/header-controls/calendar-header-1440-light.png
空态动作槽 | gate:check:empty-state | file:apps/web/tests/empty-state-action.spec.tsx | spec:e2e/tests/habit-create-options.spec.ts | file:apps/web/evidence/empty-state-action/habits-empty-action.png
冲突对话框（真两台设备并发） | gate:check:overlay | file:apps/web/tests/conflict-dialog.spec.tsx | spec:e2e/vault/conflict-dialog.spec.ts | file:apps/web/evidence/conflict-dialog-browser/conflict-dialog-1280-light.png
意思表示层关闭口径（modal-deferrable） | gate:check:overlay | file:packages/ui/tests/overlay-dismissal-model.spec.ts | spec:e2e/tests/deferrable-sheet.spec.ts | file:apps/web/evidence/deferrable-sheets/consent-dark-1440.png
AI 重置那一格的档位派生 | gate:check:danger-confirm | file:apps/web/tests/ai-settings.spec.tsx | spec:e2e/tests/ai-reset-danger.spec.ts | file:apps/web/evidence/ai-reset-danger/confirm-dark-1440.png
<!-- ux-coverage:end -->
