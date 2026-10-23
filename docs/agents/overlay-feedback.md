<!-- 由 2026-10-23 的「浮层与反馈」适配工作拆分而来。
     本文件是**规则层**：写任何浮层 / 危险确认 / 操作回执之前必读。
     返回入口：[`AGENTS.md`](../../AGENTS.md) §4 规则地图。 -->

# 浮层与反馈（overlay / feedback）

**一句话**：视觉那一侧本仓已经很干净（9 档 `z` token、裸值 0 处、`check:design` 有牙）；
**行为那一侧此前是各页自判** —— 关闭策略 0 处显式约定、17 个 `aria-modal` 各抄一份焦点逻辑。
本文件管的是后者。

| 层 | 在哪 | 性质 |
|---|---|---|
| **通用判据**（真源） | 全局 Skill `overlay-feedback-patterns`，本机 `/Users/rocalight/.skill-catalog/personal/overlay-feedback-patterns/`（`SKILL.md` + `references/{taxonomy,dismissal-and-timing,destructive-actions,mobile-sheets,audit-checklist,glossary-zh-en}.md`） | 🔴 **仓库外**。判据以它为准；**它不进仓库 ⇒ 引用它的人必须自己能取到它**，别把它的结论抄成本文件的第二份 |
| **本仓适配层**（现状读数） | [`../reference/overlay-feedback-adaptation.md`](../reference/overlay-feedback-adaptation.md) | 现状，**不是规范**。表头带"引用前先重跑"的复现命令 |
| **本仓规则**（本文件） | 这里 | 必读。冲突时以通用 Skill 为准，再回来改本文件 |
| **代码契约** | `packages/ui/src/overlay/`（`dismissal.ts` / `OverlayModal.tsx` / `DangerDialog.tsx`）+ `packages/domain/src/danger-tier.ts` | 🔴 **规则不落进可调用函数就等于没有规则**，所以三份实现是本文件的**承重部分**，不是附录 |

---

## 1. 提浮层需求时的四要素（可验收的合同）

「加个弹窗」这种一句话需求**不许直接开工**。规格必须写全四格，缺一格 = 需求不可验收：

| 要素 | 写什么 | 取值从哪来 |
|---|---|---|
| **类** | 18 类里的哪一个（modal / alert-dialog / popconfirm / bottom-sheet / drawer / toast / snackbar / alert(页面内) / banner / progress …） | Skill 的 `taxonomy` 速查表；本仓落点见适配层 §2 |
| **关闭策略** | scrim · Esc · 系统返回键 **三个通道各是什么结果** + 是否自动消失 | 🔴 **查表，不自己定** —— `closePolicyOf()`，见 §3 |
| **时长** | 自消层几毫秒；撤销窗口几毫秒；hover/聚焦是否暂停 | Skill 的 `dismissal-and-timing` 细则 §2 |
| **危险档** | `undo` / `popconfirm` / `alert` / `typed-alert` | `resolveDangerTier()`，见 §2 |

18 类里**没有**「居中的底部面板」这一类 —— 4 个 `*Sheet.tsx` 是居中单档 Modal 冒充 sheet，那是 T7 要还的债，不是可以照抄的样板。

---

## 2. 危险档位：`resolveDangerTier()`（`@heyta/domain`）

四档：`undo`（直接做 + 撤销出口，**不弹确认**）→ `popconfirm`（就地二次确认）→ `alert`（模态确认）→ `typed-alert`（模态 + 逐字键入对象名）。

🔴 **判据的锚是「做错了要花多少代价恢复」，不是「文案里有没有『删除』二字」。**

调用约定：

```ts
import { resolveDangerTier, requiresModalCommitment, isUndoableDeletion } from '@heyta/domain';

const tier = resolveDangerTier({
  affectedCount: ids.length,
  undoAvailable: isUndoableDeletion('task'),   // 🔴 删除类别手填布尔，用这个派生
  collateralImpact: liveCount + childCount,    // 口径同 OrganizerList.tsx:449
});
if (requiresModalCommitment(tier)) { /* 只有 alert / typed-alert 用 DangerDialog */ }
```

**三条不许违反**（每条都有对应测试，`packages/domain/tests/danger-tier.spec.ts`）：

1. **撤销不是万能降档**：`externallyVisible` / `involvesPayment` / `destroysIrrecoverableResource` 三格**即使能撤销也必须保留确认**（Skill 的 `destructive-actions` 细则 §4）。撤销只能是补充。
2. **`undoAvailable` 不许手填**：可撤销的权威在 `actions.ts:635` 的运行时硬拦与 ADR-0048 的四态。手填的布尔迟早和动作层分家 ⇒ 症状是"界面给了撤销，动作层抛错"。
3. **集合级动作不自动抬档**：删空清单 = 一键直删是**已拍板**的现状（设备级验收 `scripts/verify-mobile-trash.sh` 第 6b 步钉着，fixture 数字就是 0）。摩擦由 `collateralImpact` 决定，不是由"它是个集合"决定。

