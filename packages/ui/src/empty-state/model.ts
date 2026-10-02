/**
 * 空态共享模型（纯逻辑）
 * ========================
 *
 * `EmptyState.tsx` 只做"把这里的输出摆到 RN 原语上"这一层，**不带分支**。
 * 所有"不报错、只会画错"的判断都留在本文件里，因为本仓库的
 * `packages/ui` 测试跑在 **node** 环境（不引 DOM 测试栈，见
 * `vitest.config.ts` 文件头）—— 组件树渲染得对不对，判据是三个平台上的
 * 实际渲染，不是快照。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么"空字符串"必须在这里被归一成 `undefined`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 词条表里一个还没翻译的 key、一个后端没填的字段，给出来的都是 `''`。
 * 如果直接把它渲染出去：
 *
 *   · `hint = ''` → RN 的 `<Text>` 仍然占一行的高度（它有 `lineHeight`），
 *     于是空态中间多出一条**看不见但把标题往下挤**的空隙；
 *   · `icon = []` → `HeytaIcon` 画一个 `32×32` 的**空白方块**占位；
 *   · `detail = '   '` → 同 hint，而且 `selectable` 还会让用户可以选中一片空白。
 *
 * 这三件事**一个都不会报错**，只会让屏幕看起来"排版怪怪的"。所以归一化
 * 收在本文件里，用测试钉住。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么 `title` 为空要**抛错**，而不是跟着归一成空
 * ─────────────────────────────────────────────────────────────────────────
 *
 * hint / detail 缺失是**合法的形态**（§1.6 实测的滴答空态就是"居中一句
 * 没有任务"），所以它们可以没有。但 `title` 是空态的**全部意义**：
 * 没有它，用户看到的就是一片空白 —— 而"留白屏会让用户以为应用坏了"
 * 正是 `apps/web/src/App.tsx` 里 `EmptyState` 注释写下的那条规则。
 *
 * 所以这里**不静默降级**，与 `theme.tsx` 的 `useHeytaUiTheme` 同一个
 * 取舍：忘了包 Provider 的表现如果只是"暗色系统下渲染成亮色"，没人会
 * 发现。空白空态同理 —— 它必须**当场响**。
 */

import type { HeytaIconData } from '../icon/Icon.js';

/**
 * `detail` 槽位的语义色。
 *
 * 🔴 它**不是固定的**：默认 `danger`（错误详情，用户要复制去反馈），
 * 但"此功能尚未实现"这类**说明性**文字染成红色会读成"出错了" ——
 * 颜色在表达一个不存在的问题。这一条来自 mobile kit 的既有实现
 * （`apps/mobile/src/ui/kit.tsx` 的 `detailTone`），收编时原样保留。
 */
export type EmptyStateDetailTone = 'danger' | 'subtle';

/**
 * 空态**住在多大的地方**。
 *
 * 🔴 这一档不是"给样式表起个名字"，它解的是一个**二选一的死结**：
 * 本组件原来只有页面级一种形状（居中 + 上下 `space.16` + 可选大图标），
 * 而 `scripts/check-empty-state.mjs` 给的唯一修法是"用共享的 `EmptyState`"。
 * 于是"设置卡片里的一行占位"（`SecurityScreen` 的通行密钥区）与
 * "面板/区块没有内容"（web 的 `NotesBoard` / `ReminderList`）想收编成共享实现，
 * 就**必须**同时把视觉改成一大块居中的东西 —— 那是视觉回归，不是统一。
 * 结果就是：要么红着，要么把债写进 `EMPTY_SITES`（＝把债合法化）。
 *
 * `section` 档把"收编"与"不改视觉"这两件事解耦：左对齐、不占页面高度、
 * 不放图标（图标那条判断在 `toEmptyStateViewModel` 里，理由见那里）。
 *
 * ⚠️ 默认 `page` —— 现有站点一个像素都不变。
 */
export type EmptyStateSize = 'page' | 'section';

/**
 * 四个槽位。
 *
 * `icon` / `hint` / `detail` 都是可选的，只有 `title` 必填 —— 理由见文件头。
 * **文案一律由宿主注入**（本包不 import `@heyta/i18n`，那会拖进第二份 React，
 * 见 `TaskList.tsx` 与 `FocusPanel.tsx` 的文件头）。
 */
export interface EmptyStateSlots {
  /**
   * 图标**数据**（`lucide` 的框架无关 `IconNode`），由共享层的
   * `HeytaIcon` 渲染 —— 不传平台图标包，四个端画的是同一个字形。
   */
  readonly icon?: HeytaIconData | undefined;
  /** 空态的**全部意义**：一句话说清"这里为什么是空的"。必填且非空白。 */
  readonly title: string;
  /** 下一步能做什么。省略则**不渲染整行**（`''` 会被归一成省略）。 */
  readonly hint?: string | undefined;
  /** 补充说明。技术细节给错误用，step 说明给"还没做"用。 */
  readonly detail?: string | undefined;
  /** `detail` 的语义色。省略 = `danger`。 */
  readonly detailTone?: EmptyStateDetailTone | undefined;
  /** 这块空态有多大。省略 = `page`（现有站点的形状，一个像素都不变）。 */
  readonly size?: EmptyStateSize | undefined;
}

