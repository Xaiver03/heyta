/**
 * `@` 候选列表与"已引用"芯片条
 * ==============================
 *
 * 只做两件**纯展示**的事，键盘与状态全在调用方（`AssistantPanel`）：
 * 它同时管着"按 Enter 是发送还是选中候选"，把键盘拆到两个组件里必然分叉。
 *
 * ## 🔴 芯片不是富文本节点
 *
 * 输入框始终是一个 `textarea`，文本是唯一事实源；芯片是**它的投影**。
 * 这条选择的代价在 `@heyta/domain` 的 `mentions.ts` 文件头写了（持久化 / 粘贴 /
 * 跨端）；这里只重复一句结论：**把芯片做成不可分割的 DOM 节点**会同时打碎这三件事。
 */

import type { MentionTaskCandidate, MentionSegment } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';

export interface MentionPickerProps {
  readonly candidates: readonly MentionTaskCandidate[];
  /** 当前高亮项（调用方持有，键盘上下键改它）。 */
  readonly activeIndex: number;
  readonly onPick: (candidate: MentionTaskCandidate) => void;
  /** 鼠标悬停也同步高亮 —— 否则键盘与鼠标会指向两个不同的项。 */
  readonly onHover: (index: number) => void;
}

/** 候选列表。空时**不渲染**：一个空的浮动面板挡住输入框，比不弹更难用。 */
export function MentionPicker({
  candidates,
  activeIndex,
  onPick,
  onHover,
}: MentionPickerProps): React.JSX.Element | null {
  const { t } = useI18n();
  if (candidates.length === 0) return null;

  return (
    <ul
      className="ht-ai__mention-list"
      role="listbox"
      aria-label={t('web.ai.mention.aria')}
      data-testid="ai-mention-list"
    >
      {candidates.map((candidate, index) => (
        <li
          key={candidate.taskId}
          role="option"
          aria-selected={index === activeIndex}
          data-testid={`ai-mention-option-${String(index)}`}
          className="ht-ai__mention-option"
          // ⚠️ 用 onMouseDown 而不是 onClick：textarea 的 blur 会先于 click 发生，
          // 焦点一走候选就没了，click 永远收不到。
          onMouseDown={(event) => {
            event.preventDefault();
            onPick(candidate);
          }}
          onMouseEnter={() => onHover(index)}
        >
          <span className="ht-ai__mention-title">{candidate.title}</span>
          {candidate.suffix !== undefined && (
            <span className="ht-ai__mention-suffix">{candidate.suffix}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * 已引用任务的芯片条。
 *
 * 🔴 **对不上的 @ 也要显示**（画成普通文字 + 虚线），因为它仍是用户写的一句话：
 * 悄悄不渲染等于替他删字。这条与 `resolveMentions` 的 `unresolved` 是同一条纪律。
 */
export function MentionChips({
  segments,
  resolve,
}: {
  readonly segments: readonly MentionSegment[];
  readonly resolve: (label: string) => string | undefined;
}): React.JSX.Element | null {
  const chips = segments.filter((segment) => segment.kind === 'mention');
  if (chips.length === 0) return null;

  return (
    <ul className="ht-ai__mention-chips" data-testid="ai-mention-chips">
      {chips.map((segment) => {
        if (segment.kind !== 'mention') return null;
        const title = resolve(segment.span.label);
        return (
          <li
            key={`${String(segment.span.start)}-${segment.span.label}`}
            className="ht-chip ht-ai__mention-chip"
            data-resolved={title === undefined ? 'false' : 'true'}
            data-testid="ai-mention-chip"
            title={title === undefined ? segment.span.label : title}
          >
            @{title ?? segment.span.label}
          </li>
        );
      })}
    </ul>
  );
}