⚠️ **标签是唯一例外**：不进回收站（`§7.1 P-1`）⇒ 永远要问，哪怕连带数字是 0。它和"清单只在有后果时才问"**不许合并成一条**。

🔴 **UI 层不许再比字符串**：要判"要不要模态"就用 `requiresModalCommitment()`，别写 `tier === 'alert'` —— 那会漏掉 `typed-alert`，症状是**注销账号可以点背景关掉**。

---

## 3. 关闭策略：`closePolicyOf()`（`@heyta/ui`）

三个通道（scrim / escape / systemBack）各查一次表，**组件里不许内联比较策略值**（判据问两次就有两种问法，第二种通常是错的）。

```ts
const policy = closePolicyOf(overlay);
const action = dismissActionFor(policy, policy.scrim); // 'close' | 'ask' | 'none'
```

三条不变量：

1. **`DismissOutcome` 里没有「触发确认」「保存」「提交」「扣款」** ⇒ 「Esc 被绑到主按钮」这类缺陷在类型里**写不出来**。想写就得先加一个非法取值，那会被契约测试抓到。
2. **危险确认与强制阅读不响应背景**（`scrim: 'deny'`）。危险确认**不给 ×**：出口必须是具名动作（`永久删除 12 条` / `取消`），一个灰色 × 把"这是什么决定"又推回给用户猜。
3. **本模型覆盖的每一类都 `autoDismiss: false`**。会自消的是 toast / snackbar，它们在时长那一条上，不在这张表里。

🔴 `ask-discard` 的三类里**少了 `onDismissAttempt` 就关不掉**（安全侧默认）。不是"那就直接关"——不关，用户再点一次还在；关了，填了一半的表单就没了。

---

## 4. 用哪个组件

| 场景 | 用 |
|---|---|
| 只读 / 脏表单 / 强制阅读 / 危险确认的**模态** | `OverlayModal`（`overlay` 传四类之一） |
| **贴底升起**的面板（把手 / 分档 / 下拉关） | `BottomSheet`（档位模型在同目录 `sheet-detents.ts`） |
| `alert` / `typed-alert` 两档 | `DangerDialog`（**只接这两档**，类型层挡住轻档） |
| 就地二次确认（popconfirm） | 目前仍是行内替换（`confirmingId` 模式），**没有封装** —— 三处各写一套状态机，属 T4 未还的债 |
| toast / snackbar | 本仓**刻意 0 套**（选型不是缺），见 §5 T3 |

`OverlayModal` 的地基是 react-native-web 自己的 `Modal`，不是新写的一套 —— 它白送了焦点陷阱、关闭归还焦点、`role="dialog"`/`aria-modal`，且 Esc 走 `keyup`（绕开 RN-web `TextInput` 在 `keydown` 上 `stopPropagation` 那个坑，AGENTS §7 #80），还自带模态栈只让最顶层响应。

🔴 它**故意不做**两件事，别当成漏了去补：
- 不接管背景 `inert` 与滚动锁（要碰 DOM，共享层进不来 DOM）⇒ 归宿主；
- 不做 drawer / bottom sheet / 全屏浮层（**几何不同**）⇒ 那是 `BottomSheet` 的事。
  把贴底面板塞进居中模态只会再造一个"名字叫 Sheet 其实是居中弹窗"—— 那正是移动端
  4 个 `*Sheet.tsx` 迁移前的形状。

`BottomSheet` 另外三条边界（同上，是取舍不是欠账）：
- **不引 reanimated / gesture-handler**：本仓两端都没有，为一条面板动画加原生模块不值。
  拖拽走 RN 核心的 `Animated` + `PanResponder`，代价是动画跑在 JS 线程；
- **只在把手那一条上接拖拽**：面板里是 `ScrollView`，没有原生滚动协调时"内容滚到顶
  再往下拖就收起"做不对，做一半的形状是"想滚却把面板关了"，比没有更糟；
- **返回键单开一格 `onBack`**：Android"第一次返回先收键盘、第二次才关"是已拍板行为，
  而它**不能**反向套到 × 上（键盘开着时点 × 只收键盘会读成"点了没反应"）。

**写第二份之前先看这三条**（细节与行号在适配层 §6）：

- `LegalDocumentSheet.tsx:350` 是共享层里**既存的第二份模态外壳** ⇒ 它的归宿是 `OverlayModal`（T5/T8），不是样板；
- `apps/web/src/lib/use-modal-dismiss.ts` 在 T2 之后是**待退役的那一份**，不是"现成装置" —— 再把 Esc/焦点归还推给其余 15 层就是在固化第二份实现，迁移时连带删它；
- `packages/ui` **没有共享 `Button`**（仓内已有四份按钮色板）。`DangerDialog` 的动作按钮是内联的，
  tone 与禁用态逐字对齐 `apps/mobile/src/ui/kit.tsx:750,753`。**缺的是补一枚共享 `Button`（独立一档），不是再多抄一份 tone 表。**

---