/** `EmptyState.tsx` 要摆到屏幕上的全部内容。没有分支可判 —— 判断都在这里做完了。 */
export interface EmptyStateViewModel {
  readonly icon: HeytaIconData | undefined;
  readonly title: string;
  readonly hint: string | undefined;
  readonly detail: string | undefined;
  readonly detailTone: EmptyStateDetailTone;
  /**
   * `detail` 的无障碍 role。
   *
   * 🔴 只有 `danger` 才给 `alert`，而且只有 `detail` 真的存在时才给。
   * 说明性文字（`subtle`）声明成 `alert` 会让读屏在**没错的时候**报错，
   * 与"颜色在表达一个不存在的问题"是同一个错误，只是换了个通道。
   * 这一条与 `FocusPanel` 里"落盘失败必须看得见"用的是同一个 role。
   */
  readonly detailRole: 'alert' | undefined;
  /**
   * 归一后的尺寸档（省略 = `page`）。组件只按它挑样式，不再自己判断。
   */
  readonly size: EmptyStateSize;
  /**
   * 根节点的无障碍 role。
   *
   * 🔴 空态不是列表项、不是按钮、也不是标题 —— 它是"这一块没有内容，
   * 以及接下来做什么"的**整体陈述**。所以给 `summary`：
   *   · Android / iOS 上读屏把它作为一段整体摘要，而不是三次孤立朗读；
   *   · web（`react-native-web`）上它映射成 `role="region"`（实测
   *     `propsToAriaRole.js` 的 `summary: 'region'`），无名字的 region
   *     不会成为 landmark，因此**不会**改变 web 上的地标导航 ——
   *     这正是我们要的：共享层不替宿主决定要不要把它挂成一个地标。
   *
   * ⚠️ 刻意**不**设 `accessible={true}`：那会在 iOS 上把子树折叠成一次
   * 朗读并吞掉 `hint` / `detail` 的独立可读性，是**退步**，不是无障碍。
   */
  readonly a11yRole: 'summary';
}

/**
 * 空白（含纯空白）一律归一成 `undefined`。
 *
 * 导出它是因为归一的**理由**（见文件头）值得被测试直接钉住，而不是只
 * 在 `toEmptyStateViewModel` 的间接断言里体现。
 */
export function nonBlank(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.trim() === '' ? undefined : value;
}

/**
 * 槽位 → 视图模型。**这是本组件唯一的判断点。**
 *
 * @throws 当 `title` 缺失或纯空白 —— 见文件头"为什么 title 为空要抛错"。
 */
export function toEmptyStateViewModel(slots: EmptyStateSlots): EmptyStateViewModel {
  const title = nonBlank(slots.title);
  if (title === undefined) {
    throw new Error(
      'EmptyState 的 `title` 不能为空或纯空白：空态的**全部意义**就是那一句话，' +
        '没有它用户看到的是一片空白 —— 而"留白屏会让用户以为应用坏了"。' +
        '确实没有文案时，应当先把词条补上，而不是渲染一个空标题。',
    );
  }

  // 空数据数组 = 没有图标。渲染它只会得到一个空白的 Svg 方块（见文件头）。
  const icon =
    slots.icon !== undefined && slots.icon.length > 0 ? slots.icon : undefined;

  const size: EmptyStateSize = slots.size ?? 'page';

  // 🔴 `section` 档**不放图标**，这条判断做在这里而不是组件里写 `if`：
  //    区块级空态住在卡片内部，卡片自己已经有一行标题；再摆一个 `icon.xl`(32)
  //    的字形会和区块标题争视觉重心 —— 而调用方传了 `icon` 却什么都没画，
  //    是最难归因的那类"参数被静默丢弃"。所以这里把它明确成 `undefined`，
  //    组件只负责"有图标就画、没有就不画"。
  const visibleIcon = size === 'section' ? undefined : icon;

  const hint = nonBlank(slots.hint);
  const detail = nonBlank(slots.detail);
  const detailTone = slots.detailTone ?? 'danger';

  return {
    icon: visibleIcon,
    title,
    hint,
    detail,
    detailTone,
    size,
    // `detail` 不存在时 role 必须是 undefined —— 否则会在一个不渲染的节点上
    // 声明 alert（tone 的默认值不该"借"到这个不存在的节点上）。
    detailRole: detail !== undefined && detailTone === 'danger' ? 'alert' : undefined,
    a11yRole: 'summary',
  };
}
