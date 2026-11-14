/**
 * 任务列表的空状态 + "当前筛选"判定（Web 端）。从 `App.tsx` 抽出，逻辑逐字未动。
 *
 * 规则：**任何列表都必须有空状态**，且要给出下一步动作。留白屏会让用户以为应用坏了。
 */

import React from 'react';
import { HeytaUiProvider, StateIllustration, toEmptyStateViewModel } from '@heyta/ui';
import { useI18n, type MessageKey } from '@heyta/i18n';
import type { TaskFilter } from '../tasks/store.js';

/**
 * 空状态。
 *
 * 规则：**任何列表都必须有空状态**，且要给出下一步动作。
 * 留白屏会让用户以为应用坏了。
 */
/**
 * 首启引导的三条示例（**顺序就是展示顺序**）。
 *
 * 🔴 写成 `as const` 的字面量数组，不用模板拼 `web.firstRun.example${i}`：
 * `MessageKey` 是字面量联合，拼出来的字符串 TS 认不出，会退化成 `string`
 * 而让 `t()` 的约束失效 —— 那正是"改词条名而没人发现"的入口。
 * 三条都在 `@heyta/domain#parseCapture` 的规则表里能真解析出日期
 * （2026-11-14 实测：`明天下午3点` ⇒ 15:00、`下周三` ⇒ 11-18、`今天` ⇒ 当天）。
 */
const FIRST_RUN_EXAMPLES = [
  'web.firstRun.example1',
  'web.firstRun.example2',
  'web.firstRun.example3',
] as const;

