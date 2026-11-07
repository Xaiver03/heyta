/**
 * 任务面单 —— 选中某条任务时，那一格里画的东西（工单 §8.138）
 * ==========================================================
 *
 * 这一格是"详情面本体"那一单（§8.125 第 3 节 DoD）的**任务那一格**，
 * 也是 §8.130 记下的那道二选一（"行内展开编辑 vs 栏里编辑"）落地的一半。
 *
 * 🔴 裁决是**栏里编辑**。三条理由，按承重排：
 *   ① 拍板 #1 已经说过"选中某条 = 同一格换成该实体面单"，而任务是本应用的**主对象** ——
 *      那一格对别的实体都换了、只对任务空着，等于这条裁决在它最该成立的地方不成立。
 *   ② 滴答的取证（调研 A3 状态二）：选中一条 ⇒ 第四栏换成详情面，里面是
 *      **大号标题 + 备注全文 + 子任务/提醒/标签区块 + 所属清单**；Todoist 的一手句子是
 *      "click a task to open the task view"。行内展开是**没有目的地**那一档的做法。
 *   ③ 行尾那一坨常驻控件实测要 **517px**（1440 视口下整行的 48%，见 `App.tsx`
 *      `renderTaskTrailing` 那段注释与台账 G9）—— 把字段往栏里搬，行的宽度问题才真的解决。
 *
 * 🔴 所以本文件遵守的不变量是：**每个字段任何时刻只有一个编辑器所有者**。
 * 已搬进来的是**备注**（`NoteField`，§8.138）、**重复**（`RepeatField`，§8.141）、
 * **子任务**（`SubtaskField`，§8.144）、**提醒**（`ReminderField`，§8.145）、
 * **截止**（`DueField`，§8.146）与**清单 + 标签**（`OrganizerField`，§8.147）：
 * 每一单的同一笔提交里都要把行尾那半撤掉（`App.tsx` 的 `taskPaneInColumn` 反向条件），
 * 所以不存在"同一字段两处可编辑"的那个中间态；列表侧留下的分别是**只读徽标** `NoteBadge`、
 * **只读徽标** `RepeatChip`、**只读徽标** `SubtaskBadge` 与**只读徽标** `ReminderBadge`（"扫一眼要能看出哪条任务写过 /
 * 是重复的 / 挂在谁下面 / 挂了几条提醒"这一档不因为搬进栏里就丢掉），
 * 以及**只读 chip** `TagChips` —— 标签那一档留的是 chip 而不是"整块不画"，因为
 * **标签在共享层没有对应槽**（截止有 `task-meta`，标签没有），撤掉就等于列表里看不出哪条挂了标签。
 * ⚠️ 这一条是**分阶段**的，不是"这一单顺手做完"：其余字段（AI）
 * 仍住在行尾，登记成后续单，每一单都要重做"搬进来 + 行里撤掉"这两半，不许只搬一半。
 *
 * 另有一族**不是"从行尾搬进来"、而是此前根本没有手动入口**的字段也住在这里：
 * **标题改名**（`TitleField`，W7 —— `app-host` 的 `rename` 在 Web 上零调用点）与
 * **手动优先级**（原生 select，W7 —— `setPriority` 此前只有 AI 批量写入一个调用方）。
 * 它们在行尾没有"那半"要撤：行上从来没有过标题编辑器，优先级在行上也只有只读徽标。
 * 🔴 截止那一格特别记一笔：`check:row-single-source` 的断言 A 要求"复选框 + 标题 + 截止"三种信号
 * 同时出现在任务行里，所以截止的**显示**必须留在行上 —— 这一条**不是靠本文件满足的**：
 * 行上的显示早就在共享元信息条里（`task-meta` → `TaskBadges.due`），而原先行尾那颗触发器
 * 是它的**第二份**显示，所以这一格搬走时不留徽标（现量与理由在 `DueEditor.tsx` 文件头）。
 *
 * 🔴 **四分组（W6，审计 §4.6「详情列功能太全、层级不够」）**：此前七格字段是一条
 * 纵向平铺（备注 → 子任务 → 清单标签 → 重复 → 截止 → 优先级 → 提醒），层级只靠
 * 各自的区块头撑。现在固定四组、每组装一枚**分组头**，组内才是字段：
 *
 *   1. **基本信息**：标题（`TitleField`）、备注（`NoteField`）
 *   2. **时间**：截止（`DueField`）、提醒（`ReminderField`）
 *   3. **组织**：清单 + 标签（`OrganizerField`）、子任务（`SubtaskField`）、优先级（select）
 *   4. **自动化**：重复（`RepeatField`，其自定义 RRULE 已收进「高级」折叠，见该文件头第 4 条）
 *
 * 🔴 **优先级归「组织」而不是「时间」**（W7 原落点在截止与提醒之间）：优先级不是
 * 时间量 —— 它与"何时发生"无关；它是"这条任务在系统里怎么归置"的维度（四象限
 * 视图正是 优先级 × 截止 的投影，与清单/标签同属归置属性）。放进「时间」组是
 * 按旧 DOM 相邻硬凑的语义。AI 拆解/估时目前**没有**详情列入口（AI 仍住在行尾
 * 输入区），「自动化」组暂只有重复一格 —— 空组不画，组本身保留。
 *
 * ⚠️ 分组是**纯排布**：不新增字段、不改任何一格的提交语义/keys/接线 ——
 * W7 的改名与优先级两格原样纳入（只挪住址，见工单 W6 的前置认知）。
 *
 * ⚠️ 为什么这里**没有**未选中时的空态句子：沿用便签那一格的先例（§8.130 —— 未选中时那一格
 * 什么都不放）。习惯那一格放一句"选一条习惯…"是因为那块板子必须始终挂载
 * （`motivation.spec` 的白屏检测前提），任务这一格没有同样的约束。
 *
 * 🔴 未选中 / 那条已在别处被删 ⇒ 返回 `null`，而不是留一只指向不存在 id 的输入框。
 */
import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { cssVar, ICON_SIZE } from '@heyta/design-system';
import { useI18n, type MessageKey } from '@heyta/i18n';
import {
  Priority,
  aliveAttachmentsForTask,
  requiresModalCommitment,
  resolveDangerTier,
  type Task,
} from '@heyta/domain';
import { createAttachmentActions, createAttachmentBlobPort, type ActionContext } from '@heyta/app-host';
import { MAX_ATTACHMENT_BYTES } from '@heyta/shared-schema';
import {
  AttachmentList,
  EmptyState,
  attachmentFailureReasonOf,
  type AttachmentFailureReason,
  type AttachmentListLabels,
} from '@heyta/ui';
import { FolderOpen, MoreHorizontal, Type } from 'lucide-react';

import { useSelected } from '../../lib/selection.js';
import { currentState, dispatchChecked, dispatchIntent } from '../../lib/oplog.js';
import { DangerConfirmDialog } from '../../lib/dialog/DangerConfirmDialog.js';
import { useSyncStore } from '../sync/store.js';
import { ShareCommentsSection } from '../share/ShareCommentsSection.js';
import { text } from '../../lib/text.js';
import { NoteField } from './NoteEditor.js';
import { renderNoteMarkdown } from './markdown-render.js';
import { RepeatField } from './TaskRepeat.js';
import { SubtaskField } from './SubtaskPicker.js';
import { DueField } from './DueEditor.js';
import { OrganizerField } from './TaskOrganizer.js';
import { ReminderField } from '../reminders/ReminderPanel.js';
import { useTaskStore } from './store.js';

