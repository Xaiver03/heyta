/**
 * 快速捕捉（共享视图）
 * ======================
 *
 * M3 第八刀的主角：**"输入一句话 → 看见我读懂了什么 → 逐条确认/取消 → 提交"
 * 这件事只有这一个实现。** web 与 mobile 只决定把它放在页面的哪里、
 * 注入文案，以及挂哪些各端特有的东西（今天只有 web 的 AI 面板走插槽）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么需要它（不是"少写点代码"）
 *
 * 迁之前 web 有 `features/capture/CaptureComposer.tsx`（293 行 DOM/CSS 实现），
 * 而 **mobile 一行都没有** —— 快速捕捉是移动端完全缺失的签名功能（计划 §P8）。
 * 它是"把一句话变成任务"的唯一入口，也是**唯一会读懂用户输入**的界面：
 * 两端各自实现的结果是"同一句'明天交周报'在两台设备上被读成两个样子，
 * 而差异不会让任何测试变红"。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 解析、判断、换算的分工（每一层都有单一实现）
 *
 *   · 解析（什么算日期 / 优先级 / 谁生效）→ `@heyta/domain#parseCapture`
 *   · 芯片三态 / 忽略清单 / 提交换算     → 本目录 `./model.ts`（node 单测跑穿）
 *   · 措辞（还剩几天 / 优先级叫什么）     → 宿主注入（`labels`）
 *   · 写库（op-log）                      → 宿主 action 层（AGENTS.md §3.5）
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 契约：识别结果一律先显示，**绝不替用户删字**
 *
 * `packages/domain/src/capture.ts` 的文件头把这条写成了不变量：
 * 每一个被移除的片段都对应一条 `applied: true` 的记录；同一个字段出现多次时
 * 只有第一条被采纳，**后一条原样留在标题里**。本组件因此有三条硬行为：
 *
 *   1. 有识别就一定渲染出来（`未采用` 的那些也必须出现）；
 *   2. 每一条都能单独取消，取消 = 把那段文字**放回标题**（只动忽略清单，
 *      **绝不动输入框里的字**）；
 *   3. 空标题（只输入"明天"）不许提交。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 没装进共享层的（逐条写清：证据 + 影响 + 最小一步）
 *
 * 1. **AI 一句话捕获面板**（`apps/web/src/features/ai/AiCapture.tsx`，约 380 行）
 *    **不在本组件里**，也不再由任何宿主插进本组件（2026-11）。
 *    它整体搬进了右侧助手（`AssistantPanel`）。本组件原来给它留过
 *    `renderAssistant` 插槽，搬家时一并删掉了。
 *    · 影响：捕获框只剩确定性解析 —— 这是产品裁决，不是能力缺口。
 *
 * 2. **提交到 op-log 的那一步**（`addTask`）留在宿主。判据是 AGENTS.md §3.5：
 *    本组件产出的是 `CaptureSubmitPlan`（纯数据），"写哪些字段、发什么 op"
 *    由宿主 action 层决定。
 *
 * 3. **输入框的悬停态**：web 迁移前 `.ht-input` 有 `:hover` 换边框色，
 *    RN `TextInput` 没有 hover（移动端本来也没有鼠标）。
 *    · 影响：桌面 web 的输入框悬停反馈消失 —— 这是"RN 原语换 DOM"的必然落差，
 *      与计划 §「已知会卡住的地方」最后一行同一类，**不是实现细节**。
 *    · 最小一步：加 `onHoverIn`/`onHoverOut` 状态 + 边框色，需要产品先定"要不要给鼠标做降级"。
 *
 * 4. **输入框的字号（iOS Safari 聚焦缩放）**：迁移前 web `<input>` 的字号来自
 *    `.ht-input`（`--ht-font-size-sm`）；现在由 RN `TextInput` + `text['row-meta']`
 *    给。两者当前同值，但"≥16px 才不缩放"这条约束**没有任何门禁在盯**
 *    （web 的 `--ht-font-size-sm` 目前小于 16px —— 与迁移前逐字相同，
 *    所以不是本刀引入的）。
 *    · 最小一步：把这条约束写进 `check:design` 或验收脚本，而不是靠注释。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 文案一律由宿主注入，本文件不 import `@heyta/i18n`
 *
 * 与 `HabitBoard` / `QuadrantBoard` / `TaskList` 同一个理由：i18n 包自己带过
 * 一份 React，四端会同时中招（`check:mobile-bundle` 盯着）。依赖行内容的
 * 文案（`restoreAria` / `ignoreAria` / `valueLabel`）因此是函数。
 *
 * 🔴 只用 RN 原语，不 import 任何 DOM 标签
 *
 * `View` / `Text` / `TextInput` / `Pressable` 在 `react-native-web` 上都有
 * 等价实现；`<input>` 在 iOS 上不存在。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { HeytaNativeTokens } from '@heyta/design-system';
import { dueDateToEpoch, today } from '@heyta/domain';
import type { CaptureExclusion, LocalDate, LocalTime } from '@heyta/domain';
import { Calendar, ChevronDown, Plus, RotateCcw, X } from 'lucide';
import { HeytaIcon } from '../icon/Icon.js';
import { useHeytaText, useHeytaTokens } from '../theme.js';
import {
  CaptureDuePanel,
  CaptureDuePanelOutlet,
  type CaptureDuePanelLabels,
  type CaptureDuePanelOutletPlacement,
  type CaptureDuePanelState,
} from './CaptureDuePanel.js';
import type { DatePickerQuickPick } from '../date-picker/DatePicker.js';
import {
  captureCanSubmit,
  captureCapsuleKind,
  captureDue,
  captureFragmentSignature,
  captureRowChips,
  captureSelectedProject,
  clearCaptureDue,
  makeCaptureOverride,
  parseCaptureDraft,
  shouldResetCaptureIgnore,
  toCaptureChips,
  toCaptureSubmitPlan,
  toggleCaptureIgnore,
  withCaptureProject,
  withCaptureRange,
  withCaptureRepeatPreset,
  type CaptureCapsuleKind,
  type CaptureChip,
  type CaptureDue,
  type CaptureOverride,
  type CaptureProjectPicker,
  type CaptureSubmitPlan,
  type CaptureRepeatPreset,
} from './model.js';

/**
 * 面板全部文案，**每一项都由宿主注入**（见文件头）。
 *
 * ⚠️ 没有"未采用"以外的空态文案：捕获框没有内容时不渲染任何东西 ——
 * 空输入框上挂一句"还没有识别结果"是在制造视觉噪音。
 */
