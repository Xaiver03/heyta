/**
 * 快速捕获输入框（Web 壳）
 * ==========================
 *
 * 🔴 M3 第八刀之后，这个文件**只剩接线**。
 *
 * 输入行、识别芯片（原文 → 解析结果 → 取消/恢复/「未采用」）、实际标题预览，
 * 全部由 `@heyta/ui` 的 `CaptureComposer` 渲染 —— 与移动端将是**同一份实现**。
 * 这里只回答 web 自己的三个问题：
 *
 *   1. **文案**从哪来 → `@heyta/i18n` 的 `web.capture.*`；
 *      芯片的剩余天数由共享层算，措辞在这里说成当前语言；
 *   2. **提交**到哪去 → `useTaskStore#addTask`（op-log 的唯一写入口，AGENTS.md §3.4），
 *      落点由 `destination` 决定 —— **当下面板停在哪个清单，新任务就留在哪个清单**；
 *   3. **AI 一句话捕获面板** → `renderAssistant` 插槽（见下）。
 *
 * 解析一行都不在这里：它仍然是 `@heyta/domain#parseCapture`。判据还是
 * AGENTS.md §3.5 那句：这里有没有任何一行在决定"业务上该怎么做"？
 * 没有 —— 判断（芯片三态 / 忽略清单 / 提交换算）在
 * `packages/ui/src/capture/model.ts`，写库在 app-host 的 action 层。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 `HeytaUiProvider` 必须包在**这一处**
 *
 * 共享 `CaptureComposer` 透过 `useHeytaTokens` / `useHeytaText` 取 token，
 * 而 `App.tsx` 里 `CaptureComposer` 挂在内容区，**不在** `tasks` 那棵树内
 * （那个 Provider 只包了一棵子树）。所以这里自己内联挂一层 ——
 * 这正是 M3 第二刀（focus）在运行时抛
 * 「useHeytaUiTheme 必须在 <HeytaUiProvider> 内使用」的形状。
 *
 * ✅ 本轮**同时**把 `CaptureComposer` 登记进了 `scripts/check-ui-provider.mjs`
 * 的 `PROVIDER_DEPENDENT`（那个缺口此前连续出现过五次，见
 * `apps/web/src/features/settings/HelpPanel.tsx` 文件头）。别把下面这层删掉：
 * 删了门禁会红。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 AI 面板留在 web（经 `renderAssistant` 插槽），不进共享层
 *
 * `AiCapture` 约 380 行，是 DOM + `@heyta/ai` 的实现；而 `apps/mobile` 里
 * AI 是 **0 行**（P8 的移动端阻塞在宿主 SecretStore，不在 UI 层）。
 * 强行共享等于让 iOS 去解析 DOM。最小一步：M3 `ai` 的"流程型面板族"
 * 落地后接进这个插槽（披露块已经有共享 `AiDisclosure`）。
 *
 * ⚠️ 插槽的渲染条件（"空输入框上不出现 AI 按钮"）留在这里，因为
 * "什么算空"与"点下去会不会必然失败"是 AI 交互的产品决策。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 本刀真实丢掉的东西（登记，不是修复）
 *
 * 1. **`.ht-input` 的悬停态**：迁移前输入框走 `styles/app.css` 的 `.ht-input`
 *    （`:hover` / `:focus-visible` 换边框色），共享层是 RN `TextInput`，
 *    RN 没有 hover。**桌面鼠标用户在这一处少了一个反馈** —— 这不是实现细节。
 *    最小一步：共享层加 `onFocus`/`onBlur` 状态 + 边框色，需要产品先定焦点环。
 * 2. ✅ **`.ht-compose-wrap` / `.ht-capture*` 是死规则**（`grep` 实测 TSX 里
 *    0 处引用）。⚠️ `.ht-compose` **不是**死的 —— `features/tasks/NoteEditor.tsx`
 *    还在用它当"输入行"容器（实测）。
 *    **已在 2026-09-28 由父 agent 删除**（`app.css` 不在本刀白名单）：
 *    顶层 `ht-*` 选择器 205 → 190（删 15 条：`.ht-compose-wrap` 2 + `.ht-capture*` 13），
 *    `.ht-compose` 已保留；`HT_FAMILY_BASELINE` **29 → 28**（P1 棘轮）。
 *    ⚠️ 删除前特意核过"我扫到的那处引用是不是真代码" —— 结果是**本文件自己这段注释**。
 *    **在这个仓库里，`grep` 的命中必须先区分"代码"与"描述代码的文字"。**
 */

