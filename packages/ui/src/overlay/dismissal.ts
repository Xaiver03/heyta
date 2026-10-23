/**
 * 浮层的关闭策略（共享模型，宿主无关）
 * ===================================
 *
 * 「怎么关掉」是浮层最容易做错、也最容易在代码里零约定地放过去的一格。
 * 本仓实测：17 个自绘 `aria-modal` 层里，库式关闭开关 **0 处**，
 * 自写 Esc 监听 25 处，统一装置 `useModalDismiss` 只有 1 个消费者
 * （读数与探针见 `docs/reference/overlay-feedback-adaptation.md` §1）。
 *
 * 通用矩阵住在全局 Skill `overlay-feedback-patterns`
 * （`references/dismissal-and-timing.md` §1），本文件是它在代码里的**唯一一份实现**：
 * 按浮层的类别查一张表，而不是每个页面自己决定点背景算不算关。
 *
 * ## 🔴 类型本身就是第一条不变量
 *
 * `DismissOutcome` 的四个取值里**没有**「触发确认」「保存」「提交」「扣款」。
 * 也就是说「Esc 被绑到主按钮」这类缺陷在本模型里**写不出来** ——
 * 想写就得先在类型里加一个非法取值，那会被这道门的契约测试抓到
 * （`packages/ui/tests/overlay-dismissal-model.spec.ts`）。
 *
 * 剩下两条不变量由用例钉：危险确认与强制阅读不许响应背景；
 * 这个模型覆盖的每一类都**不许自动消失**（它们全是第 3–5 级）。
 */

/**
 * 一个关闭通道的结果。
 *
 * · `dismiss` —— 关闭并丢弃当前内容。只有「无未保存内容」或「丢弃无代价」才用它。
 * · `cancel` —— 等价于「取消 / 不执行」。危险确认里这就是安全侧。
 * · `ask-discard` —— 先问「放弃修改？」，由宿主决定问法与后续。
 * · `deny` —— 这个通道不存在（按了没反应才是正确行为）。
 */
export type DismissOutcome = 'dismiss' | 'cancel' | 'ask-discard' | 'deny';

/**
 * 本模型覆盖的浮层类别：第 3–5 级（会占住一块区域或整页的那些）。
 *
 * 🔴 不含 Tooltip / Hover Card：它们的"关闭"由指针位置决定，不是由
 * scrim·Esc·返回键决定，放进这张表只会造出四个假取值。
 * 也不含 Toast / Snackbar：它们是自消层，规则在时长那一条上。
 */
export type ClosedOverlay =
  | 'popover'
  | 'menu'
  | 'modal-readonly'
  | 'modal-dirty-form'
  | 'modal-forced-read'
  | 'danger-confirm'
  | 'popconfirm'
  | 'drawer'
  | 'bottom-sheet'
  | 'full-screen'
  | 'command';

/** 一层的关闭契约。三个通道 + 两条自身属性。 */
export interface ClosePolicy {
  /** 点背景（scrim）。 */
  readonly scrim: DismissOutcome;
  /** 键盘 Esc。 */
  readonly escape: DismissOutcome;
  /** 系统返回键 / 侧滑手势（移动与套壳）。 */
  readonly systemBack: DismissOutcome;
  /** 自动消失。本模型覆盖的每一类都必须是 `false`。 */
  readonly autoDismiss: false;
  /** 右上角的显式关闭按钮（×）。危险确认与 popconfirm 不给，出口必须是具名动作。 */
  readonly explicitCloseButton: boolean;
}

/**
 * 表的枚举顺序 = `ClosedOverlay` 的成员顺序。
 *
 * 🔴 用例遍历这一整份数组断言每条不变量：**加一个类别而忘了给它定策略，
 * 测试会红**。少了这个数组，加类别就会静默吃到 `undefined`。
 */
export const CLOSED_OVERLAYS = [
  'popover',
  'menu',
  'modal-readonly',
  'modal-dirty-form',
  'modal-forced-read',
  'danger-confirm',
  'popconfirm',
  'drawer',
  'bottom-sheet',
  'full-screen',
  'command',
] as const satisfies readonly ClosedOverlay[];