export interface CaptureComposerLabels {
  readonly placeholder: string;
  /**
   * 第二行的占位（只在 `descriptionInput` 时用）。不给就画空串 ——
   * 空串会让那一行变成"没有提示的输入框"，所以开了 `descriptionInput` 的宿主必须给。
   */
  readonly descriptionPlaceholder?: string | undefined;
  /** 输入框的无障碍名（`<input aria-label>`）。 */
  readonly addLabel: string;
  /** 提交按钮上的字。 */
  readonly add: string;
  /** 识别结果那一组的无障碍名（`<ul aria-label>`）。 */
  readonly matchesAria: string;
  /** 被用户显式忽略的那条显示什么。 */
  readonly rejected: string;
  /** 未被采纳（还在标题里）的那条旁边的说明。 */
  readonly unused: string;
  /** 恢复识别的无障碍名。**一整句**，不要用前缀拼 raw。 */
  readonly restoreAria: (raw: string) => string;
  /** 忽略识别的无障碍名。 */
  readonly ignoreAria: (raw: string) => string;
  /**
   * 一条**生效中或未被采纳**的芯片的取值文案。
   *
   * 🔴 `now` 由本组件**同一次渲染**的"现在"传进来 —— 解析结果与这条文案
   * 必须用同一个时间源，否则跨零点时同一屏上的两行会算出不同的日期
   * （与 `TasksScreen` 冻结 `now` 是同一条纪律）。宿主只负责措辞，
   * 天数由 `./model.ts` 的 `captureChipRemainingDays` 算。
   */
  readonly valueLabel: (chip: CaptureChip, now: number) => string;
  /**
   * 日期胶囊上的字。**三档由共享层判**（{@link captureCapsuleKind}），
   * 宿主只管说话。
   *
   * 🔴 `kind === 'empty'` 必须返回**空串** —— 那时只画图标。写「未设置」是本仓
   * 明令禁止的审计腔，而写一句灰字提示会让"没选日期"与"选了但看不见"
   * 在截图上不可分辨（`docs/agents/ux-principles.md`）。
   */
  readonly capsule: (due: CaptureDue, kind: CaptureCapsuleKind, now: number) => string;
  /**
   * 胶囊的无障碍名。**一整句**，带上当前的值 —— `accessibilityLabel` 会盖掉
   * 按钮里的可见文字，所以值不在这里说就读屏听不到。空串那档宿主要说
   * "选择截止日期"，不是把空串原样交回去。
   */
  readonly capsuleAria: (text: string) => string;
  /** 胶囊点开的那块面板的措辞。 */
  readonly panel: CaptureDuePanelLabels;
}

/**
 * 宿主拿到的面板挂载位。
 *
 * 🔴 共享层**不判外壳**：web 要锚定浮层，移动端要么 `BottomSheet` 要么就地展开，
 * 而"就地展开"这一档（日历那个已经浮着的捕获层）连宿主都不需要写 ——
 * `renderDuePanel` 不传就是它。判断（哪一天、几点、哪段字被消费）全在共享层。
 */
export interface CapturePanelSlot {
  readonly open: boolean;
  /** 共享的 `CaptureDuePanel`，宿主把它放进自己的外壳里。 */
  readonly content: React.ReactNode;
  /**
   * 出口段（日期视图的「时刻 …」行 / 时刻视图的「其它时间 ↔ 列表」切换）。
   *
   * 🔴 **只有把 `duePanelOutlet` 设成 `'footer'` 的宿主才会拿到它**，而且那时
   * `content` 里已经不含这一段 —— 两边永远只有一处画出口，不会重复也不会双双消失
   * （这条由 `check:capture-shape` 钉着）。默认 `'inline'` 时本字段是 `undefined`，
   * web 两档外壳一行都不用改。
   */
  readonly footerContent?: React.ReactNode;
  /**
   * 此刻输入框里的那句话（原文，含被识别出的片段）。
   *
   * 🔴 为什么必须由共享层给：外壳是**模态**的宿主（移动端 `BottomSheet`）起来后，
   * 背景整棵从可及性树里掉出去、屏幕上也被壳盖住 —— 用户看不见自己正在给哪句话设截止。
   * 那一条是不变量（§9.6 当初就因为它撤过壳），而"说出来"这件事只有拿着原文的共享层能做：
   * 宿主拿不到草稿，也不该自己去猜。`''` = 还没打字，那时标题回到静态那句。
   */
  readonly subject: string;
  readonly onClose: () => void;
}

