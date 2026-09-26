/**
 * 快速捕获输入框（含解析预览）
 * ==============================
 *
 * 这是 AI-1（捕获）的**确定性版本**。UI 层在这里只做三件事：
 * 收集输入、展示解析结果、调用写入动作。
 * **解析逻辑一行都不在这里** —— 它在 `@heyta/domain` 的 `capture.ts`。
 * 判据还是 AGENTS.md §3.5 那句：这里有没有任何一行在决定"业务上该怎么做"？
 * 没有。所以它留在 `apps/` 是合规的。
 *
 * 🔴 **为什么必须有预览，不能"直接落库"**
 *
 * 中文没有词边界，规则解析的误报是**结构性**的："明天启程"里的"明天"
 * 会被认成日期。如果输入框直接落 op，用户写的字就被悄悄删改，而且
 * **没有任何地方能告诉他发生了什么**。
 *
 * 所以本组件的契约是：
 *   1. **识别结果一律先显示。** 用户看得见"我读懂了什么"。
 *   2. **每一条都能单独取消**（点 ×），取消 = 把那几个字放回输入。
 *   3. **没被采纳的匹配会显式标成"未采用"** —— 否则用户会误以为它生效了。
 *
 * 这套"建议 → 用户确认 → 才落 op"的形状是**刻意先建出来的**：
 * 等 AI-1 真正接入模型时，要换的只是"谁来产生候选"，
 * 而不是重新设计一遍交互。ADR-0005 §3.1 的"A 建议、人确认"就是这个形状。
 */

import { useMemo, useState } from 'react';
import { Plus, RotateCcw, X } from 'lucide-react';

import {
  Priority,
  dueDateToEpoch,
  formatRemainingUntil,
  parseCapture,
  type CaptureExclusion,
} from '@heyta/domain';

import { useTaskStore } from '../tasks/store.js';

/** 优先级 → 可读文案。与 `capture.ts` 的 display 保持一致口径。 */
const PRIORITY_LABEL: Record<number, string> = {
  [Priority.High]: '高优先级',
  [Priority.Medium]: '中优先级',
  [Priority.Low]: '低优先级',
  [Priority.None]: '无优先级',
};

export function CaptureComposer(): React.JSX.Element {
  const addTask = useTaskStore((s) => s.addTask);
  const [draft, setDraft] = useState('');
  /**
   * 用户显式忽略的识别。
   *
   * ⚠️ 它在语义上是"**这段文字是标题的一部分**"，不是"删掉这几个字"。
   * 所以这里存的是"忽略清单"，而**不是**去改 `draft` ——
   * 改 `draft` 会把用户写的字真的删掉，那正是本组件最不能犯的错。
   */
  const [ignored, setIgnored] = useState<CaptureExclusion[]>([]);

  // 解析是纯函数且很便宜（十来条正则），但输入框每次按键都重算仍然浪费。
  // 依赖只有 draft + ignored —— 时间源用默认的 Date.now()，不放进依赖数组，
  // 因为"跨过午夜后预览里的'今天'会过期"的代价只是刷新一次输入。
  const parsed = useMemo(() => parseCapture(draft, { exclude: ignored }), [draft, ignored]);

  const canSubmit = parsed.title.trim() !== '';

  function submit(): void {
    if (!canSubmit) return;
    void addTask(parsed.title, {
      ...(parsed.dueDate !== undefined ? { dueDate: dueDateToEpoch(parsed.dueDate) } : {}),
      ...(parsed.priority !== undefined ? { priority: parsed.priority } : {}),
    });
    setDraft('');
    setIgnored([]);
  }

  /** 忽略 / 恢复一条识别。只动"忽略清单"，**绝不动输入框里的字**。 */
  function toggleIgnore(m: CaptureExclusion & { rejected: boolean }): void {
    setIgnored((list) =>
      m.rejected
        ? list.filter((e) => !(e.field === m.field && e.raw === m.raw))
        : [...list, { field: m.field, raw: m.raw }],
    );
  }

  /** 输入变了，旧的忽略清单可能已经指向不存在的文字 —— 清掉以免残留状态。 */
  function onDraftChange(value: string): void {
    setDraft(value);
    if (ignored.length > 0) setIgnored([]);
  }

  return (
    <div className="ht-compose-wrap">
      <div className="ht-compose">
        <input
          className="ht-input"
          value={draft}
          placeholder="添加任务，回车确认（可写「明天」「下周三」「!1」）"
          aria-label="新任务标题"
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        <button
          type="button"
          className="ht-btn ht-btn--primary"
          onClick={submit}
          disabled={!canSubmit}
        >
          <Plus size={18} aria-hidden="true" />
          添加
        </button>
      </div>

      {parsed.matches.length > 0 && (
        <ul className="ht-capture" aria-label="识别出的字段">
          {parsed.matches.map((m) => {
            // dueDate 的 display 是 YYYY-MM-DD。同时给出人话剩余时间，
            // 因为"2026-09-26"不直观而"明天"直观 —— 用户要确认的是后者。
            const valueLabel =
              m.field === 'dueDate' && m.dueDate !== undefined
                ? `${m.dueDate}（${formatRemainingUntil(m.dueDate)}）`
                : (PRIORITY_LABEL[m.priority ?? Priority.None] ?? m.display);

            return (
              <li
                key={`${m.field}-${String(m.start)}-${m.raw}`}
                className={`ht-capture__chip${m.applied ? '' : ' ht-capture__chip--off'}`}
              >
                <span className="ht-capture__raw">{m.raw}</span>
                <span className="ht-capture__arrow" aria-hidden="true">
                  →
                </span>
                <span className="ht-capture__value">
                  {m.rejected ? '已忽略（当作标题文字）' : valueLabel}
                </span>
                {m.rejected ? (
                  // 恢复：把它重新纳入解析
                  <button
                    type="button"
                    className="ht-capture__x"
                    aria-label={`恢复识别：${m.raw}`}
                    onClick={() => toggleIgnore(m)}
                  >
                    <RotateCcw size={12} aria-hidden="true" />
                  </button>
                ) : m.applied ? (
                  <button
                    type="button"
                    className="ht-capture__x"
                    aria-label={`忽略识别：${m.raw}`}
                    onClick={() => toggleIgnore(m)}
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                ) : (
                  // 未被采纳（同字段已有更早的匹配）= 它**还在标题里**。
                  // 必须说出来，否则用户会以为识别失败了，
                  // 而不知道那段字其实原样保留着。
                  <span className="ht-capture__hint">未采用，仍在标题中</span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {parsed.matches.length > 0 && (
        <p className="ht-capture__preview">
          实际标题：<strong>{parsed.title === '' ? '（空）' : parsed.title}</strong>
        </p>
      )}
    </div>
  );
}