/**
 * 便签板的文案接线（移动壳）
 * ============================
 *
 * 结构在 `@heyta/ui`（`NotesBoard` + `notes/model.ts`），这里只剩
 * "把语义结果映射到本端词条"这一层 —— 所以它是 `NotesBoardLabels` 的构造器，
 * 字段与共享层一一对应（少给一个**编译期**就报）。
 *
 * ⚠️ 本文件**不 import 任何 `@heyta/ui` 的"值"**，只 import 它的类型 ——
 * 与 `lib/habits-display.ts` / `lib/reminders-display.ts` 同一个理由：
 * 移动端单测跑在 vitest / node 里，而 `@heyta/ui` 的 `dist` 顶层 import
 * `react-native`，值导入会让整个 spec 文件转译失败。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ 便签（这里）与任务上的「备注」是两件事
 *
 * `Task.note` 是任务正文，在 `TaskDetailSheet` 里编辑；便签是一条**独立的记录**
 * （可不挂清单、可钉到「今天」）。文案刻意不叫「备注」，否则用户会以为
 * 它就是任务里那个 —— 词条表在 `packages/i18n` 的 `notes.*` 里，
 * 且文件头已经写明这条区分。
 *
 * ⚠️ `a11yEdit` 只在宿主传了 `onEdit` 时才会渲染（共享组件据此决定摘要那段
 * 是否可点）。移动端**没有便签编辑屏**，所以 `NotesSection` 不传 `onEdit` ——
 * 这条文案因此不会出现在界面上，但仍是 `NotesBoardLabels` 的必填字段，
 * 照实给全，等以后加了编辑入口不至于缺一句无障碍名。
 */

import type { NotesBoardLabels } from '@heyta/ui';

import type { Translate } from '../i18n/translate';

/** 构造 `NotesBoard` 需要的整份文案。每一项都走真的词条表（缺 key 会抛）。 */
export function notesBoardLabels(t: Translate): NotesBoardLabels {
  return {
    empty: t('notes.empty'),
    emptyHint: t('notes.empty.hint'),
    composerPlaceholder: t('notes.composer.placeholder'),
    add: t('notes.add'),
    // 🔴 提交失败那句（W8b）：共享层挂在 composer 下方（alert 语义）。
    // 必填字段 —— 漏了编译期就红（陷阱 #195：可选 prop 会把"宿主没接线"
    // 伪装成"做完了"；契约测试见 tests/reminders-notes-display.spec.ts）。
    saveFailed: t('notes.error.saveFailed'),
    // 「钉选」与「取消钉选」是**两条不同的词条**，不是前缀拼接：
    // 共享组件用 `row.isPinned` 二选一，这里照给，不许自己 `'取消' + labels.pin`。
    pin: t('notes.pin'),
    unpin: t('notes.unpin'),
    remove: t('notes.remove'),
    badgeToday: t('notes.badge.today'),
    // 四类无障碍名都带 `{excerpt}` 占位符。⚠️ 变量名必须与词条里的占位符
    // **逐字相同**：`translate()` 对认不出的占位符会原样保留，
    // 拼错不会报错，只会把 `{excerpt}` 念给读屏用户听。
    a11yEdit: (excerpt) => t('notes.a11y.edit', { excerpt }),
    a11yRemove: (excerpt) => t('notes.a11y.remove', { excerpt }),
    a11yPin: (excerpt) => t('notes.a11y.pin', { excerpt }),
    a11yUnpin: (excerpt) => t('notes.a11y.unpin', { excerpt }),
  };
}