export function EmptyState({
  filter,
  firstRun,
}: {
  filter: TaskFilter;
  /**
   * 首启引导（只在「收集箱为空 + 没看过」时由宿主给 true）。
   *
   * 给了它，空态就用引导自己的标题/说明**替换**默认那两句，而不是再叠两行 ——
   * 一屏两层标题（「收集箱是空的」+「把脑子里的事先倒出来」）是同一件事说两遍。
   */
  firstRun?: {
    readonly onFillDraft: (text: string) => void;
    readonly onDismiss: () => void;
  };
}): React.JSX.Element {
  const { t } = useI18n();
  /**
   * 空态文案。
   *
   * ⚠️ 存的是**键对**（标题 + 下一步动作），不是句子 —— 句子在词条表里，
   * 渲染时才 `t(...)`。`all` 同时是兜底：出现新的 `filter.kind` 时
   * 不能留一片空白（"任何列表都必须有空状态"，见文件尾注释）。
   */
  const messages: Record<string, { titleKey: MessageKey; hintKey: MessageKey }> = {
    all: {
      titleKey: 'web.shell.empty.all.title',
      hintKey: 'web.shell.empty.all.hint',
    },
    today: {
      titleKey: 'web.shell.empty.today.title',
      hintKey: 'web.shell.empty.today.hint',
    },
    // 不写"今天没有到期"也不写"收集箱是空的"：这一列空下来的意思是
    // **未来 7 天没有安排**，而那个"下一步"是把截止时间放进这几天里。
    next7Days: {
      titleKey: 'web.shell.empty.next7Days.title',
      hintKey: 'web.shell.empty.next7Days.hint',
    },
    completed: {
      titleKey: 'web.shell.empty.completed.title',
      hintKey: 'web.shell.empty.completed.hint',
    },
    quadrant: {
      titleKey: 'web.shell.empty.quadrant.title',
      hintKey: 'web.shell.empty.quadrant.hint',
    },
  };
  const msg = messages[filter.kind] ?? messages['all']!;

  /**
   * 🔴 **判断走共享模型，markup 归本端**（R11 的 (B) 方案）。
   *
   * 原来这里没有"判断"可复用：`t(key)` 拿到什么就画什么。共享层
   * `packages/ui/src/empty-state/model.ts` 的 `toEmptyStateViewModel` 才是
   * 那份**唯一**的判断（空串归一成省略、档位决定要不要图形、`title` 必填），
   * 而"把结果摆成 `<div class="ht-empty">` 三件套"是本端渲染器的事。
   *
   * 这与 `ux-principles.md` §1 立过的范式同形：**判断只有一份，渲染器有两个**
   * （`packages/ui/src/form/anatomy.ts` 与各端 `FormField` / `kit.TextField`）。
   *
   * ⚠️ 为什么不直接把 `packages/ui` 的 `EmptyState` 组件挂进来：那会换掉整棵 DOM
   * （`<div class="ht-empty">` → `section[role=region]` + RNW 原子类、`<p>` →
   * `<div dir=auto>`、标题字重 500→600、提示 14→12、插画 testID 换名）。
   * 2026-11 实测 6 条差异，逐条记在 `docs/plans/r11-states-audit-2026-11.md` §7.1。
   * 用 6 条视觉回归换一个"组件同一个"的符号统一不划算 —— 判断我们已经拿全了。
   *
   * ⚠️ `size` 只能是 `page`：它是唯一**允许**图形的档，而这一屏现状就画
   * `StateIllustration variant="tasks"`。改成 `card`/`section`/`line` 会让
   * `view.illustration` 变成 `undefined` ⇒ 插画那一段消失 ⇒ DOM 变
   * （这条正是 `apps/web/tests/shell-empty-state-dom.spec.tsx` 的反向臂）。
   */
  const view = toEmptyStateViewModel({
    title: t(firstRun === undefined ? msg.titleKey : 'web.firstRun.title'),
    hint: t(firstRun === undefined ? msg.hintKey : 'web.firstRun.hint'),
    illustration: 'tasks',
    size: 'page',
  });

  return (
    <div className="ht-empty" data-testid="empty-state">
      {/* 条件包在 Provider **外面**：`HeytaUiProvider` 只挂 context、不产 DOM
          （`theme.tsx:308-310` 三个 Provider 直接返回 children），
          但"没有插画"时连这一层都不该出现（少一层就少一次 theme 解析）。 */}
      {view.illustration === undefined ? null : (
        <HeytaUiProvider>
          {/* 🔴 用 `view.illustration`，不把 `'tasks'` 再写一遍：写死的那版会让
              "模型给的是 habits、界面还画 tasks"成为一种**不会报错**的漂移 ——
              正是本仓反复罚的"参数传了却被静默丢弃"。 */}
          <StateIllustration variant={view.illustration} />
        </HeytaUiProvider>
      )}
      {/* 排版四件套整条来自语义档（2026-11-09，见 ai-panels.css 的 `ht-settings__hint` 那条注释）。 */}
      <p className="ht-empty__title ht-type-row-title">{view.title}</p>
      {/* `hint` 可省略 —— 模型把空串/纯空白归一成 `undefined`，那一行就不画。 */}
      {view.hint === undefined ? null : <p className="ht-empty__hint">{view.hint}</p>}
      {/*
        首启引导：三条示例 + 一个出口。
        🔴 它们**不是"建任务"的按钮** —— 点一条只把字灌进输入框（`onFillDraft`），
        用户还要看着识别芯片按回车。`parseCapture` 的文件头第 2 条要求
        "调用方必须把 matches 展示给用户确认"，直接落库会把误报变成静默改写。
      */}
      {firstRun === undefined ? null : (
        <div className="ht-firstrun" data-testid="first-run">
          <div className="ht-firstrun__examples">
            {FIRST_RUN_EXAMPLES.map((key) => (
              <button
                key={key}
                type="button"
                className="ht-btn ht-btn--secondary ht-firstrun__example"
                data-testid={`first-run-example-${key.slice(-1)}`}
                onClick={() => { firstRun.onFillDraft(t(key)); }}
              >
                {t(key)}
              </button>
            ))}
          </div>
          {/*
            「先自己写」而不是「跳过」：这是**选择**，不是拒绝。
            它是 `inline` 重量的 ghost 按钮 —— 空态里已有三条示例是主路径，
            出口不该和它们抢注意力（`ux-principles` §1：同屏一个主任务）。
          */}
          <button
            type="button"
            className="ht-btn ht-btn--ghost ht-firstrun__skip"
            data-testid="first-run-dismiss"
            onClick={firstRun.onDismiss}
          >
            {t('web.firstRun.skip')}
          </button>
        </div>
      )}
    </div>
  );
}

export function isActive(current: TaskFilter, target: TaskFilter): boolean {
  if (current.kind !== target.kind) return false;
  /**
   * 🔴 **判别联合的每个带载荷分支都要比载荷，不能只比 `kind`。**
   *
   * 原先只特判了 `quadrant`，其余一律返回 `true` —— 于是**两个不同的清单
   * 会同时显示为当前项**（`kind` 都是 `'project'`），而标签分支加进来之后
   * 同一个问题会扩大到标签。症状是侧栏同时高亮两行，用户以为选中了错的那个。
   *
   * 写成 `switch` 而不是一串 `if`：加分支时 `never` 兜底会在**编译期**
   * 提醒这里还没处理 —— 这正是判别联合相对宽形状的价值。
   */
  switch (current.kind) {
    case 'quadrant':
      return target.kind === 'quadrant' && current.quadrant === target.quadrant;
    case 'project':
      return target.kind === 'project' && current.projectId === target.projectId;
    case 'tag':
      return target.kind === 'tag' && current.tagId === target.tagId;
    case 'all':
    case 'today':
    case 'tomorrow':
    case 'next7Days':
    case 'completed':
      return true;
  }
}