export interface CaptureComposerProps {
  readonly labels: CaptureComposerLabels;
  /** 提交。字段已换算成 `Task` 约定（`dueDate` = epoch ms）。 */
  readonly onSubmit: (plan: CaptureSubmitPlan) => void | Promise<void>;
  /**
   * **锚点日**（R11 批五：日历里"说一句话落进选中那一格"）。
   *
   * 🔴 语义是**兜底**，不是覆盖：输入里解析出的日期赢，其次才是锚点，
   *   都没有才不带 `dueDate`（优先级与理由在 `toCaptureSubmitPlan`）。
   *   ⚠️ 给了锚点就**必须在界面上说出来**（宿主负责，见它的 placeholder）——
   *   悄悄改变一条任务的落点，是"界面没说谎但用户以为没说"那一类缺陷。
   */
  readonly anchorDate?: LocalDate | undefined;
  /**
   * 时间源（epoch ms）。默认 `Date.now()`（每次渲染取一次）。
   * 显式传入才能让"跨零点/今天是几号"可复现（与 `parseCapture` 同一约定）。
   */
  readonly now?: number;
  /**
   * 输入框自动聚焦。
   *
   * 🔴 移动端把它放在**新建任务面板**里（一个 modal），弹出即该打字；
   * 而 web 把它内联在列表顶部 —— 一进页面就抢焦点会打断读屏与滚动。
   * 所以它是宿主决定的事，不是共享层的默认值。
   *
   * ⚠️ **原生端不把 `autoFocus` 直接交给 `TextInput`，而是自己排一个
   * 延后 `focus()` + 卸载前 `blur()`**（见下面那个 `useEffect`）。原因是一次真实崩溃：
   *
   * 崩溃形状（`Heyta-2026-10-24-*.ips`，四次落在同一处）——
   * 宿主把本组件包在条件渲染里（`{open && <CaptureComposer autoFocus/>}`），
   * 于是**"聚焦"与"卸载"撞在同一帧**：`autoFocus` 让 view 抢第一响应者，
   * 而 React 同时把子树 unmount。Fabric 的 `View` 命令（`focus` / `blur`）是
   * **void 异步方法**，走 `ObjCTurboModule::performVoidMethodInvocation`；
   * 那条路径上的 `@catch` 只做 `@throw exception`（`RCTTurboModule.mm:462-464`），
   * 异常于是逃出 dispatch block ⇒ `std::terminate` ⇒ **`SIGABRT`**。
   * 又因为 RN 那条分支**不**把异常转成 `JSError`，`.ips` 里**既没有 `asi`
   * 也没有 `exceptionReason`** —— 拿到报告也读不出是哪一次调用。
   * 所以这里不能"等抓到再说"，而要**从形状上消除这个竞态**。
   *
   * 两条纪律：
   *   1. 聚焦推迟到下一拍，让父层 `KeyboardAvoidingView` 先完成订阅与测量
   *      （这同时修掉了原先注释提过的"键盘先于父层出现"）；
   *   2. 卸载前**先 `blur()`**，把第一响应者交还掉，再让 view 被摘下。
   *
   * web 上仍是原样透传 —— `react-native-web` 的 `TextInput` 没有这条原生命令，
   * 不走 Fabric 那条路，也就没有这个竞态。
   */
  readonly autoFocus?: boolean;
  readonly testID?: string;
  /**
   * 「落进哪一份清单」那一行。不传就不渲染（web 不传 —— 它靠侧栏选中，
   * 传了会变成两处说同一件事）。
   */
  readonly projectPicker?: CaptureProjectPicker | undefined;
  /**
   * 日期胶囊点开的那块面板**由宿主装外壳**。
   *
   * 🔴 不传 = **就地展开**（面板画在输入行下方，跟着文档流）。
   * 这是给"已经在一个浮层里"的落点用的（日历那个捕获浮层），不是"还没接"的占位档：
   * web 主列表与移动端新建面板都传了各自的外壳。
   */
  readonly renderDuePanel?: ((slot: CapturePanelSlot) => React.ReactNode) | undefined;
  /**
   * 面板出口段画在哪儿：`'inline'`（默认，画在面板体里）或 `'footer'`（单独给宿主，
   * 由宿主放进滚动区之外）。这是**外壳几何**的差别，不是措辞或判断的差别 ——
   * 移动端的底部面板只有 `footer` 永远可见，出口留在滚动内容里就等于
   * "非整半点填不进去"；web 两档没有这个问题，所以一行都不用改。
   */
  readonly duePanelOutlet?: CaptureDuePanelOutletPlacement;
  /**
   * 面板里那四枚快捷项（今天 / 明天 / 本周末 / 下周一）。
   *
   * 日期数学在 `@heyta/domain#quickDuePickDates`，**措辞**只能由宿主给
   * （共享层不 import i18n）。不传就是没有快捷项，月历照常 —— 日历那个
   * 已经锚在某一格上的落点确实不需要再问一次"要不要今天"。
   */
  readonly quickPicks?: readonly DatePickerQuickPick[];
  /**
   * **一次性填充请求**（2026-11-14，首启引导用）。
   *
   * `nonce` 变化 ⇒ 把 `text` 灌进输入框、清空上一份识别与面板选择、聚焦。
   * 语义与 `settingsRequested` 那类"取到即清"的意图一致：它**不是状态**，
   * 是一次性动作 —— 父层重渲染（同一个 nonce）不会重放，否则会把用户已经
   * 改过的字冲掉。
   *
   * 🔴 为什么不让引导直接建任务：`@heyta/domain#parseCapture` 的文件头第 2 条
   * 要求**调用方必须把 `matches` 展示给用户确认**。直接落库等于跳过那一步，
   * 把"误报"变成静默的数据改写。所以这条路只能是"灌进输入框，让用户看着
   * 识别芯片按回车"。
   */
  readonly fillRequest?: { readonly text: string; readonly nonce: number } | undefined;
  /**
   * 画不画**第二行**（补充说明）。
   *
   * 🔴 默认 `false`，且这是个**挑着给**的能力，不是"没做完的默认值"：
   * 移动端的新建面板是一屏只干一件事的弹层，标题 + 描述两行正好；
   * web 的捕获条内联在列表顶部，多一行会把整个列表往下推、把"记一条"变成"填个表"。
   * 形状不同是**载体的差别**，不是两个产品。
   */
  readonly descriptionInput?: boolean | undefined;
  /**
   * 开不开「时间段」（S7）。它住在**日期面板里面**（面板打开后才出现一行「时间段 ›」），
   * 不是常驻行 —— 开它不会把 web 顶部列表往下推。默认 `false`（逐字节等价于改动前）。
   */
  readonly rangeEnabled?: boolean | undefined;
  /** 开不开「重复」（S6）。同样住在面板里（打开面板才出现 chip 行），默认 `false`。 */
  readonly repeatEnabled?: boolean | undefined;
}