import { useCallback, useMemo } from 'react';

import { useI18n } from '@heyta/i18n';

import type { AiFeedbackOutcome, LocalDate, PreferenceSet } from '@heyta/domain';
import type {
  AiHealthSnapshot,
  AiRoutingConfig,
  EgressConsent,
  HealthMap,
  SecretStore,
} from '@heyta/ai';

import {
  CaptureComposer as SharedCaptureComposer,
  HeytaUiProvider,
  captureChipRemainingDays,
  captureChipTimeLabel,
  capturePriorityLabelKey,
  type CaptureAssistantContext,
  type CaptureComposerLabels,
  type CaptureSubmitPlan,
} from '@heyta/ui';

import { formatDayTitleText } from '@heyta/ui';

import { dateWithRemaining } from '../ai/locale-punctuation.js';
import { AiCapture } from '../ai/AiCapture.js';
import { WEB_EMPTY_SECRET_STORE } from '../settings/aiStore.js';
import { useTaskStore } from '../tasks/store.js';
import { remainingText } from '../../lib/due-display.js';

/**
 * 接线所需的 AI 配置 —— 全部由 `App.tsx` 透传，本组件**不做任何判断**。
 *
 * 它们是可选的：不传就退化成纯确定性捕获（本组件的单测就是这么用的）。
 * 这样"AI 没配置"和"AI 关了"走的都是同一条路，不需要两套渲染。
 */
export interface CaptureComposerProps {
  routing?: AiRoutingConfig | undefined;
  consents?: readonly EgressConsent[] | undefined;
  secrets?: SecretStore | undefined;
  healthSnapshot?: AiHealthSnapshot | undefined;
  preferenceSet?: PreferenceSet | undefined;
  onHealth?: ((health: HealthMap) => void) | undefined;
  onFeedback?: ((feedback: {
    outcome: AiFeedbackOutcome;
    proposedCount: number;
    appliedCount: number;
  }) => void) | undefined;
  /**
   * 这一条新任务要落进哪个**清单**。没有就是收集箱（`addTask` 不带 `projectId`）。
   *
   * 🔴 它是**一个对象而不是两个可选字段**，因为这两件事必须同时成立或同时不成立：
   * 拆成 `projectId` + `projectName` 之后，调用方可以只传一半，于是
   * 「写进了清单、占位符却说不写」—— 界面说谎，而且没有任何类型会拦。
   */
  destination?: CaptureDestination | undefined;
  /**
   * **锚点日**（R11 批五）。给了它，输入里没写日期的任务就落在这一天；
   * 输入里写了「明天」仍然以输入为准（优先级在共享层 `toCaptureSubmitPlan`）。
   *
   * 🔴 传了这个就必须让 placeholder **说出落点** —— 本文件下面那条分支
   *   就是在做这件事，别把它改成通用 placeholder。
   */
  anchorDate?: LocalDate | undefined;
}

/** 落点：清单 id + 它在界面上的名字（用户自己的字，不翻译）。 */
export interface CaptureDestination {
  readonly projectId: string;
  readonly name: string;
}

