/**
 * 搜索面板的文案接线（移动壳）
 * ============================
 *
 * 结构在 `@heyta/ui`（`SearchPanel`），这里只剩"把语义结果映射到本端词条"。
 *
 * ⚠️ 本文件**不 import 任何 `@heyta/ui` 的"值"**，只 import 它的类型 ——
 * 与 `lib/notes-display.ts` / `lib/habits-display.ts` 同一个理由：
 * 移动端单测跑在 vitest / node 里，而 `@heyta/ui` 的 `dist` 顶层 import
 * `react-native`，值导入会让整个 spec 文件转译失败。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 面板的文案**大部分仍走 `web.search.*`**，这不是偷懒也不是漂移
 *
 * 那是同一块界面（同一个共享组件）在第二个宿主上，词条跟着界面走、不跟着
 * 目录走 —— 抄一份 `mobile.search.*` 出来，下一次改文案就会只改一边。
 *
 * 只有 `noResults` 换成了移动端那条，理由不是命名而是**假话**：
 * web 那句是「没有找到匹配的任务、便签或**入口**」，而移动端没有
 * 「快速跳转」那一组（手机上没有可跳转的侧栏目的地）。沿用那句等于
 * 对着用户许诺一个在这里根本不可能出现的行。
 *
 * 🔴 也**不传 `keyHints`**：↑↓ / ↵ / esc 是三件手机上没有的东西。
 * 共享面板对没传的形态直接不渲染那排芯片 —— 传了才是谎报能力。
 */

import type { SearchPanelLabels } from '@heyta/ui';

import type { Translate } from '../i18n/translate';

/**
 * 构造 `SearchPanel` 需要的整份文案。
 *
 * `taskRow` 由宿主把它**已经在用的**那份行级文案原样递进来 ——
 * 搜索结果里的任务行和列表里的任务行是同一种东西，
 * 读屏名不该因为"这次是搜出来的"而变成另一句话。
 */
export function searchPanelLabels(t: Translate, taskRow: SearchPanelLabels['taskRow']): SearchPanelLabels {
  return {
    title: t('web.search.title'),
    placeholder: t('web.search.placeholder'),
    prompt: t('web.search.prompt'),
    noResults: t('mobile.search.noResults'),
    tasksSection: t('web.search.tasksSection'),
    notesSection: t('web.search.notesSection'),
    // 移动端目前给不出任何 quick 项，但这句是无障碍分组名 —— 少给一项
    // 是编译期错误，照实给全，将来加了跳转不必回来补文案。
    quickSection: t('web.search.quickSection'),
    count: (n: number) => t('web.search.count', { count: n }),
    taskRow,
  };
}