/** 取一份 token 表，建出这套样式。**一个裸尺度值都没有**（`check:design` 会拦）。 */
function makeStyles(tokens: HeytaNativeTokens) {
  return StyleSheet.create({
    /** 标题行 + 描述行 = 一组（组内 4dp，与"标签→控件"同档）。 */
    titleGroup: {
      gap: tokens['space.1'],
    },
    /**
     * 第二行（补充说明）。**与标题同档 44dp、同一块无边界输入面**，
     * 只是弱一档色 —— 它是"补充"，不是"第二个必填"。
     */
    descriptionInput: {
      minHeight: tokens['touch-target.min'],
      paddingHorizontal: tokens['size.field-padding-x'],
      /**
       * 🔴 2026-11-16：从"无边界输入面"改成**浅底 + 一条细线**。
       *
       * 产品负责人看任务页的第一句是「默认下面好像有一层灰色的底层遮罩」——
       * 根因是页面底 `#f8fafc` 与白卡片只差 7/255。页面改白之后，
       * `color.surface`（白）的输入面在它上面**完全消失**：截图里只剩 placeholder 一行字，
       * 读起来不像输入框。滴答清单的 composer 同样是"浅底 + 极细的边"。
       *
       * ⚠️ 这条同时推翻 2026-10-07「无描边交互」在**输入面**这一格的适用性：
       * 产品 2026-11-16 的口径是「全局不用彻底禁止描边」。按钮仍不画静止描边。
       */
      borderWidth: tokens['border-width.thin'],
      borderColor: tokens['color.border'],
      borderRadius: tokens['radius.lg'],
      backgroundColor: tokens['color.surface'],
      color: tokens['color.foreground-muted'],
      textAlignVertical: 'center',
    },
    wrap: {
      /**
       * 🔴 这里曾是 `space.2`（8dp），而 `projectWrap` 也是 8dp ⇒
       * 「标题输入 → 快捷胶囊 → 落点标签 → 落点胶囊」四段的间距**完全一样**。
       * 真机实测（新建面板）：输入行底 1010 → 落点标签 1034（24px=8dp）→
       * 落点胶囊 1112（也是 24px=8dp）。眼睛读不出"标签属于它下面那枚胶囊"。
       *
       * 段落之间拉到 12dp，标签→控件收到 4dp（`projectWrap`），
       * 两档之比 3:1 —— 这是 `docs/agents/ux-principles.md` §6b 第三条要求的
       * "标签离它控制的东西更近"。
       */
      gap: tokens['space.3'],
    },
    /** 输入行：输入框吃掉剩余宽度，按钮贴右。 */
    /**
     * 输入区**外框**（2026-11-16 产品口径：「主要是 UX」+ 参照 DSH 的 composer）。
     *
     * 形状从"输入框 | 日期胶囊 | 添加按钮"三个并排控件，收成**一个容器内上下两层**：
     * 上层输入、下层工具行。这与参照图一致，也解决三个并排控件在 375dp 上
     * 争宽度、placeholder 被挤断的问题（真机「添加任务，回车确认（可写「明天下」
     * 就是这么断的）。
     *
     * 🔴 承载只靠**一圈细边**（白底 + `color.border`）：页面改白之后，
     * 靠灰底分层会把它变成"又一块灰"。
     */
    compose: {
      flexDirection: 'column',
      gap: tokens['space.2'],
      padding: tokens['space.2'],
      borderWidth: tokens['border-width.thin'],
      borderColor: tokens['color.border'],
      borderRadius: tokens['radius.lg'],
      backgroundColor: tokens['color.surface'],
    },
    /** 工具行：日期胶囊在左，主操作在右（参照图里工具行的排法）。 */
    toolRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.2'],
    },
    /** 中间那段空白：把主操作推到工具行右端。 */
    toolSpacer: {
      flex: 1,
    },
    input: {
      /*
        🔴 **不要 `flex: 1`**（2026-11-16）。它是"输入框与按钮并排一行"那个时代的写法；
        `compose` 改成列之后，`flex: 1` 让输入框**吃掉外框的剩余高度** ——
        实拍：输入文字与工具行之间凭空多出 45pt 空白，外框整体被撑高一倍。
        列方向里它只需要"撑满宽度 + 不小于触控下限"。
      */
      alignSelf: 'stretch',
      minHeight: tokens['touch-target.min'],
      paddingHorizontal: tokens['size.field-padding-x'],
      /**
       * 🔴 2026-11-16：输入框**自己不再画框** —— 它现在住在 `compose` 那个外框里。
       * 两层各画一圈边会变成"框中框"（参照图里也只有外框一圈）。
       */
      borderWidth: 0,
      backgroundColor: 'transparent',
      color: tokens['color.foreground'],
    },
    /**
     * 主操作：**圆形图标键**（2026-11-16，参照 DSH 的发送键）。
     * 从"圆角矩形 + 「添加」二字"改成圆形 —— 文字版在窄屏会把工具行挤成两行，
     * 而"+"在这个位置是共识符号（无障碍名仍由 `labels.add` 提供，见 JSX）。
     * `aspectRatio: 1` + `minHeight` 保证它是正圆且不小于 44dp 触控下限。
     */
    addButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      /*
        🔴 用**显式宽高**而不是 `aspectRatio: 1`：在 `flexDirection: 'row'` 的容器里，
        Yoga 会先按可用宽度分配、再由 `aspectRatio` 反推高度 —— 窄屏上算出
        比 `minHeight` 更大的正方形，圆形按钮**溢出外框**（真机与 390 视口实拍都出现）。
        显式 `width`/`height` 是确定的，且两者都取 44dp 触控下限。
      */
      width: tokens['touch-target.min'],
      height: tokens['touch-target.min'],
      paddingHorizontal: 0,
      borderRadius: tokens['radius.full'],
    },
    addEnabled: {
      backgroundColor: tokens['color.primary'],
    },
    addDisabled: {
      backgroundColor: tokens['color.primary'],
      opacity: tokens['state.disabled-opacity'],
    },
    /**
     * 日期胶囊：**长在输入行内部右侧**，与输入框同一个高度档（一档一个高度，
     * `docs/agents/ux-principles.md` §1）。它常驻，不随聚焦长出 ——
     * "没选日期"与"选了但看不见"必须在截图上分辨得出来。
     */
    capsule: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.1'],
      minHeight: tokens['touch-target.min'],
      paddingHorizontal: tokens['size.field-padding-x'],
      borderRadius: tokens['radius.md'],
      borderWidth: tokens['border-width.thin'],
      borderColor: tokens['color.border'],
      backgroundColor: 'transparent',
    },
    /** 有值时换主色描边与主色字：空态只画图标，不靠底色说话。 */
    capsuleOn: {
      borderColor: tokens['color.primary'],
    },
    capsuleText: {
      color: tokens['color.primary'],
    },
    /** 芯片行：可换行，与 web 迁移前的 `flex-wrap` 一致。 */
    chips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: tokens['space.2'],
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.1'],
      /**
       * 🔴 这里曾是 `size.chip-height`（28px）—— 那是"**标签胶囊**"的高度，
       * 用来画一枚**可点的选项**就低于触控下限。真机实测：新建面板里那枚
       * 「收集箱」落点按钮矩形 `[48,1160][223,1244]` ⇒ **28dp 高**，
       * 而同屏的标题输入框是 44dp（`touch-target.min`）。
       *
       * 它同时犯了两条：① 触控目标不足；② 同一张表单里出现了两档控件高度。
       * 取值改用 `touch-target.min`，与输入框同档 —— 这也让 web 端的 chip 一起变高，
       * 但 web 的输入框本来就是 44，一致性优先于"胶囊看起来更小"。
       */
      minHeight: tokens['touch-target.min'],
      paddingHorizontal: tokens['size.chip-padding-x'],
      borderRadius: tokens['radius.full'],
      backgroundColor: tokens['color.primary-subtle'],
    },
    /** 标题独占一行，芯片在它下面成组 —— 芯片是换行排的，标题混进去会像第一枚芯片。 */
    projectWrap: {
      /** 标签**属于**它下面那一排胶囊 ⇒ 比段落间距更近（§6b 第三条）。 */
      gap: tokens['space.1'],
    },
    projectRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: tokens['space.2'],
    },
    projectTitle: {
      color: tokens['color.foreground-subtle'],
    },
    projectChip: {
      /** 同上：可点 ⇒ 触控下限，不用"标签胶囊"那一档。 */
      minHeight: tokens['touch-target.min'],
      paddingHorizontal: tokens['size.chip-padding-x'],
      borderRadius: tokens['radius.full'],
      borderWidth: tokens['border-width.thin'],
      borderColor: tokens['color.border'],
      backgroundColor: 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
    },
    /**
     * 选中那一枚**不只靠底色**区分：暗色下 `primary-subtle` 与透明底差别很小，
     * 所以同时换边框色与文字色（装配判据另钉 `aria-selected`，见 §9.16 那格）。
     */
    projectChipOn: {
      borderColor: tokens['color.primary'],
      backgroundColor: tokens['color.primary-subtle'],
    },
    projectChipText: {
      color: tokens['color.foreground'],
    },
    projectChipTextOn: {
      color: tokens['color.primary'],
    },
    /**
     * 未被采纳 / 已忽略：用**虚线边框 + 弱化色**。
     * 不能让它消失 —— 它会消失就等于告诉用户"这条生效了"。
     * ⚠️ RN 的 `borderStyle: 'dashed'` 只在四边等宽时可靠，这里正是四边等宽。
     */
    chipOff: {
      backgroundColor: 'transparent',
    },
    chipRaw: {
      color: tokens['color.foreground'],
    },
    /**
     * 未被采纳 / 已忽略的芯片里，**原文也跟着弱化** —— 迁移前
     * `.ht-capture__chip--off { color: …subtle }` 是靠 CSS **继承**做到这一点的，
     * RN 没有继承，必须显式给（不给的话 off 芯片的原文会比迁移前更抢眼，
     * 而它恰恰是"还没生效"的那一条）。
     */
    chipRawOff: {
      color: tokens['color.foreground-subtle'],
    },
    chipArrow: {
      color: tokens['color.foreground-subtle'],
    },
    chipValue: {
      color: tokens['color.primary'],
    },
    chipValueOff: {
      color: tokens['color.foreground-subtle'],
    },
    chipHint: {
      color: tokens['color.foreground-subtle'],
      fontSize: tokens['font-size.2xs'],
    },
    /** 数字（日期、计数）等宽 —— 否则同一个芯片在两次渲染里宽度会跳。 */
    numeric: {
      fontVariant: ['tabular-nums'],
    },
    /** 取消 / 恢复按钮：一个圆形可点区域。 */
    chipToggle: {
      alignItems: 'center',
      justifyContent: 'center',
      width: tokens['icon.sm'],
      height: tokens['icon.sm'],
      borderRadius: tokens['radius.full'],
    },
  });
}