export function CaptureComposer(props: CaptureComposerProps): React.JSX.Element {
  const addTask = useTaskStore((s) => s.addTask);
  const { t, locale } = useI18n();
  const destination = props.destination;
  const anchorDate = props.anchorDate;

  /**
   * 文案全部由宿主注入（共享层不 import `@heyta/i18n`）。
   *
   * `valueLabel` 里**天数是共享层算的**（`captureChipRemainingDays` ←
   * `@heyta/domain#diffDays` + `today`），这里只负责说成当前语言 ——
   * 迁移前这一步在 web 组件里，那就是"同一个日期在两端可以差一天"的种子。
   */
  const labels = useMemo<CaptureComposerLabels>(
    () => ({
      placeholder:
        anchorDate === undefined
          ? destination === undefined
            ? t('web.capture.placeholder')
            : t('web.capture.placeholderTo', { list: destination.name })
          // 锚点那一档必须**自己说一句**，不能复用清单那句：
          // "添加到 10月8日"与"添加到「工作」"是两件不同的事，
          // 合成一句就会有一边说不清。
          : t('web.capture.placeholderToDay', { day: formatDayTitleText(anchorDate, t) }),
      addLabel: t('web.capture.addLabel'),
      add: t('web.capture.add'),
      matchesAria: t('web.capture.matches.aria'),
      rejected: t('web.capture.rejected'),
      unused: t('web.capture.unused'),
      previewLead: t('web.capture.previewLead'),
      previewEmpty: t('web.capture.previewEmpty'),
      restoreAria: (raw) => t('web.capture.restoreAria', { raw }),
      ignoreAria: (raw) => t('web.capture.ignoreAria', { raw }),
      valueLabel: (chip, now) => {
        // 🔴 时刻芯片先走共享层那句（否则它会掉进下面的优先级兜底、念成「不设置」）。
        const timeLabel = captureChipTimeLabel(chip);
        if (timeLabel !== undefined) return timeLabel;
        const days = captureChipRemainingDays(chip, now);
        if (chip.dueDate !== undefined && days !== undefined) {
          return dateWithRemaining(chip.dueDate, remainingText(days, t), locale);
        }
        return t(capturePriorityLabelKey(chip.priority));
      },
    }),
    [t, locale, destination, props.anchorDate],
  );

  /**
   * 提交。`plan.dueDate` 已经是 epoch ms（共享层换算完），这里只把它交给
   * op-log 的唯一写入口 —— **不再做第二次时区换算**。
   *
   * 🔴 `projectId` 也在这里交：**打开某个清单时新建的任务必须留在清单里**。
   * 不传的话它会落进收集箱，从这条刚显示过的列表里消失，
   * 而界面从头到尾没说过"这条不会出现在这里"。
   */
  const onSubmit = useCallback(
    (plan: CaptureSubmitPlan) =>
      addTask(plan.title, {
        ...(plan.dueDate !== undefined ? { dueDate: plan.dueDate } : {}),
        ...(plan.priority !== undefined ? { priority: plan.priority } : {}),
        ...(destination !== undefined ? { projectId: destination.projectId } : {}),
      }),
    [addTask, destination],
  );

  const {
    routing,
    consents,
    secrets,
    healthSnapshot,
    preferenceSet,
    onFeedback,
    onHealth,
  } = props;

  const renderAssistant = useCallback(
    (ctx: CaptureAssistantContext) => {
      // ⚠️ 只在**有内容**时出现：空输入框上挂一个"AI 解析"按钮，
      //    点下去必然失败，那是在制造一次注定报错的交互。
      //    没配置 AI 时也照样出现 —— "找不到入口"和"入口说为什么不可用"
      //    是两件事（`AiCapture` 自己会说该去开什么）。
      if (routing === undefined || ctx.draft.trim() === '') return null;
      return (
        <AiCapture
          text={ctx.draft}
          routing={routing}
          consents={consents ?? []}
          secrets={secrets ?? WEB_EMPTY_SECRET_STORE}
          healthSnapshot={healthSnapshot}
          preferenceSet={preferenceSet}
          onApply={ctx.apply}
          {...(onFeedback !== undefined ? { onFeedback } : {})}
          {...(onHealth !== undefined ? { onHealth } : {})}
        />
      );
    },
    [routing, consents, secrets, healthSnapshot, preferenceSet, onFeedback, onHealth],
  );

  return (
    <HeytaUiProvider>
      <SharedCaptureComposer
        labels={labels}
        onSubmit={onSubmit}
        anchorDate={anchorDate}
        renderAssistant={renderAssistant}
      />
    </HeytaUiProvider>
  );
}