const POLICY_BY_CLASS: Record<ClosedOverlay, ClosePolicy> = {
  // 锚定的轻量层：不阻塞外部，点哪儿都能收走。
  popover: {
    scrim: 'dismiss',
    escape: 'dismiss',
    systemBack: 'dismiss',
    autoDismiss: false,
    explicitCloseButton: false,
  },
  menu: {
    scrim: 'dismiss',
    escape: 'dismiss',
    systemBack: 'dismiss',
    autoDismiss: false,
    explicitCloseButton: false,
  },

  // 只读模态：丢弃无代价 ⇒ 背景与 Esc 都是出口。
  'modal-readonly': {
    scrim: 'dismiss',
    escape: 'dismiss',
    systemBack: 'dismiss',
    autoDismiss: false,
    explicitCloseButton: true,
  },

  // 有未保存内容：三条通道都得先问「放弃修改？」。
  'modal-dirty-form': {
    scrim: 'ask-discard',
    escape: 'ask-discard',
    systemBack: 'ask-discard',
    autoDismiss: false,
    explicitCloseButton: true,
  },

  // 强制阅读（协议、告知）：出口只有「同意 / 不同意」，任何"绕过"通道都关掉。
  'modal-forced-read': {
    scrim: 'deny',
    escape: 'deny',
    systemBack: 'deny',
    autoDismiss: false,
    explicitCloseButton: false,
  },

  // 危险确认：不给 ×、不响应背景；Esc 与返回键 = 取消（安全那一个动作）。
  'danger-confirm': {
    scrim: 'deny',
    escape: 'cancel',
    systemBack: 'cancel',
    autoDismiss: false,
    explicitCloseButton: false,
  },

  // 就地确认：所有通道都落在取消那一边，而不是"关闭 = 已删除"。
  popconfirm: {
    scrim: 'cancel',
    escape: 'cancel',
    systemBack: 'cancel',
    autoDismiss: false,
    explicitCloseButton: false,
  },

  drawer: {
    scrim: 'dismiss',
    escape: 'dismiss',
    systemBack: 'dismiss',
    autoDismiss: false,
    explicitCloseButton: true,
  },

  /**
   * 底部面板：出口是把手 / 下滑 / 背景 / ×，**不是 Esc** ——
   * 矩阵里这一格是「不适用」，这里落成 `deny`：桌面键盘用户按 Esc 不该有反应，
   * 因为它的关闭语言是手势。把 Esc 加进来会让用户以为它跟模态是同一类东西。
   */
  'bottom-sheet': {
    scrim: 'dismiss',
    escape: 'deny',
    systemBack: 'dismiss',
    autoDismiss: false,
    explicitCloseButton: true,
  },

  // 全屏浮层：没有"背景"可点（它自己就是整页）。
  'full-screen': {
    scrim: 'deny',
    escape: 'dismiss',
    systemBack: 'dismiss',
    autoDismiss: false,
    explicitCloseButton: true,
  },

  // 命令面板：Esc 必须直退，否则键盘用户被关在一个出不去的层里。
  command: {
    scrim: 'dismiss',
    escape: 'dismiss',
    systemBack: 'dismiss',
    autoDismiss: false,
    explicitCloseButton: false,
  },
};

/** 查这一类的关闭契约。 */
export function closePolicyOf(overlay: ClosedOverlay): ClosePolicy {
  return POLICY_BY_CLASS[overlay];
}

/** 一条通道问过来时的三种可能动作。 */
export type DismissAction = 'close' | 'ask' | 'none';

/**
 * 「用户刚刚按了哪儿，我该做什么」—— 三个通道问同一句。
 *
 * · `close` —— 直接走取消/关闭出口（`dismiss` 与 `cancel` 在**动作**上是同一件事：
 *   都不执行、都丢弃；差别只在读法上，`cancel` 那一格是危险确认的"安全侧"）。
 * · `ask` —— 先问「放弃修改？」，问法归宿主（共享层不 import i18n）。
 * · `none` —— **这条通道不存在**：既不关也不问。
 *
 * 🔴 组件里不许再出现 `policy.scrim === 'deny'` 这种内联比较：
 * 判据问两次就有两种问法，第二种通常是错的（本仓的"两份画法 = 两套裁决标准"）。
 */
export function dismissActionFor(policy: ClosePolicy, outcome: DismissOutcome): DismissAction {
  if (outcome === 'deny') return 'none';
  return outcome === 'ask-discard' ? 'ask' : 'close';
}

/**
 * 这一类该不该有右上角的 ×。
 *
 * 危险确认与 popconfirm 不给：出口必须是**具名动作**（「永久删除 12 条」/「取消」），
 * 一个灰色的 × 把"这是什么决定"又推回给用户去猜。
 */
export function hasExplicitClose(policy: ClosePolicy): boolean {
  return policy.explicitCloseButton;
}