export function CaptureComposer({
  labels,
  onSubmit,
  anchorDate,
  now,
  autoFocus,
  testID,
  projectPicker,
  renderDuePanel,
  duePanelOutlet = 'inline',
  quickPicks,
  fillRequest,
  descriptionInput = false,
  rangeEnabled = false,
  repeatEnabled = false,
}: CaptureComposerProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);

  const [draft, setDraft] = useState('');
  /** 第二行。只在 `descriptionInput` 时被渲染与提交，否则恒为空串。 */
  const [descriptionDraft, setDescriptionDraft] = useState('');
  /** 用户显式忽略的识别。**是"这段字是标题的一部分"，不是"删掉这几个字"。** */
  const [ignored, setIgnored] = useState<readonly CaptureExclusion[]>([]);
  /** 面板里点出来的截止值。绑在"被消费的那段字"上，那段字一变它就作废（`model.ts` §二·五）。 */
  const [override, setOverride] = useState<CaptureOverride | undefined>(undefined);
  const [panelOpen, setPanelOpen] = useState(false);
  /*
   * 🔴 面板的子视图状态住在这里，**不住在面板里** —— 不是为了"更纯"。
   * 出口段要能画在面板体之外（移动端底部面板的 `footer` 是唯一永远可见的位置），
   * 而"点出口 ⇒ 面板体切子视图"这件事只有两边读同一份状态才成立。
   * 留在面板里时，把那段 JSX 复制给宿主就会造出第二份状态：footer 点了，面板不动。
   */
  const [panelView, setPanelView] = useState<'date' | 'time' | 'range'>('date');
  const [panelManual, setPanelManual] = useState(false);
  const [panelTimeDraft, setPanelTimeDraft] = useState('');
  /** 「时间段」草稿（S7）。仅在 `rangeEnabled` 时被渲染与提交。 */
  const [rangeStart, setRangeStart] = useState<LocalDate | undefined>(undefined);
  const [rangeTime, setRangeTime] = useState<LocalTime | undefined>(undefined);
  const [rangeDuration, setRangeDuration] = useState<number | undefined>(undefined);
  /** 「重复」预设草稿（S6）。仅在 `repeatEnabled` 时被渲染与提交。 */
  const [repeatPreset, setRepeatPreset] = useState<CaptureRepeatPreset | undefined>(undefined);

  /** 原生端自己控制焦点（见 `autoFocus` 的说明）；web 不需要。 */
  const inputRef = useRef<TextInput>(null);
  const managesFocusItself = autoFocus === true && Platform.OS !== 'web';

  useEffect(() => {
    if (!managesFocusItself) return;
    // 延后一拍：父层（modal / KeyboardAvoidingView）先完成订阅与测量再抢焦点。
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    // 🔴 卸载前**先交还第一响应者**，再让 view 被摘下 —— 否则就是那次 SIGABRT。
    return () => {
      clearTimeout(timer);
      inputRef.current?.blur();
    };
  }, [managesFocusItself]);

  /**
   * 一次性填充（首启引导的示例 chip）。**只认 `nonce`** ——
   * 同一个请求被父层重渲染时不该重灌，否则会把用户已经改过的字冲掉。
   *
   * 换字必须把"上一段字"的派生态一起作废（忽略项 / 面板选择 / 面板开合）：
   * 留着它们就会出现"新文本 + 旧忽略项"这种界面说不清的状态。
   */
  const fillNonce = fillRequest?.nonce;
  useEffect(() => {
    if (fillNonce === undefined || fillRequest === undefined) return;
    setDraft(fillRequest.text);
    setIgnored([]);
    setOverride(undefined);
    setPanelOpen(false);
    inputRef.current?.focus?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只认 nonce，理由见上
  }, [fillNonce]);

  /**
   * 同一次渲染里的"现在"。
   *
   * 🔴 解析与 `valueLabel` 必须共用它（跨零点时同一屏上的两行不能算出不同的日期）。
   * `now` 不传时每次渲染取一次 —— 与迁移前 `previewNow = Date.now()` 同一行为。
   */
  const renderNow = now ?? Date.now();
  const parsed = useMemo(() => parseCaptureDraft(draft, ignored, now), [draft, ignored, now]);
  const chips = useMemo(() => toCaptureChips(parsed), [parsed]);
  /** 框下方那一行：胶囊已经说出来的那条不在这里说第二遍。 */
  const rowChips = useMemo(() => captureRowChips(parsed), [parsed]);
  /** 面板里逐条可撤的那些：截止类目**全部**进这里（生效中的也要能单独取消）。 */
  const dueChips = useMemo(
    () => chips.filter((chip) => chip.field === 'dueDate' || chip.field === 'dueTime'),
    [chips],
  );
  const signature = useMemo(() => captureFragmentSignature(parsed), [parsed]);
  const due = useMemo(() => captureDue(parsed, override, anchorDate), [parsed, override, anchorDate]);
  const capsuleKind = captureCapsuleKind(due);
  const capsuleText = labels.capsule(due, capsuleKind, renderNow);
  const canSubmit = captureCanSubmit(parsed);

  function submit(): void {
    const plan = toCaptureSubmitPlan(parsed, anchorDate, override);
    if (plan === undefined) return;
    /*
     * 🔴 描述是**独立的一行**，不参与 `parseCapture` 的任何识别：
     * 标题里写「明天」会被解析成日期（那是这个组件的卖点），
     * 而描述里写「明天」只是"明天"两个字 —— 两者语义不同，
     * 所以它最后拼进 plan，不并进 `draft`。
     * 空串不写（省略与显式空在动作层同一条约定，见 `CaptureSubmitPlan.projectId`）。
     */
    const trimmedDescription = descriptionDraft.trim();
    const withDescription =
      trimmedDescription === '' ? plan : { ...plan, description: trimmedDescription };
    const range =
      rangeEnabled && rangeStart !== undefined && rangeDuration !== undefined
        ? { startDate: dueDateToEpoch(rangeStart, rangeTime), durationMinutes: rangeDuration }
        : undefined;
    void onSubmit(
      withCaptureRepeatPreset(
        withCaptureRange(withCaptureProject(withDescription, captureSelectedProject(projectPicker)?.id), range),
        repeatEnabled ? repeatPreset : undefined,
      ),
    );
    setDraft('');
    setDescriptionDraft('');
    setIgnored([]);
    setOverride(undefined);
    setRangeStart(undefined);
    setRangeTime(undefined);
    setRangeDuration(undefined);
    setRepeatPreset(undefined);
    closePanel();
  }

  /** 面板里点出一格 = 成对写一次覆盖（签名当场钉住，见 `model.ts` §二·五）。 */
  function pick(date: LocalDate, time: LocalTime | undefined): void {
    setOverride(makeCaptureOverride(date, time, signature));
  }

  /**
   * 面板里的`清除`：覆盖清空 **并且把被消费的那段字送回标题**。
   *
   * 🔴 少了后半句就是"字被吞了而界面没说"，那是 `capture.ts` 文件头第 1 条不变量。
   * 走的是既有的忽略清单，不是第二套状态。
   */
  function clearDue(): void {
    const next = clearCaptureDue(parsed, ignored);
    setOverride(next.override);
    setIgnored(next.exclusions);
  }

  /** 忽略 / 恢复一条识别。只动"忽略清单"，**绝不动输入框里的字**。 */
  function toggleIgnore(chip: CaptureChip): void {
    setIgnored((list) => toggleCaptureIgnore(list, chip));
  }

  /** 输入变了，旧的忽略清单可能已经指向不存在的文字 —— 清掉以免残留状态。 */
  function onDraftChange(value: string): void {
    setDraft(value);
    if (shouldResetCaptureIgnore(ignored)) setIgnored([]);
    // ⚠️ 这里**不**清 `override`：它绑在片段签名上，签名一 mismatch 就自己失效
    //（`captureDue` 里那一处判定）。在这里再清一次就是给同一条规则写第二个出口。
  }

  /** 面板体与出口段共用的受控状态（同一份，两边不会各切各的）。 */
  const panelState: CaptureDuePanelState = {
    view: panelView,
    manual: panelManual,
    timeDraft: panelTimeDraft,
    onViewChange: setPanelView,
    onManualChange: setPanelManual,
    onTimeDraftChange: setPanelTimeDraft,
    range: rangeEnabled
      ? {
          start: rangeStart,
          time: rangeTime,
          durationMinutes: rangeDuration,
          onStart: (start, time) => {
            setRangeStart(start);
            setRangeTime(time);
          },
          onDuration: (minutes) => {
            setRangeDuration((prev) => (prev === minutes ? undefined : minutes));
          },
          onEnter: () => {
            setPanelView('range');
          },
        }
      : undefined,
    repeat: repeatEnabled
      ? {
          value: repeatPreset,
          onSelect: (preset) => {
            setRepeatPreset(preset);
          },
        }
      : undefined,
  };

  /**
   * 关掉面板就退回日期视图。原来这一条是"面板卸载"白送的（状态住在面板里，一卸载就没了）；
   * 状态上移之后必须自己写，否则下次打开还停在时刻列表上 —— 那是把一处行为悄悄改掉。
   */
  function closePanel(): void {
    setPanelOpen(false);
    setPanelView('date');
    setPanelManual(false);
    setPanelTimeDraft('');
  }

  /*
   * 🔴 没有外壳就没有 footer 可放 ⇒ 这一档强制回 `'inline'`。
   * 让 `'footer' + 无外壳` 这种组合存在，等于允许"出口哪儿都没画"这种形状活着出去。
   */
  const effectiveOutlet: CaptureDuePanelOutletPlacement =
    renderDuePanel === undefined ? 'inline' : duePanelOutlet;

  const panelContent = (
    <CaptureDuePanel
      due={due}
      now={renderNow}
      today={today(renderNow)}
      quickPicks={quickPicks ?? []}
      dueChips={dueChips}
      labels={labels}
      onPick={pick}
      onClear={clearDue}
      onToggle={toggleIgnore}
      state={panelState}
      outlet={effectiveOutlet}
    />
  );

  /** 分置模式下的出口段；`'inline'` 时是 `undefined`，宿主那边一行都不用改。 */
  const outletContent = effectiveOutlet === 'footer' ? (
    <CaptureDuePanelOutlet
      due={due}
      today={today(renderNow)}
      labels={labels}
      state={panelState}
      onPick={pick}
    />
  ) : undefined;

  return (
    <View style={styles.wrap} testID={testID}>
      {/*
        🔴 标题行与描述行是**同一组**（都是"这条任务叫什么 / 补一句"），
        所以它们之间用 `titleGroup` 的 4dp，而不是 `wrap` 的 12dp。
        真机量过未分组时的样子：标题底 842 → 描述 878（12dp），
        描述底 1010 → 落点标签 1046（也是 12dp）—— **两个 12dp 相等**，
        于是"描述属于标题"和"描述属于落点那一段"在视觉上不可分辨。
        分组后是 4 / 12 / 4 三档，层次回来了。
      */}
      <View style={styles.titleGroup}>
      <View style={styles.compose}>
        <TextInput
          ref={inputRef}
          style={[text['row-meta'], styles.input]}
          value={draft}
          placeholder={labels.placeholder}
          placeholderTextColor={tokens['color.foreground-subtle']}
          accessibilityLabel={labels.addLabel}
          onChangeText={onDraftChange}
          onSubmitEditing={submit}
          returnKeyType="done"
          // 🔴 原生端**不**透传 `autoFocus`（那个竞态正是这么来的，见 prop 说明）；
          // web 保持原样 —— 那边没有这条原生命令，也就没有卸载/聚焦相撞。
          {...(autoFocus === undefined || managesFocusItself ? {} : { autoFocus })}
          testID="capture-input"
        />

        {/*
          工具行（2026-11-16）：日期胶囊在左、主操作在右 —— 与输入框同处**一个外框**内。
          此前这三件是并排的一行，窄屏上 placeholder 被挤断（真机「（可写「明天下」
          就是这么断的），而"输入→落点→提交"其实是**上下两层**的阅读顺序。
        */}
        <View style={styles.toolRow}>
        {/*
          🔴 日期胶囊：**这条新任务会落在哪一天几点**，由这一枚说。
          它常驻（不随聚焦长出）—— 藏起来会让"没选日期"和"选了但看不见"在截图上
          不可分辨，而这是这条线上唯一致命的错法（猜错哪一天）。
          空态只画图标，不写「未设置」（`labels.capsule` 那一格的理由）。
        */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={labels.capsuleAria(capsuleText)}
          onPress={() => {
            setPanelOpen((open) => !open);
          }}
          style={[styles.capsule, capsuleKind === 'empty' ? null : styles.capsuleOn]}
          testID="capture-due-capsule"
        >
          <HeytaIcon
            data={Calendar}
            size={tokens['icon.sm']}
            color={capsuleKind === 'empty' ? tokens['color.foreground-subtle'] : tokens['color.primary']}
          />
          {capsuleText === '' ? null : (
            <Text style={[text.caption, styles.capsuleText]} testID="capture-due-capsule-value">
              {capsuleText}
            </Text>
          )}
          <HeytaIcon
            data={ChevronDown}
            size={tokens['icon.xs']}
            color={tokens['color.foreground-subtle']}
          />
        </Pressable>
        {/* 撑开：让主操作贴右（参照图里发送键在右下角）。 */}
        <View style={styles.toolSpacer} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={labels.add}
        // 🔴 用**平铺** `aria-*`，不要用对象形态 `accessibilityState` / `accessibilityValue`：
        // RNW 0.21 会把对象形态**整个丢掉**（实测 `aria-checked` / `aria-valuenow` 都不出现），
        // 而 RN 0.71+ 两端都认平铺形态。判据见 `pnpm check:rn-aria`。
          aria-disabled={!canSubmit}
          disabled={!canSubmit}
          onPress={submit}
          style={[styles.addButton, canSubmit ? styles.addEnabled : styles.addDisabled]}
          testID="capture-submit"
        >
          <HeytaIcon data={Plus} size={tokens['icon.md']} color={tokens['color.on-primary']} />
        </Pressable>
        </View>
      </View>

      {descriptionInput ? (
        <TextInput
          style={[text['row-meta'], styles.descriptionInput]}
          value={descriptionDraft}
          placeholder={labels.descriptionPlaceholder ?? ''}
          placeholderTextColor={tokens['color.foreground-subtle']}
          accessibilityLabel={labels.descriptionPlaceholder ?? ''}
          onChangeText={setDescriptionDraft}
          returnKeyType="done"
          onSubmitEditing={submit}
          testID="capture-description"
        />
      ) : null}
      </View>

      {/*
        面板：宿主给了外壳就用外壳（web 的锚定浮层），没给就**就地展开**
        —— 那一档的真实消费者是日历里那个已经浮着的捕获层，不是"还没接"。
      */}
      {panelOpen
        ? renderDuePanel === undefined
          ? panelContent
          : renderDuePanel({
              open: true,
              content: panelContent,
              footerContent: outletContent,
              subject: draft,
              onClose: closePanel,
            })
        : null}

      {projectPicker === undefined ? null : (
        <CaptureProjectPickerRow picker={projectPicker} />
      )}

      {rowChips.length > 0 ? (
        <View
          style={styles.chips}
          accessibilityLabel={labels.matchesAria}
          testID="capture-matches"
        >
          {rowChips.map((chip, index) => {
            const off = chip.action !== 'ignore';
            return (
              <View
                key={chip.key}
                style={[styles.chip, off ? styles.chipOff : null]}
                testID={`capture-chip-${String(index)}`}
              >
                <Text style={[text.caption, styles.chipRaw, off ? styles.chipRawOff : null]}>
                  {chip.raw}
                </Text>
                <Text
                  style={[text.caption, styles.chipArrow]}
                  aria-hidden
                >
                  →
                </Text>
                <Text
                  style={[text.caption, styles.numeric, chip.action === 'ignore' ? styles.chipValue : styles.chipValueOff]}
                  testID="capture-chip-value"
                >
                  {chip.action === 'restore' ? labels.rejected : labels.valueLabel(chip, renderNow)}
                </Text>
                {chip.action === 'restore' ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={labels.restoreAria(chip.raw)}
                    onPress={() => {
                      toggleIgnore(chip);
                    }}
                    style={styles.chipToggle}
                    testID="capture-chip-toggle"
                  >
                    <HeytaIcon
                      data={RotateCcw}
                      size={tokens['icon.xs']}
                      color={tokens['color.foreground-subtle']}
                    />
                  </Pressable>
                ) : chip.action === 'ignore' ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={labels.ignoreAria(chip.raw)}
                    onPress={() => {
                      toggleIgnore(chip);
                    }}
                    style={styles.chipToggle}
                    testID="capture-chip-toggle"
                  >
                    <HeytaIcon
                      data={X}
                      size={tokens['icon.xs']}
                      color={tokens['color.foreground-subtle']}
                    />
                  </Pressable>
                ) : (
                  <Text
                    style={[text.caption, styles.chipHint]}
                    testID="capture-chip-hint"
                  >
                    {labels.unused}
                  </Text>
                )}
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

/**
 * 「落进哪一份清单」那一行，单独导出：任务面板的捕获器与便签板共用同一份形状。
 *
 * 🔴 选中态**不许只靠颜色**说话：这一行的标题念的是此刻真正的落点
 * （「新建落进收集箱」/「新建落进「X」」），芯片的底色只是冗余的一层。
 *
 * 🔴 它是**受控**的：状态住在宿主，本组件只回传 `onSelect`。
 */
export function CaptureProjectPickerRow({
  picker,
}: {
  readonly picker: CaptureProjectPicker;
}): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  const selected = captureSelectedProject(picker);
  const chip = (id: string | null, name: string, aria: string, testId: string): React.JSX.Element => {
    const on = picker.destinationId === id;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={aria}
        aria-selected={on}
        onPress={() => {
          picker.onSelect(id);
        }}
        style={[styles.projectChip, on ? styles.projectChipOn : null]}
        testID={testId}
      >
        <Text style={[text.caption, styles.projectChipText, on ? styles.projectChipTextOn : null]}>
          {name}
        </Text>
      </Pressable>
    );
  };
  return (
    <View style={styles.projectWrap} accessibilityLabel={picker.labels.title} testID="capture-project-picker">
      <Text style={[text.caption, styles.projectTitle]}>
        {selected === undefined ? picker.labels.currentInbox : picker.labels.current(selected.name)}
      </Text>
      <View style={styles.projectRow}>
        {chip(null, picker.labels.inbox, picker.labels.inboxAria, 'capture-project-inbox')}
        {picker.options.map((option) =>
          chip(option.id, option.name, picker.labels.optionAria(option.name), `capture-project-${option.id}`),
        )}
      </View>
    </View>
  );
}