/*
  这个是**模块级常量**而不是行内样式字面量：后者会被
  `scripts/check-l4-no-style.mjs` 按出现次数计进棘轮（现量读数以脚本自己打印的为准）。
  文字档位整条从 `TEXT_STYLES` 取（AGENTS §5：不许只挑字号）。
  本单**不新起 `ht-*` 族** —— `check:row-single-source` 的那枚棘轮余量为 0（28 = 基线 28），
  所以栏内边距走既有的 `.ht-app__detail-task`、标题走既有的 `.ht-app__detail-heading`。
*/
const blockLabelStyle: CSSProperties = {
  ...text('group-label'),
  color: cssVar('color.foreground-muted'),
  marginTop: cssVar('space.3'),
  marginBottom: cssVar('space.1'),
};

/*
 * 四分组的**分组头**（W6，审计 §4.6）。与 `blockLabelStyle` 同一条理由：模块级常量，
 * 不给 `check-l4-no-style` 的棘轮加数。
 *
 * 🔴 档位取 `headline`（base + semibold，AGENTS §5 文字层级表里"子块/卡片标题"
 * 那一档 —— 设置面板的 `.ht-settings__h3` 就是这一档）。两个刻意不取的邻居：
 *   - **不取 `section-title`（lg + semibold）**：面单那只 h2 标题就是 lg，
 *     四枚分组头若同为 lg，标题就失去了统领层级（一屏里五个同号标题 = 没有标题）；
 *   - **不取 `group-label`（sm + muted，即下面字段标签那一档）**：分组头与
 *     字段标签同档同色，四组与七枚字段标签就混成一层 —— 分组等于没分。
 * 于是面单内是三层：标题（lg）→ 分组头（base + semibold，前景色）→
 * 字段标签（sm + semibold，muted）。分组间距走 `space.4`（比字段标签的
 * `space.3` 大一档，"组间 > 组内"用间距说出来）。
 */
const groupHeaderStyle: CSSProperties = {
  ...text('headline'),
  color: cssVar('color.foreground'),
  marginTop: cssVar('space.4'),
  marginBottom: cssVar('space.2'),
};

/*
  标题改名那一格的两枚样式。与 `blockLabelStyle` 同一条理由：模块级常量，
  不给 `check-l4-no-style` 的棘轮加数。共同前提：字号/字重/行高/文字色全部来自
  `.ht-app__detail-heading`（class 选择器压得过 `reset.css` 的 `input` 元素选择器），
  这里只补"像一只标题、不像一只表单框"的那几件事。
*/
/** 待机态（那只 `<h2>`）：光标呈文本状，是"点它可以改"的入口暗示。 */
const titleIdleStyle: CSSProperties = {
  cursor: 'text',
};

/**
 * 编辑态（接替 h2 的那只输入框）：剥掉输入框默认的边框/底色/内边距，
 * 让它接在那只 h2 原来的位置上 —— 外观仍是标题层级，编辑的是标题本身。
 * 🔴 刻意**不动 `outline`**（AGENTS §5）：焦点环是编辑态唯一的视觉信号，
 * 抹掉它就是那条"最常见的可访问性回归"。
 */
const titleInputStyle: CSSProperties = {
  border: 'none',
  background: 'transparent',
  padding: 0,
  margin: 0,
  width: '100%',
};

/**
 * 标题那一格（W7）：默认仍是那只**只读** `<h2>`，点它（或聚焦后按 Enter）进入改名。
 *
 * 🔴 为什么是"点进去改"而不是常驻输入框：这一格的既有判据认的是"pane 里有一只
 * `h2`、文本就是标题"（`tests/task-detail-card.spec.tsx` 与 e2e 的
 * `detail-pane-task.spec.ts` 都在读它），把 h2 换成常驻输入框会把那些判据全打断，
 * 而"点开才改"在桌面对照（滴答/Todoist 的详情面）里也是标题改名的常态形态。
 *
 * 提交纪律与 `NoteField` 同一条（一个用户意图 = 一条 op）：
 * **失焦或 Enter 才提交**，Esc 还原；trim 后为空或没变**不发 op** ——
 * 动作层的校验（空标题 throw、找不到任务 throw）不在这一层复判（见 store 的
 * `renameTask`）。零业务逻辑：这里只把用户打的字读出来交给 store。
 *
 * 🔴 编辑会话**锚在 `task.id` 上，而不是给本组件挂 `key={task.id}` 重挂**。
 * 两个理由：
 *   ① 语义上"换选中 = 退场"用一枚 id 锚就能表达（`editingFor !== task.id` ⇒ 待机态），
 *      上一条没提交的草稿天然不跟着人走 —— 不需要靠卸载整个组件来重置。
 *   ② 实测 React 19.3（jsdom/`act` 环境）对 pane **首位**子元素的 keyed 重挂会
 *      **留下旧节点**：换选中后 DOM 里**两只 h2 并存**（旧的甲在前），既有判据
 *      `querySelector('h2')` 读到的是旧的那只。同形状的 key 在其余几位（备注 /
 *      子任务 / 重复 / 截止）没踩到，唯独首位踩到 —— 不追根因到 React 内部，
 *      换一条不依赖"keyed 重挂"的写法，行为两样全保（复现见
 *      `tests/task-detail-edit.spec.tsx` 的"换选中"一族）。
 */
function TitleField({ task, onRename }: { task: Task; onRename: (title: string) => void }): React.JSX.Element {
  const { t } = useI18n();
  /** 正在改名的是哪一条（`null` = 待机态）。换人 ⇒ 会话作废，见下。 */
  const [editingFor, setEditingFor] = useState<string | null>(null);
  /**
   * 一次编辑会话只提交一次。Enter 提交后输入框随即卸载，个别环境仍会对它补一发
   * `focusout` —— 没有这道闸，同一次改名会走两遍 `commit`，写出两条 op。
   */
  const settled = useRef(false);

  // 换了人 ⇒ 上一场会话作废（渲染期派生重置，React 认可的"props 变了调 state"形态；
  // 不用 effect 兜底 —— 那会先画一帧"上一条的编辑态"再消失）。
  if (editingFor !== null && editingFor !== task.id) {
    setEditingFor(null);
  }
  const editing = editingFor === task.id;

  const begin = (): void => {
    settled.current = false;
    setEditingFor(task.id);
  };

  const end = (): void => {
    settled.current = true;
    setEditingFor(null);
  };

  const commit = (value: string): void => {
    if (settled.current) return;
    end();
    const trimmed = value.trim();
    // 空或没变都不发 op："点开又点走"不该给任务白写一条标题 op（与 NoteField 同一条）。
    if (trimmed === '' || trimmed === task.title) return;
    onRename(trimmed);
  };

  if (!editing) {
    return (
      <h2
        className="ht-app__detail-heading"
        data-testid="task-detail-title"
        style={titleIdleStyle}
        // 键盘也能进改名（读屏/纯键盘用户与鼠标点击是同一件事）。
        tabIndex={0}
        onClick={begin}
        onKeyDown={(event) => {
          if (event.key === 'Enter') begin();
        }}
      >
        {task.title}
      </h2>
    );
  }

  return (
    <input
      data-testid="task-detail-title-input"
      className="ht-app__detail-heading"
      style={titleInputStyle}
      aria-label={t('web.ai.capture.field.titleAria')}
      // 非受控 + autoFocus：提交时机（失焦/Enter）与打字的重渲染本就不该绑在一起
      // （NoteField 文件头第 2/4 条）。
      autoFocus
      defaultValue={task.title}
      onBlur={(event) => {
        commit(event.currentTarget.value);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          // `currentTarget` 而不是 `target`：React 的 KeyboardEvent 没把 target
          // 收窄成元素（FocusEvent/ChangeEvent 才有），只有 currentTarget 是带类型的。
          commit(event.currentTarget.value);
        } else if (event.key === 'Escape') {
          // 还原：退出编辑、不发 op（后续若还补来 focusout，被 `settled` 闸挡下）。
          end();
        }
      }}
    />
  );
}

