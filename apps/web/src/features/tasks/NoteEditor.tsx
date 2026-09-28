/**
 * 任务行上的「备注」编辑
 * ========================
 *
 * 🔴 **这个文件补的是 Web 端的一个真实空洞**（与 `TaskOrganizer.tsx` 同一形状）。
 *
 * `Task.note` 一直存在、`TaskStore.setNote` 一直存在、`app-host` 的
 * `TaskActions.setNote` 一直存在 —— 但 Web 上**没有任何用户输入框**：
 * `setNote` 的唯一调用点是 AI 拆解（写 checklist）与 AI 估时（写时长）。
 * 于是"我能不能在任务上写点东西"这件事，答案是**不能**。
 *
 * 数据层是通的（备注会被导出、会同步），缺的只是最后一米 —— 这正是
 * `docs/research/dida365-feature-benchmark.md` §3 记的那类失效形状。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 四个刻意的决定
 *
 * 1. **有备注时常驻一个 chip，编辑控件收进 `<details>`。**
 *    理由与 `TaskOrganizer` 完全一样：扫一眼列表要能看出**哪些任务写了东西**，
 *    而把 `<textarea>` 直接铺在每一行上，列表就没法看了。
 *
 * 2. **失焦时提交，不是每次按键。**
 *    `AGENTS.md` §3.4 是"一个用户意图 = 一个 op"。打一行字是**一个**意图；
 *    按每个字符写一条 op 会让 op-log 迅速膨胀，而且每一条都要同步给所有设备。
 *    这也是这里用**非受控**输入框的原因之一：受控输入每敲一下都触发重渲染，
 *    而重渲染与"什么时候该写 op"本来就不该绑在一起。
 *
 * 3. **清空 = 传 `undefined`，不是空字符串。**
 *    `setNote(id, undefined)` 会写成 `null`（见 `TaskActions.setNote` 的契约：
 *    `[]` / `''` / "没有这个字段"只留一种表示）。传空串会留下一个
 *    "字段存在但是空的"状态，而那个状态在另一台设备上读起来与"没写过"不同。
 *
 * 4. **用非受控输入框 + `key`。**
 *    `key={task.note ?? ''}` 让**外部**改动（AI 写入、同步回来）能刷新到输入框，
 *    而用户自己打字时 `task.note` 没变、key 稳定、不会被重置。
 *    受控写法要做同样的事得再加一个 effect 去比对，那是第二份状态。
 *
 * 🔴 本文件里**没有一行业务逻辑**：空备注怎么表示、写哪些字段、要不要拦悬空 id，
 * 全部由 `@heyta/app-host` 决定。这里只做两件事：把用户打的字读出来，交给 store。
 */

import { cssVar } from '@heyta/design-system';
import { useI18n } from '@heyta/i18n';
import type { Task } from '@heyta/domain';
import { NotebookPen } from 'lucide-react';

/** chip 里预览的字数上限。够看出"写的是什么"，又不至于把行撑开。 */
const PREVIEW_CHARS = 24;

/**
 * 备注的**第一行**，超长截断。
 *
 * 取第一行而不是整段：备注里最常见的内容是 AI 拆出的 `- [ ]` 清单，
 * 整段塞进 chip 会把任务行挤爆。
 */
function preview(note: string): string {
  const firstLine = note.split('\n')[0]?.trim() ?? '';
  const body = firstLine === '' ? note.trim() : firstLine;
  return body.length > PREVIEW_CHARS ? `${body.slice(0, PREVIEW_CHARS)}…` : body;
}

export function NoteEditor({
  task,
  onSetNote,
}: {
  task: Task;
  /** 传 `undefined` 表示清除备注（`app-host` 会写成 `null`）。 */
  onSetNote: (note: string | undefined) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const hasNote = task.note !== undefined && task.note.trim() !== '';

  return (
    <details className="ht-note">
      <summary
        // 有备注时 chip 是实心的：它承担"这一行写过东西"的提示职责，
        // 没有备注时只是一个低调的入口。
        //
        // 🔴 用既有的 `.ht-chip` / `.ht-chip--on`（与设置页的能力开关同一个 chip 族），
        // 而不是在这里现写一套：chip 的边距、圆角、字号、光标都已在 app.css 里。
        // 只留 `listStyle: 'none'` —— `.ht-chip` 不负责隐藏 `<summary>` 的展开三角。
        className={hasNote ? 'ht-chip ht-chip--on' : 'ht-chip'}
        style={{ listStyle: 'none' }}
      >
        <NotebookPen size={12} aria-hidden="true" />
        {/*
          chip 上显示的是**用户自己的字**（备注预览），原样呈现、不翻译。
          没有备注时才用词条表里那句「备注」。
          `preview()` 已把长度截到 24 字，所以这里不再需要 ellipsis 约束。
        */}
        <span>{hasNote ? preview(task.note!) : t('web.note.toggle')}</span>
      </summary>

      {/* `.ht-compose` 是「输入行」：它给这个只有一行控件的容器 flex + 间距。 */}
      <div className="ht-compose">
        <textarea
          // 🔴 非受控 + key：外部改动能刷进来，用户打字时不会被重置（见文件头第 4 条）。
          key={task.note ?? ''}
          defaultValue={task.note ?? ''}
          rows={3}
          placeholder={t('web.note.placeholder')}
          aria-label={t('web.note.a11y.edit', { title: task.title })}
          onBlur={(e) => {
            const next = e.target.value;
            const trimmed = next.trim() === '' ? undefined : next;
            // 没变就不写 —— 否则"点开又点走"会给每个任务白写一条 op。
            if (trimmed === (task.note === undefined || task.note === '' ? undefined : task.note)) {
              return;
            }
            onSetNote(trimmed);
          }}
          // 🔴 复用 `.ht-input`（输入框）的背景 / 边框 / 圆角 / 字号，只覆盖
          // textarea 特有的两处：竖向内边距（单行框是 `padding: 0`，多行会顶格）
          // 与只允许竖向拖拽。字体与文字颜色不用管 —— `reset.css` 已给
          // `input, textarea { font: inherit; color: inherit }`。
          className="ht-input"
          style={{
            padding: cssVar('space.2'),
            resize: 'vertical',
          }}
        />
      </div>
      <p className="ht-settings__hint">{t('web.note.hint')}</p>
    </details>
  );
}
