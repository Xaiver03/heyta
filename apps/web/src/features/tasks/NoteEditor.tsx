import { ICON_SIZE } from '@heyta/design-system';
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

/**
 * 备注的**正文输入框**（不含展开机关）。
 *
 * 🔴 为什么把它单独导出来：备注这一栏有两个落点（工单 §8.138 拍完"行内展开 vs 栏里编辑"
 * 那道二选一之后才有的形状）—— 详情列放得下时它住在栏里（`TaskDetailCard`），
 * 放不下时退回行尾那颗 chip 的 `<details>` 里。两处要的是**同一份写入语义**
 * （失焦才提交、空串写 `undefined`、没变不发 op、非受控 + `key`），
 * 抄两遍就是 AGENTS §3.5 那两条"抽出实现却没删旧的"事故形状。
 * 这里只管正文与提交；`<details>` 那一层留在 `NoteEditor` 里。
 */
export function NoteField({
  task,
  onSetNote,
}: {
  task: Task;
  /** 传 `undefined` 表示清除备注（`app-host` 会写成 `null`）。 */
  onSetNote: (note: string | undefined) => void;
}): React.JSX.Element {
  const { t } = useI18n();

  return (
    <>
      <div className="ht-compose">
        <textarea
          // `data-testid` 是键盘光标那一族的落点锚（工单 W1b 第 3 条腿：在选中那一行上按
          // Enter，焦点进这只正文框，见 `lib/keyboard-cursor.ts` 的 `enterTarget`）。
          data-testid="task-note-input"
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
    </>
  );
}

/**
 * 行尾那枚**只读徽标** —— 备注的编辑器搬进栏里之后，列表还要能看出"这一行写过东西"。
 *
 * 🔴 它刻意不是第二份编辑器：没有 `<details>`、没有输入框、没有 `onPress`。
 * 一次点击 = 选中那一行（行的那颗按钮接这一下），而正文只在栏里改 ——
 * 这是 §8.138 那条不变量（每个字段只有一个编辑器所有者）的另一半。
 * 第一趟看图就是照出"少了它"：那一行明明写着两段备注，列表里却一点痕迹都没有
 * （`NoteEditor.tsx` 文件头第 1 条那个"扫一眼要能看出哪些任务写了东西"的职责被削掉了）。
 *
 * ⚠️ 没备注时它**不占位**：这是拍板 #8 三态契约里的 `record` 那一档
 * （有记录才出现），与栏里那个常驻的区块头（`affordance`）不冲突。
 */
export function NoteBadge({ task }: { task: Task }): React.JSX.Element | null {
  const hasNote = task.note !== undefined && task.note.trim() !== '';
  if (!hasNote) return null;
  return (
    <span className="ht-chip ht-chip--on" data-testid={`task-note-badge-${task.id}`}>
      <NotebookPen size={ICON_SIZE.xs} aria-hidden="true" />
      <span>{preview(task.note!)}</span>
    </span>
  );
}

/**
 * 行尾那一颗**备注 chip**：详情列没在画的时候，正文输入框就住在这它的 `<details>` 里。
 *
 * ⚠️ 它现在是被**条件挂载**的（`App.tsx` 的 `noteInColumn` 反向）：栏里画着的时候这里
 * 整个不渲染，于是同一时刻 DOM 里只有一只备注输入框。两个落点各拿一个必填布尔决定，
 * 刻意的不是"默认值等于原行为"（§8.130 那条理由：那种写法会把"宿主没接"伪装成"做完了"）。
 */
export function NoteEditor({
  task,
  onSetNote,
}: {
  task: Task;
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
        <NotebookPen size={ICON_SIZE.xs} aria-hidden="true" />
        {/*
          chip 上显示的是**用户自己的字**（备注预览），原样呈现、不翻译。
          没有备注时才用词条表里那句「备注」。
          `preview()` 已把长度截到 24 字，所以这里不再需要 ellipsis 约束。
        */}
        <span>{hasNote ? preview(task.note!) : t('web.note.toggle')}</span>
      </summary>

      {/* 正文与提示那一行原样搬进 `NoteField`：展开后的 DOM 与搬之前逐字节相同。 */}
      <NoteField task={task} onSetNote={onSetNote} />
    </details>
  );
}