/*
  🔴 完成态那一句**不能**借用 `blockLabelStyle`：看图时它和紧接其下的「备注」「子任务」
  区块头一模一样（同档同色），用户读到的是"这里有一个叫『已完成』的区块"，
  而不是"这条任务的状态"。所以它走辅助档（AGENTS §5：辅助/说明 = xs/sm + muted），
  并且**不**带区块头那点上边距 —— 它属于标题，不属于下一个区块。
*/
const statusLineStyle: CSSProperties = {
  ...text('caption'),
  color: cssVar('color.foreground-muted'),
  marginBottom: cssVar('space.1'),
};

/* ═══════════════════════════════════════════════════════════════════════
 * 附件（工单 #9 的 web 移植，2026-11-05）
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 移动端先做完了（`apps/mobile/src/screens/TaskDetailSheet.tsx` 的附件区），
 * web 侧此前是**零引用**：`grep -rn "attachments" apps/web/src packages/ui/src`
 * 只命中一个无关文件。这一格就是把那一份抬上共享层之后的接线，
 * 不是第二份实现。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 分工（AGENTS §3.5：`apps/*` 不许有一行在决定"业务上该怎么做"）
 *
 *   | 这件事 | 谁定 |
 *   |---|---|
 *   | 哪些附件算活着的、按什么序 | `@heyta/domain` 的 `aliveAttachmentsForTask` |
 *   | 字节数该显示成哪一档、怎么舍入 | `@heyta/domain` 的 `attachmentSizeIn` |
 *   | 先传字节还是先发 op、缺端口怎么拒 | `@heyta/app-host` 的 `createAttachmentActions` |
 *   | 一行长什么样、空态画什么、按钮在哪 | `@heyta/ui` 的 `AttachmentList` |
 *   | 文案、上传通道的来源、确认框 | **本文件**（这三件都是宿主的事） |
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 上传通道按**调用时刻**读服务端地址与令牌
 *
 * 与移动端 `TasksScreen.tsx` 同一条：`baseUrl` 用 getter、令牌用函数。
 * 写成"建 port 时抓一份快照"的表现是"在设置页换了服务端，附件仍然往旧服务器传"
 * 和"重新登录后令牌已轮换，上传一路 401" —— 两种都不会有人报错，
 * 只会让用户以为附件功能坏了。
 *
 * ⚠️ 没配服务端 / 没登录时 `createAttachmentBlobPort` 的三个方法**一个请求都不发**、
 * 直接回 `rejected`；本格据此说的是"附件没能加进来"，不是"上传失败"那种猜方向的提示。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么动作上下文写在这里，而不是复用 `features/tasks/store.ts` 的那一份
 *
 * 那一份带着 `withActionFailure`（失败要记进 store 的 `error`），而它**没有导出**
 * （`actionContext` 是模块私有）。这里的形状与 `features/share/comment-actions.ts` 的
 * `ctx` 逐字相同，`store.ts` 自己的注释也写了"两个 store 各写一份
 * `{dispatch, getState}` 是可以接受的，因为它只是两个函数引用，不含任何判断"。
 * ⇒ 一旦它开始包含判断（比如"离线时排队"），就该抽走，而不是在这里复制第二遍。
 */
const attachmentContext: ActionContext = {
  dispatch: (intent) => dispatchIntent(intent),
  dispatchChecked: (build) => dispatchChecked(build),
  getState: currentState,
};

/**
 * 附件动作集（**模块级一份**）。
 *
 * ⚠️ 与移动端同一个理由：它不是组件状态，重建一次只是再包一层闭包；
 * 而"每次渲染新建一个"会让 `useMemo` 的依赖永远在变。
 */
const attachmentActions = createAttachmentActions(attachmentContext, {
  blobs: createAttachmentBlobPort(
    {
      get baseUrl(): string {
        return useSyncStore.getState().baseUrl;
      },
    },
    () => useSyncStore.getState().token,
  ),
});

/** 单文件上限的 MB 读数（错误句里的 `{max}`）。与词条同一个来源：`MAX_ATTACHMENT_BYTES`。 */
const MAX_ATTACHMENT_MB = String(Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024)));

/**
 * 失败原因 → 那句话。
 *
 * 🔴 **穷尽表**：`Record<AttachmentFailureReason, MessageKey>`（不是 `Record<string, …>`），
 * 以后动作层多一种原因却忘了配文案，这里直接编译不过 —— 而运行时会静默落回统称。
 *
 * 每一格都要说不同的话：`no-channel` 是这台设备的事实（换台电脑才行）、
 * `too-large` 要换一个文件、`quota-exceeded` 要清理已有内容、`network` 可以原样再试、
 * `read-failed` 是文件本身读不出来 —— 合成一句"上传失败"就会让一半的用户去做一件
 * 没用的事（移动端 `TaskDetailSheet.tsx` 的 `UPLOAD_ERROR_KEYS` 记着同一条）。
 *
 * ⚠️ `rejected` 这一格是**统称**：认不出原因时才该走到它，而那时最像的那一条
 * 往往是错的（本仓库在密码锁那一栏踩过这个坑）。
 */
const ATTACHMENT_ERROR_KEYS: Record<AttachmentFailureReason, MessageKey> = {
  'too-large': 'mobile.detail.attachments.error.too-large',
  'quota-exceeded': 'mobile.detail.attachments.error.quota-exceeded',
  network: 'mobile.detail.attachments.error.network',
  'no-channel': 'mobile.detail.attachments.error.no-channel',
  'read-failed': 'mobile.detail.attachments.error.read-failed',
  rejected: 'mobile.detail.attachments.error.rejected',
};
const ATTACHMENT_FALLBACK_KEY: MessageKey = ATTACHMENT_ERROR_KEYS.rejected;

/**
 * 取错的**原因**只问共享层那一枚（`attachmentFailureReasonOf`）。
 *
 * 🔴 这里原来用的是 `rejectionReasonOf`（`@heyta/ui` 的 subtasks 那一枚），实测它
 * **读不出这条链上两个最要紧的原因**：正则 `/（([a-z_]+)）/` 不认连字符，而
 * `too-large` / `quota-exceeded` 都带连字符 ⇒ 两者一起降级成统称，
 * "换个文件"与"去清理空间"变成同一句话。判据在
 * `packages/ui/tests/attachments-model.spec.ts`（那一条用真消息喂它）。
 */
function attachmentFailureKey(cause: unknown): MessageKey {
  const reason = attachmentFailureReasonOf(cause);
  return reason === undefined ? ATTACHMENT_FALLBACK_KEY : ATTACHMENT_ERROR_KEYS[reason];
}