## 5. 门禁与债务账本

`pnpm check:overlay`（`scripts/check-overlay.mjs`）管两条**只减不增**的债：

- **R1 原生对话框**：`window.confirm/alert/prompt`、RN `Alert.alert/prompt`、无本地绑定的裸 `confirm(...)`。
  罪状不是丑，是**放不下后果说明、无法本地化、无法测焦点、无法做逐字键入确认**。
- **R2 自绘模态层**：`aria-modal` / `role="dialog"` 的落点。新增的模态必须走 `OverlayModal` / `DangerDialog`。

**账本制**：账外出现 ⇒ 红；账内读数涨了 ⇒ 红；**账内读数掉了也红**（要求同步把账本那一行改小）。
第三臂常被想写成"应该放过"，但那会让门禁失去**唯一能证明自己在缩**的读数，而 T1/T5 的验收口径就是它。

现量（2026-10-23，会漂，**别抄**，跑 `node scripts/check-overlay.mjs` 自取）：原生框 **8 处 / 5 文件**；自绘模态 **42 处 / 19 文件**。

---

## 6. 整改分档与顺序

顺序是 **T2 → T1 → T5 → T4 → T3 → T6 → T7 → T8**。T2 已落地（本文件的代码契约就是它）；
T7 已开工，第一块（`TaskDetailSheet`，移动端最高频的那一块面板）已迁到 `BottomSheet`。

🔴 **四处不能照通用 Skill 的梯子抄**（本仓在四个格子上和"典型病灶"**相反**）：

| 档 | 通用 Skill 的典型动作 | 本仓的正确动作 |
|---|---|---|
| **T3**（反馈分层） | 别的仓是"两套 toast 合一" | 本仓 **0 套 toast**，且 `InviteActivityCard.tsx:37` 明写"不做成全局 toast" ⇒ 正确动作是把 **24 处就地提示行 + 34 处 `role="alert"`** 收成共享 Alert 组件（正对 Skill §8 第一条"别把 5 级压成 1 级"） |
| **T1**（清原生框） | 先删 | 移动端那 **4 处 `Alert.alert` 不能先删** —— 它是 RN 端唯一确认形态，先删等于没有确认。它**依赖 T2 的原语先存在**（所以 T2 排第一） |
| **T6**（危险档对齐） | 一半被本地 ADR 否掉 | ADR-0048 §3.2 明写**不设自动保留期** ⇒ 撤销文案永远不许出现"30 天内可恢复"；purge／注销账号／授权撤销／分享发布／AI 出网／数据销毁六格的"可撤销"前提不成立，**保留重档确认框是正确结论，不是欠账** |
| **T7**（移动端形态） | "都改成底部面板" | 🔴 **法律闸门那两块不迁**：`PrivacyConsentSheet` / `LegalReconfirmSheet` 是合规面板 —— 把它们变成**能一把划走**的底部面板，等于给"同意 / 不同意"旁边加了一条"划掉"。它们保持居中模态不是欠账，是**正确结论**（隐私面板的可见退出口写的是"以后再说"三个字而不是 ✕，r150 装机态读数钉着）。T7 的对象是**日常面板**（任务详情、冲突解决），不是法律闸门 |

真正影响产品观感的两档：**T5**（关闭策略，现在 0 处约定 + 一次 Esc 连关两层）与 **T7**（移动端面板名不符实，把手/分档/记忆全 0 —— 直接决定 iOS/Android/鸿蒙三端质感，但视觉面最大）。

---

## 7. 与相邻规则的关系（别写出第三份裁决）

| 那一份 | 它管什么 | 本文件管什么 |
|---|---|---|
| [`design-system.md`](design-system.md) | 颜色/间距/字号的**视觉**纪律（裸值 0） | **行为**纪律（怎么关、弹多重、多久消失） |
| [`design-system-behavior.md`](../reference/design-system-behavior.md) §1 | 浮层只有 Sheet 一行（遮罩/Esc/焦点回收） | 那一行之外的**全部**：关闭矩阵、危险档位、时长规则 |
| [ADR-0048](../adr/0048-deletion-four-states-and-the-no-physical-erase-boundary.md) | **哪些动作不可逆**（四态 + 不设自动保留期） | 从它**派生**档位，**不取代**它 |
| `OrganizerList.tsx:640` 的 `askOnlyWhenImpact` | 仓内已有的"什么时候该问"判定 | 同向，**不许变成它的第二份** —— 新判定必须先对账 |

🔴 **共享层的两条硬边界**（写组件时记住，违反会当场红）：
- `packages/ui` **不许 import i18n** ⇒ 文案走 `labels` prop 注入（`OverlayModalLabels` / `DangerDialogLabels`）；
- 新组件必须登记进 `scripts/check-ui-provider.mjs` 的 `PROVIDER_DEPENDENT`（`DangerDialog` 在 Provider 之外不是"样式难看"，是**整层渲染不出来**）；
- `packages/ui/src/index.ts` **只许末尾追加**。