/**
 * 读文件的结果联合（与移动端 `readPickedDocument` 同一个形状）。
 *
 * ⚠️ 读失败**不抛**：它与"上传被拒"是两句不同的话（"这个文件没能读出来，换一个试试"
 * vs 额度满 / 太大 / 断网），而 `rejectionReasonOf` 只认小写+下划线的 reason
 * （`read-failed` 里的连字符过不了那个词表）—— 硬塞进去就会静默降级成统称。
 */
type FileReadResult = { readonly ok: true; readonly dataBase64: string } | { readonly ok: false };

/**
 * 浏览器里把一份文件读成 base64。
 *
 * 🔴 用 `FileReader` 而不是 `file.arrayBuffer()`：后者在 jsdom（本仓 web 单测与
 * 契约测试跑的那个环境）里**不存在**（实测 `typeof file.arrayBuffer === 'undefined'`），
 * 写成它会让"加附件"这条路在测试里永远走不通 —— 而它恰恰是判据 ① 的唯一入口。
 * `FileReader` 四个端（含 jsdom）都有，代价只是多切一次 `data:` 前缀。
 *
 * 🔴 切法是 `indexOf(',')` 而**不是** `split(',')[1]`：`data:<mime>;base64,<payload>`
 * 里 mime 段自己可能带逗号（`data:text/plain;charset=utf-8,`），而 payload 段是纯
 * base64、不含逗号 —— 所以"第一个逗号之后"才是那条边界。少切一次就把前缀当字节传上去，
 * 服务端算出来的 `byteCount` 会莫名多出十几个字节。
 */
function readFileBase64(file: File): Promise<FileReadResult> {
  return new Promise<FileReadResult>((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => {
      resolve({ ok: false });
    };
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        resolve({ ok: false });
        return;
      }
      const comma = result.indexOf(',');
      resolve(comma < 0 ? { ok: false } : { ok: true, dataBase64: result.slice(comma + 1) });
    };
    reader.readAsDataURL(file);
  });
}

/**
 * 移除一个附件的**危险档**。
 *
 * 🔴 判据走共享层那一枚（`resolveDangerTier`），不在这里拍：
 * `docs/agents/overlay-feedback.md` §2 的锚是"做错了要花多少代价恢复"。
 *   · `undoAvailable: false` —— **不手填**：`isUndoableDeletion` 的定义域里没有
 *     `attachment`（四类只有 task/note/list/habit），而这条通道上**也没有读端点**
 *     （见 `packages/shared-schema/src/attachment-http-contract.ts` 的 `ATTACHMENT_ROUTES`：
 *     `GET` 是被明确排除的，理由写在那一段），所以"撤销"这件事根本无从谈起；
 *   · `destroysIrrecoverableResource: true` —— 字节在那一步就还给服务端了，
 *     回收站里也没有它的位置（`DEL` 留下的是元数据墓碑，**不是可恢复的文件**）。
 * ⇒ `alert`：模态确认，`requiresModalCommitment` 为真。
 *
 * ⚠️ 与移动端的差别**只在手段**：那边是按钮两态（"再点一次确认移除"），
 * 因为 RN 端除 `Alert.alert` 外没有共享模态壳，而原生框已被 `check:overlay` 的 R1 记账。
 * 两端**结果一致**（都问过），手段不同（`check:dirty-form-policy` 那一节的口径）。
 */
const REMOVE_ATTACHMENT_TIER = resolveDangerTier({
  affectedCount: 1,
  undoAvailable: false,
  destroysIrrecoverableResource: true,
});

/**
 * 附件那一格的错误行。
 *
 * ⚠️ 模块级常量而不是行内样式字面量：后者会被 `check-l4-no-style.mjs`
 * 按出现次数计进棘轮（基线以脚本里那张表为准）。文字档位整条从 `TEXT_STYLES` 取。
 */
const attachmentErrorStyle: CSSProperties = {
  ...text('caption'),
  color: cssVar('color.danger'),
  marginTop: cssVar('space.1'),
};

/**
 * 附件那一格（列表 / 添加 / 移除）。
 *
 * 🔴 **`key={task.id}` 由调用点给**：这一格有本地状态（在途、失败句、待确认的那一条），
 * ↑↓ 换选中时不换 key 会把上一条任务的失败句与"正要删的那一行"带过来
 * —— 与备注 / 截止 / 子任务那几格同一条纪律（"有本地 state 才要 key"）。
 *
 * 🔴 附件表**直接读物化状态**，不维护第二份本地列表：动作层发的是 op，
 * 引擎通知 → store 换表 → 这里重算。这样"另一台设备加进来的附件"与本机加的一样会出现，
 * 而"只活在本端 state 里"的那种实现根本不会有这个能力。
 * 过滤与顺序仍问领域层（`aliveAttachmentsForTask`），本文件不写 `filter`。
 */
function AttachmentField({ task }: { task: Task }): React.JSX.Element {
  const { t } = useI18n();
  /**
   * 订阅附件表。**依赖里那个变量就是订阅本身** —— 它在 body 里只被"表变了"这件事用到，
   * 而真正的过滤/排序在下一行交给领域层。
   */
  const attachmentsTable = useTaskStore((state) => state.entities.attachments);
  const rows = useMemo(
    () => aliveAttachmentsForTask(Object.values(attachmentsTable), task.id),
    [attachmentsTable, task.id],
  );

  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<MessageKey | undefined>(undefined);
  const [pendingRemove, setPendingRemove] = useState<{ readonly id: string; readonly fileName: string } | undefined>(
    undefined,
  );
  /** 选文件的入口。`<input type="file">` 是浏览器给的那一个，不画第二枚按钮。 */
  const fileInput = useRef<HTMLInputElement | null>(null);

  const remove = (id: string): void => {
    setFailure(undefined);
    setBusy(true);
    void attachmentActions
      .removeAttachment(id)
      .catch((cause: unknown) => {
        setFailure(attachmentFailureKey(cause));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  /**
   * 从选中的那一份文件走完整条链：读字节 → 传字节 → 发 op。
   *
   * 🔴 `targetId` 在选完之后立刻定下来：这一格可以在不卸载的情况下换到另一条任务，
   * 用 `task.id` 收尾会把附件挂到**当时正在显示的那条**上，而不是用户选文件时看的那条
   * （移动端 `runAddAttachment` 记着同一条）。
   */
  const submitPicked = (input: HTMLInputElement): void => {
    const file = input.files?.[0];
    /**
     * 🔴 先清空 `value`：不清的话"选同一个文件第二次"不会再触发 `change`
     * （浏览器认为值没变），症状是"点了没反应"。
     */
    input.value = '';
    if (file === undefined || busy) return;
    const targetId = task.id;
    setFailure(undefined);
    setBusy(true);
    const run = async (): Promise<void> => {
      try {
        const read = await readFileBase64(file);
        if (!read.ok) {
          setFailure('mobile.detail.attachments.error.read-failed');
          return;
        }
        await attachmentActions.addAttachment(targetId, {
          fileName: file.name,
          // 空 MIME 不传：`contentType` 缺席 = 未知，界面降级为通用文件图标
          // （`isImageAttachment` 对缺 MIME 一律按"不是图片"）。
          ...(file.type === '' ? {} : { contentType: file.type }),
          dataBase64: read.dataBase64,
        });
      } catch (cause: unknown) {
        setFailure(attachmentFailureKey(cause));
      } finally {
        setBusy(false);
      }
    };
    void run();
  };

  const labels: AttachmentListLabels = {
    /**
     * 空态**整块**交给共享 `EmptyState`（`check:empty-state` 的唯一修法：
     * "新的空态不许在视图里手写"）。`line` 档：它是"这一格没有内容"的一行辅助字，
     * 不是页面级空态 —— 页面档会把详情面撑出一块居中留白。
     */
    empty: <EmptyState size="line" testID="task-attachments-empty" title={t('mobile.detail.attachments.empty')} />,
    add: t('mobile.detail.attachments.add'),
    uploading: t('mobile.detail.attachments.uploading'),
    remove: t('mobile.detail.attachments.remove'),
    size: {
      // 档位（bytes / kb / mb）与舍入**不在这里判**：`attachmentSizeIn` 在领域层，
      // 这里只把那一档交回给词条念出来（单位词是文案）。
      bytes: (n) => t('mobile.detail.attachments.size.bytes', { n }),
      kb: (n) => t('mobile.detail.attachments.size.kb', { n }),
      mb: (n) => t('mobile.detail.attachments.size.mb', { n }),
    },
  };

  return (
    <>
      {/*
        ══ 附件 ══════════════════════════════════════════════════════════
        放在**内容层**、紧跟「自动化」组之后、「协作区」之前：附件是这条任务身上
        挂的材料，不是它的属性 —— 四分组（基本 / 时间 / 组织 / 自动化）是审计 §4.6
        钉死的**任务属性**分组，附件挤进任何一组都会让那四组的语义变形。
        ⇒ 与评论同一条口径：标题视觉同款（同一枚 `groupHeaderStyle`）但**不冒充分组**
        （不挂 `data-testid="task-detail-group"`，`task-detail-groups.spec.tsx` 数的正是它）。

        ⚠️ 这一格此前在 web 上**根本不存在**（引用数为 0），所以它不是"从行尾搬进来"，
        没有"行里撤掉那半"要配套。
      */}
      {/*
        🔴 区块头**只写「附件」**，不叠「{n} 个附件」那一句（移动端叠了，见下）。

        `mobile.detail.attachments.count` 的模板是 `{n} 个附件`，而它旁边就是标题
        「附件」—— 两块相邻连读成「**附件 1 个附件**」，那是同一句话说了两遍
        （移动端那一格是这个形状；本单照搬过一次，真浏览器截图里读起来是坏的）。
        列表本身就把数量和内容一起说清了，所以 web 这一格不画那个数字。
        要"标题 + 只出数字"需要一条新词条（`{n}` 而不是 `{n} 个附件`），
        而 `packages/i18n` 是本单的黑名单 —— 所以正确的动作是**少画一句**，
        而不是在 web 侧拼一串自有文案。
      */}
      <h3 style={groupHeaderStyle} data-testid="task-detail-attachments">
        {t('mobile.detail.attachments.title')}
      </h3>

      <AttachmentList
        items={rows}
        labels={labels}
        busy={busy}
        onAdd={() => {
          setFailure(undefined);
          fileInput.current?.click();
        }}
        onRemove={(id) => {
          /**
           * 🔴 这一下**不删**，只打开确认框（危险档见 `REMOVE_ATTACHMENT_TIER`）。
           * 文件名一起记下来：确认框要复述对象，而删掉之后列表里已经没有它了。
           */
          const row = rows.find((item) => item.id === id);
          if (row === undefined) return;
          setPendingRemove({ id: row.id, fileName: row.fileName });
        }}
        testID="task-attachments"
      />

      {/*
        选文件的入口本身不可见：`<input type="file">` 的原生外观在四个端上是四种样子，
        而共享组件已经画好了那一枚「添加附件」。`hidden` 而不是 `display:none` 样式
        —— 后者要新增一条 CSS 类，而本文件不新起 `ht-*` 族（`check:row-single-source` 的棘轮余量为 0）。
      */}
      <input
        ref={fileInput}
        type="file"
        hidden
        data-testid="task-attachment-file-input"
        onChange={(event) => {
          submitPicked(event.currentTarget);
        }}
      />

      {failure === undefined ? null : (
        <p role="alert" style={attachmentErrorStyle} data-testid="task-attachment-error">
          {t(failure, { max: MAX_ATTACHMENT_MB })}
        </p>
      )}

      {/*
        移除确认。复用 Web 既有那一枚危险确认件（`lib/dialog/DangerConfirmDialog.tsx`
        —— 共享 `DangerDialog` 的外壳在真实浏览器里那一层不挂载，见 §7 第 606 条），
        不自绘第二层，也不引原生框（`check:overlay` 的 R1 记账着那七处）。

        ⚠️ 文案全部**借用既有词条**，本单不许改 `packages/i18n`：
        · 标题 = 动作名（「移除」）—— 没有「移除「{文件名}」？」那条词条，
          而新起一条就是第二份文案；
        · 正文 = **文件名本身**（用户自己的字，不翻译）——
          范围那一格要说的是"删的是哪一个"，文件名就是它。
        🔴 **已知缺口（如实记）**：缺一条"移除之后要重新添加这个文件、回收站里也没有它"
        的词条。i18n 是黑名单，所以本单没有补；确认框因此只有"动作 + 对象"，
        少一句后果。补词条是 i18n 那条线的活，不是在这里用第二句兜。
      */}
      {pendingRemove === undefined ? null : (
        <DangerConfirmDialog
          testId="task-attachment-remove-confirm"
          labelledBy="task-attachment-remove-confirm-title"
          modalCommitment={requiresModalCommitment(REMOVE_ATTACHMENT_TIER)}
          cancelLabel={t('web.rowMenu.cancel')}
          // 🔴 主按钮复述**动词**（「移除」），不是「确定」。
          confirmLabel={t('mobile.detail.attachments.remove')}
          onCancel={() => {
            setPendingRemove(undefined);
          }}
          onConfirm={() => {
            // 先关确认框再写：写失败（例如这条附件已被别处删掉）不该把确认框
            // 永远卡在屏幕上 —— 失败由上面那一行 `role="alert"` 说给用户。
            const target = pendingRemove;
            setPendingRemove(undefined);
            remove(target.id);
          }}
        >
          <h2 id="task-attachment-remove-confirm-title">{t('mobile.detail.attachments.remove')}</h2>
          <p data-testid="task-attachment-remove-confirm-name">{pendingRemove.fileName}</p>
        </DangerConfirmDialog>
      )}
    </>
  );
}

/**
 * 详情列里的任务面单。
 *
 * 🔴 它**只**在详情列画（`App.tsx` 那一支要求 `detailColumnShown`），所以这里没有
 * `inset` 参数：便签与习惯那两个生产者有第二落点（板子/列表旁边），因此"哪一支带内边距"
 * 必须显式说清。
 *
 * ⚠️ **2026-11 行操作重设计之后它确实有了第二个落点**：行尾那一排编辑器（备注 / 子任务 /
 * 清单+标签 / 重复 / 截止 / 提醒）整排撤掉了 ⇒ 窄档与"详情列被收起"这两档如果没有落点，
 * 那些字段就变成不可编辑。所以宿主在**同一只卡片**外面套了一层 `WebModalShell`
 * （`App.tsx` 的「任务详情」对话框），内边距由对话框那一层给。
 * 判据：`tests/task-row-menu.spec.tsx` 的 P3 —— 行尾不再有编辑器，而两档都够得着面单。
 * 内边距由 `.ht-app__detail-task` 给（挂在既有 `.ht-app` 族下，理由见上面棘轮那段）。
 */
export function TaskDetailCard({
  automationSlot,
  onShowActions,
}: {
  /**
   * 「自动化」组里属于**宿主**的那一格（行操作 UX 重设计，2026-11）。
   *
   * 🔴 为什么是插槽而不是把 AI 那两个组件搬进来：`AiBreakdown` / `AiDuration` 要吃
   * `aiRouting` / `consents` / `secrets` / `health` / `preferenceSet` 五组**只住在
   * `App.tsx` 的状态**，而本卡片是**唯一**能同时出现在详情列与窄档对话框里的面单
   * （两份落点）。把那些状态灌进来会变成"卡片认识 AI 的接线"，与它"只读 store"的
   * 定位相反；传一个 `ReactNode` 则保持**一份实现、两个落点**（与
   * `renderMeta` / `renderTrailing` 同一形状）。
   *
   * ⚠️ 此前 AI 拆解 / 估时住在行尾那枚「⋯ 更多」里 —— 那是"自动化"组的临时住址。
   * 行尾不再挂编辑器之后，它们的正确住址就是这里（审计 §4.6 早已把这一组留给它们）。
   */
  automationSlot?: React.ReactNode;
  /**
   * 底部工具条第三枚「更多」（C2，滴答对齐）：打开**这一条任务**的操作菜单。
   *
   * 🔴 为什么这一枚不是"可有可无的装饰"：行右键菜单那一路（置顶 / 优先级 / 标签 /
   * 移动到 / 删除）此前**只有两个入口** —— 右键与 `Shift+F10`，界面上没有任何可见的
   * 把手（历史上它住在行尾那枚「⋯ 更多」里，那一排随「撤掉行尾编辑器」一起被收走了，
   * 动作区却没有跟着补一个家）。也就是说不用鼠标右键的人**看不见**这些操作。
   * 面单是"这条任务"的统领面，第三枚就住在这里。
   *
   * ⚠️ 它**不写第二个动作实现**：只把视口锚点交给宿主，宿主调的还是同一个
   * `setRowMenu` —— 菜单本体、关闭策略、危险档全在那一份里。
   * 没接这个回调的落点（如测试夹具）就只画两枚，不画按下去没反应的按钮。
   */
  onShowActions?: (taskId: string, anchor: { readonly x: number; readonly y: number }) => void;
} = {}): React.JSX.Element | null {
  const { t } = useI18n();
  const store = useTaskStore();

  /**
   * 这一栏展开的那一条 = **共享选中态**，不是又一个本地状态，也没有本地回落。
   *
   * 🔴 存 id 不存对象：`entities.tasks` 每次 op 后都是新表，握住对象会让面单显示一份
   * 过期的标题 / 备注。渲染时从表里现取。
   */
  const selectedId = useSelected('task');
  const picked = selectedId === null ? undefined : store.entities.tasks[selectedId];
  /**
   * 🔴 "在不在"要判两件事：**表里有这条**，且它**没被删掉**。
   *
   * 软删（`DEL` op → reducer 写 `deletedAt`）不会把任务从 `entities.tasks` 里拿掉 ——
   * 它是回收站那一格的住户，墓碑必须留着（`packages/domain/src/entities.ts:37`）。
   * 而删除那一刻，选中态是留在这一条上的（列表里那行消失了，`selection` 没人清）。
   * 所以只看"表里有没有"会让这一格继续画一条**界面上已经不存在的任务**：
   * 标题和备注都还在栏里，用户读到的是"这条任务还在，只是我没选它"。
   */
  const task = picked !== undefined && picked.deletedAt === undefined ? picked : undefined;
  /**
   * 底部工具条（C2）要的**这一格**的根。
   *
   * 🔴 用 ref 而不是 `document.querySelector`：窄档的「任务详情」对话框与宽档的详情列
   * **同时挂着两棵 `task-pane`**（`App.tsx` 两处渲染同一个组件），整篇文档去查会点到
   * 另一棵里的那个控件 —— 症状是"按钮跳了，但跳到我没看的那一份"。
   */
  const paneRef = useRef<HTMLDivElement | null>(null);
  if (task === undefined) return null;

  /** 把这一格里的某个控件滚到眼前并交还焦点（工具条两颗按钮干的就是这一件事）。 */
  const focusInPane = (testId: string): void => {
    const target = paneRef.current?.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
    if (target === null || target === undefined) return;
    // `?.()` 不是保险丝而是事实：jsdom 不实现 `scrollIntoView`，而这条判据要能在
    // 单测里量到"焦点真的落在目标控件上"（浏览器里那一步照常生效）。
    target.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    target.focus({ preventScroll: true });
  };

  return (
    <div ref={paneRef} className="ht-app__detail-task" data-testid="task-pane">
      {/*
        标题（W7 起可改）。内容仍是**用户自己的字**，原样呈现、不翻译（与行内那颗
        chip 的预览同一个口径）；改名走 `store.renameTask` → `app-host` 的 `rename`
        —— 那条路此前在 Web 上**零调用点**，这是补上的第一只手动入口。
        ⚠️ 待机态这一块刻意只有标题，没有复选框也没有截止 —— `check:row-single-source`
        的断言 A 认的"任务行"是三种信号同时出现在同一棵子树里，这一格是**面单**不是第二份行实现。
        🔴 W6 起它是面单的统领元素、**不属于任何一组**：四枚分组头排在它下面
        （同取 lg 会让标题失去层级，见 `groupHeaderStyle` 那段注释）。
      */}
      {/* `overflow-wrap` 在 `.ht-app__detail-task` 上给（它是可继承属性），
          所以这里不需要行内样式 —— 22rem 的一栏里一个长英文单词不许把栏撑破。 */}
      <TitleField
        task={task}
        onRename={(title) => {
          void store.renameTask(task.id, title);
        }}
      />

      {/* ══ 分组一：基本信息（W6，审计 §4.6）═══════════════════════════ */}
      <h3 style={groupHeaderStyle} data-testid="task-detail-group">
        {t('web.tasks.detail.section.basic')}
      </h3>

      {/*
        🔴 完成态在栏里要有**一句只读的话**，不能只靠"列表里那行没了"来传达。
        §8.148 边界 ② 看图照出来的形状：收集箱勾掉一条 ⇒ 行从这一列消失，而这一格继续画着它，
        且和未完成时长得一模一样 —— 用户读到的是"选中了一条看不见的任务"。
        为什么不是"把选中回落掉"：`packages/app-host/src/selection.ts:127-131` 那条红线
        （判据钉在 `packages/app-host/tests/selection.spec.ts:170`）写明回落只认"实体还在不在"，
        认"当前筛不筛得到"会让用户切一下筛选就把正在编辑的那条判成不存在、面板自己关掉。
        ⚠️ 这一行**不是第二颗编辑器**：完成态的编辑器仍是行尾那颗复选框（§8.138 那条不变量），
        所以这里既没有 `onClick` 也不是 `button`，摘掉它只会让这一格少一句话、不会少一个入口。
      */}
      {task.completedAt !== undefined ? (
        <p data-testid="task-pane-status" style={statusLineStyle}>
          {t('task.pane.completed')}
        </p>
      ) : null}

      {/*
        区块头复用词条表里已有的那一句「备注」：占位符复用 composer 那句是同一个理由
        （两处问的是同一件事，各起一条词条迟早漂成两种说法）。
      */}
      <h3 style={blockLabelStyle}>{t('web.note.toggle')}</h3>

      {task.note && task.note.trim() !== '' ? (
        <div
          className="ht-note-preview"
          data-testid="task-note-rendered"
          dangerouslySetInnerHTML={{ __html: renderNoteMarkdown(task.note) }}
        />
      ) : null}

      {/*
        🔴 `key={task.id}`：`NoteField` 里那只输入框是**非受控**的（`defaultValue` +
        `key={note}`），↑↓ 换选中时如果外层不换 key，两条备注恰好同字的任务会让框里
        留着上一条的内容 —— 而界面看起来"跟着换了"（标题已经换了）。
      */}
      <NoteField
        key={task.id}
        task={task}
        onSetNote={(note) => {
          void store.setNote(task.id, note);
        }}
      />

      {/* ══ 分组二：时间（W6）════════════════════════════════════════ */}
      <h3 style={groupHeaderStyle} data-testid="task-detail-group">
        {t('web.tasks.detail.section.time')}
      </h3>

      {/*
        截止（§8.146）。区块头复用行尾那颗触发器已经在说的 `web.due.trigger`（「截止」）——
        两处问的是同一件事，另起一条词条迟早漂成两种说法。
        这一格里**没有** `<details>`、也**没有** Portal 与 `.ht-material`：那三件都是
        "行尾那一支在哪儿画"的细节（与 §8.141 的 R4、§8.144 的 S4、§8.145 的 M4/M5 同一条纪律），
        栏里要的只是编辑本体。这一格也**不放只读徽标**：截止的显示在共享行的元信息条上
        （`task-meta`），两档都在，理由见 `DueEditor.tsx` 文件头那张表的第三行。
        🔴 `key={task.id}`：`DatePicker` 带**本地 state**（"正在看哪个月"），↑↓ 换选中时
        不换 key 会把上一条浏览到的月份带过来 —— 与组织那一格的 `OrganizerField`
        （零 useState ⇒ 不挂 key）正好是那条纪律的两面。
      */}
      <h3 style={blockLabelStyle}>{t('web.due.trigger')}</h3>
      <DueField
        key={`due-${task.id}`}
        task={task}
        now={store.now}
        onSetDueDate={(due, dueDateLocal) => {
          void store.setDueDate(task.id, due, dueDateLocal);
        }}
      />

      {/*
        提醒（§8.145）。与重复那一格同一条理由，这里**不叠 `h3`**：共享的 `ReminderList`
        自带区块头（`labels.title` 渲染成 `accessibilityRole="header"`，见
        `packages/ui/src/reminders/ReminderList.tsx`），两处同一个词说两遍，读到的是"有两个区块"。
        行尾那一支的玻璃浮层外壳（`.ht-compose-panel ht-material`）也**不跟着本体进栏** ——
        一栏里漂一块 `position: absolute` 的板子，用户读到的是"这格里浮着不属于这格的东西"
        （§8.141 的 R4 钉的就是这一档）。
        ⚠️ 这里**没有** `key`，而且不是漏掉：这一组的两格都要 key 是因为它们各自带**本地草稿 state**
        （非受控框 / 月历浏览态），而 `ReminderField` 与 `ReminderList` 全程只有
        `useMemo`、零 `useState`（提醒列表来自 store，按 `task.id` 取）。↑↓ 换选中时它没有
        上一条的状态可带 —— "搬进栏里就要加 keys"不是这条纪律，**有本地 state 才是**。
      */}
      <ReminderField task={task} />

      {/* ══ 分组三：组织（W6）═══════════════════════════════════════ */}
      <h3 style={groupHeaderStyle} data-testid="task-detail-group">
        {t('web.tasks.detail.section.organize')}
      </h3>

      {/*
        清单 + 标签（§8.147）。🔴 与重复/提醒那两格同一条理由，这里**不叠 `h3`**：
        `OrganizerField` 自带两个区块头（`<label>` 里那句「清单」与 `<fieldset>` 的
        `<legend>`「标签」），两处同一个词说两遍，读到的是"有两个区块"。
        行尾那一支的 `<details>` 与 `.ht-material` 也**不跟着本体进栏**（§8.141 的 R4、
        §8.145 的 M4/M5、§8.146 的 D3/D4 钉的都是这一档，pane 级那一条判据在 e2e 层只有
        T10 一个消费者 —— 任何一格套上外壳都红在它身上）。
        ⚠️ 这里**没有** `key`，而且不是漏掉：两个控件全部受控于 store、整块零 `useState`，
        所以 §8.145 那条"有本地 state 才要 key"落在**不挂**那一侧 ——
        与时间组里截止那一格正好相反（`DatePicker` 带 `useState(month)` ⇒ 必须挂）。
      */}
      <OrganizerField
        task={task}
        onMoveToProject={(projectId) => {
          void store.moveToProject(task.id, projectId);
        }}
        onSetTags={(tagIds) => {
          void store.setTags(task.id, tagIds);
        }}
      />

      {/*
        子任务（§8.144）。区块头复用词条表里已有的那一句「子任务」（`web.subtask.none`）——
        它在行尾那颗 chip 上说的就是同一件事，另起一条词条迟早漂成两种说法。
        🔴 编辑本体里**没有** `<details>`：那是行尾那一支的展开机关，栏里要的只是控件本身
        （与重复那一格同一条理由）。
        `key={task.id}`：拒绝提示是本地 state，↑↓ 换选中时不换 key 会把上一条的提示带过来。
      */}
      <h3 style={blockLabelStyle}>{t('web.subtask.none')}</h3>
      <SubtaskField
        key={`subtask-${task.id}`}
        task={task}
        onSetParent={(parentId) => store.setParent(task.id, parentId)}
      />

      {/*
        优先级（W7）。此前 Web 上它是"只读显示（共享徽标）+ AI 批量写入"——
        `TaskActions.setPriority` 与 `store.setPriority` 一直存在，却没有任何
        手动控件调用它：用户点不了自己的优先级，只能等 AI 批量写。
        区块头复用 AI 拆解已在说的 `web.ai.capture.field.priority`（「优先级」），
        选项文案复用 AI 排优先级那四条 `web.ai.prioritize.priority.*`（无/低/中/高）
        —— 两处问的是同一件事，另起词条迟早漂成两种说法。**零新增词条**。
        原生 `<select>`（与清单下拉同一条理由：键盘、读屏、移动端适配都不自造）；
        受控于 store、零本地 state ⇒ 不挂 key（§8.145 那条纪律落在"不挂"那一侧）。
        🔴 选项顺序对齐 `Priority` 枚举（None→Low→Medium→High，`packages/domain`），
        value 用枚举数值串 —— 界面不发明第二套优先级词表。
        🔴 W6 起归「组织」组（W7 的原落点在截止与提醒之间，那是 DOM 相邻不是语义）：
        优先级不是时间量，是"任务怎么归置"的维度 —— 四象限视图正是
        优先级 × 截止 的投影，与清单/标签同属归置属性。裁决全文见文件头。
      */}
      <h3 style={blockLabelStyle}>{t('web.ai.capture.field.priority')}</h3>
      <select
        data-testid="task-priority-select"
        aria-label={t('web.ai.capture.field.priority')}
        value={String(task.priority ?? Priority.None)}
        onChange={(event) => {
          const next = Number(event.target.value) as Priority;
          // 没变不发 op：select 的 change 本只在值变化时触发，这道闸挡的是
          // 与"老数据里 priority 缺失时的回显值（None）"比较的那一类假变化。
          if (next === (task.priority ?? Priority.None)) return;
          void store.setPriority(task.id, next);
        }}
      >
        <option value={String(Priority.None)}>{t('web.ai.prioritize.priority.none')}</option>
        <option value={String(Priority.Low)}>{t('web.ai.prioritize.priority.low')}</option>
        <option value={String(Priority.Medium)}>{t('web.ai.prioritize.priority.medium')}</option>
        <option value={String(Priority.High)}>{t('web.ai.prioritize.priority.high')}</option>
      </select>

      {/* ══ 分组四：自动化（W6）═════════════════════════════════════ */}
      <h3 style={groupHeaderStyle} data-testid="task-detail-group">
        {t('web.tasks.detail.section.automation')}
      </h3>

      {/*
        重复。🔴 它**自带**区块头（编辑本体的 `<legend>` 就是那一句「重复规则」），
        所以这里不再叠一枚字段级的 `h3` —— 两处同一个词说两遍，读到的是"有两个区块"。
        这一格里也**没有浮层外壳**：`.ht-material` 与 `position: absolute` 属于行尾那一支
        （"这一格在哪儿画"的细节），栏里要的只是控件本身。
        ⚠️ W6 起控件**内部**多了一枚「高级」折叠 `<details>`（自定义 RRULE 收进去，
        见 `TaskRepeat.tsx` 文件头第 4 条）—— 那是编辑本体自带的进阶分区，不是行尾
        浮层外壳，pane 级不变量按"折叠默认收起 + 主编辑器不许藏进折叠"重新钉（见
        `tests/task-detail-groups.spec.tsx`）。
        `key={task.id}` 与备注同一理由：自定义 RRULE 那只草稿框是受控的本地 state，
        ↑↓ 换选中时不换 key 就会把上一条任务没提交的草稿带过来。
      */}
      <RepeatField
        key={`repeat-${task.id}`}
        task={task}
        now={store.now}
        onSetRepeat={(rule) => {
          void store.setRepeat(task.id, rule);
        }}
        onSetAfterCompletion={(on) => {
          void store.setRepeatAfterCompletion(task.id, on);
        }}
      />

      {/*
        AI 那一格（宿主注入，见 `automationSlot` 的注释）。
        空组不画：`automationSlot` 没给时这一组只剩重复，与改前逐字相同。
      */}
      {automationSlot === undefined ? null : (
        <div data-testid="task-detail-automation-slot">{automationSlot}</div>
      )}

      {/*
        ══ 附件（工单 #9 的 web 移植）═══════════════════════════════════════
        🔴 **这一行就是"它真的挂在详情面上"的全部证据**：去掉它，附件区从界面上消失
        而数据仍在（`apps/web/tests/task-detail-attachments.spec.tsx` 的判据 ② 钉着
        "去掉挂载点 ⇒ 判据 ① 必须失败"）。
        `key={task.id}`：这一格有本地状态（在途 / 失败句 / 待确认的那一条），
        ↑↓ 换选中时不换 key 会把上一条的失败句带过来 —— 与备注 / 截止 / 子任务同一格纪律。
        四个 `attachment*` 的接线全在这个组件里（动作集、上传通道、确认档），
        宿主（`App.tsx`）一个字都不用知道 —— 与 `ReminderField` 同一条边界。
      */}
      <AttachmentField key={`attachments-${task.id}`} task={task} />

      {/*
        ══ 协作区：评论（W4）═══════════════════════════════════════════
        🔴 它**刻意不是第五个「分组」**：`task-detail-group` 那四枚（基本 / 时间 / 组织 /
        自动化）是被审计 §4.6 钉死的**任务属性**分组，而评论不是任务属性 ——
        它是协作线索（只存在于共享清单）。按产品定义推导：属性分组之下另起一块区域，
        标题视觉上同款（同一枚 `groupHeaderStyle`）但**不冒充分组**（不挂那个 testid）。
        `tests/task-detail-groups.spec.tsx` 数的正是 `task-detail-group`，它继续钉那四枚。
        是否给协作单独立「区」的口径写回台账，等审计更新时一并收。
      */}
      <h3 style={groupHeaderStyle} data-testid="task-detail-collaboration">
        {t('common.entity.COMMENT')}
      </h3>
      <div data-testid="task-detail-comments">
        <ShareCommentsSection taskId={task.id} />
      </div>

      {/*
        ══ 底部工具条（C2，滴答对齐 2026-11）═══════════════════════════════
        一行快捷入口：收集箱（移动清单）、文本格式（备注富文本）、更多。
        与滴答的详情面底部工具条同形 —— 把高频操作从分组里提到随手可点的位置。
        🔴 三个按钮都是**快捷入口**，不是第二份编辑器：点击后聚焦到对应分组/字段，
        真正的编辑仍在上面那四组里。
      */}
      {/*
        底部工具条（C2，滴答对齐）。滴答那一排是「移动到 / 富文本 / 更多」。
        这里画**三枚**，每枚做的都是它标签说的那件事：

          · 「移动到」→ 把「组织」分组里那个清单下拉滚到眼前并聚焦（`organize-project-select`
            就是改归属的那个控件，`onMoveToProject` 走 store → op-log）。
          · 「备注」→ 聚焦备注框（`task-note-input`）。
          · 「更多」→ 打开这一条的任务操作菜单（置顶 / 优先级 / 标签 / 移动到 / 删除）。

        🔴 **「文本格式」没有画，这是裁决不是漏掉**：富文本是本计划 C1（选型 + 许可证门禁
        都还没过），现在这块只是纯文本框 —— 画一枚格式按钮等于给用户一个按下去什么都不变
        的控件。等 C1 落地再补第三枚的位置（那一枚才是它）。
        ⚠️ 前两枚是**导航**（滚过去 + 交还焦点），不是第二次写入入口 —— 字段本身仍只有一处
        可改，`check:row-single-source` 与详情列那套单源纪律管的是后者；第三枚也不写任何东西，
        它只是把动作区的锚点交给宿主，动作本体还是 `TaskRowMenu` 那一份。
      */}
      <div className="ht-detail-toolbar" data-testid="task-detail-toolbar">
        <button
          type="button"
          className="ht-detail-toolbar__btn"
          aria-label={t('web.rowMenu.moveTo')}
          data-testid="task-detail-goto-list"
          onClick={() => {
            focusInPane('organize-project-select');
          }}
        >
          <FolderOpen size={ICON_SIZE.sm} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="ht-detail-toolbar__btn"
          aria-label={t('web.note.toggle')}
          data-testid="task-detail-goto-note"
          onClick={() => {
            focusInPane('task-note-input');
          }}
        >
          <Type size={ICON_SIZE.sm} aria-hidden="true" />
        </button>
        {onShowActions ? (
          <button
            type="button"
            className="ht-detail-toolbar__btn"
            aria-label={t('web.rowMenu.label', { title: task.title })}
            data-testid="task-detail-more"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              onShowActions(task.id, { x: rect.left, y: rect.bottom });
            }}
          >
            <MoreHorizontal size={ICON_SIZE.sm} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
