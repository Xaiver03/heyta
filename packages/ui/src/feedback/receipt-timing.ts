/**
 * 自消回执的时长与暂停（共享模型，宿主无关）
 * ==========================================
 *
 * `dismissal.ts` 管的是第 3–5 级浮层"能不能关"，那份模型里**没有**自动消失
 * （它自己的文件头就写了：Toast / Snackbar 不在里面，"规则在时长那一条上"）。
 * 本文件就是那条"时长"在本仓唯一一份可被调用的实现 —— 判据正文在全局 Skill
 * `overlay-feedback-patterns` → `references/dismissal-and-timing.md` §2
 * 与 `references/destructive-actions.md` §2/§3.8。
 *
 * ## 🔴 为什么必须有这张表，而不是各页 `setTimeout(…, 5000)`
 *
 * 立项时的现量（三条自写的撤销回执，全在表之外）：
 *   · `apps/web/src/App.tsx:523` 批量删除回执 —— 5000ms，**没有** hover/focus 暂停；
 *   · `apps/web/src/features/quadrant/QuadrantBoard.tsx:223` 象限移动回执 —— 同上，
 *     且把**撤销失败**写进 `role="status"`（会飘走的那一档）；
 *   · `apps/mobile/src/screens/TasksScreen.tsx:731,739` —— 同形状的第三个与第四个 5000ms。
 * ⇒ 5 秒读一句"撤销删除 3 个任务"、再在那条里找到按钮并按中，是不成立的承诺；
 * 而"手上有计时器"和"手上有策略"的差别，就是**没有任何测试会因为它太短而红**。
 *
 * ## 两条 Skill 通则在这里怎么让位
 *
 * §4.2 同时写着"带任何动作按钮 → 不自消或 ≥10s"与"Snackbar 带撤销：≥7s，
 * 撤销动作在计时结束前一直可点"。这里取**后者**（它是专例），并把"一直可点"
 * 落到 `pauseOnHover` / `pauseOnFocus` 两枚布尔上：窗口可以走完，但**用户已经
 * 把手放到那枚按钮上时不许走**。取 8000ms 而不是 7000ms：下限是承诺，
 * 不是要贴着的靶。
 *
 * 🔴 `failureStaysVisible` 对所有类别恒真，不是给某一类开的口子：Skill §8 第二条
 * 点名的病灶就是"失败只弹一条 5 秒 toast，用户抬头时错误没了、表单还在"。
 * 撤销失败的后果是"用户以为已经撤销成功"，所以它**必须**留在屏幕上，
 * 由宿主渲染成不自消的 `role="alert"`（`apps/web/src/lib/feedback/UndoReceipt.tsx` 里
 * 那一格是把这一层自己切成 alert 语义并**清掉计时器**）。
 *
 * ⚠️ 为什么这些数住在 TypeScript 而不是 `tokens.css`：变量驱动的是**计时器**，
 * 不是过渡。CSS 变量要拿到 JS 里用就得 `getComputedStyle` 绕一圈 DOM，
 * 而那张表就成了"读了界面才知道策略"的第二份裁决 —— 反过来（住 TS、
 * 过渡动效照它的值写 `--ht-*`）才是这份表该有的方向。
 */

/** 会自己消失的反馈类别。加一类就得在本文件配一条策略，否则契约测试红。 */
export type ReceiptKind = 'undo' | 'notice';

/**
 * 撤销回执的**窗口下限**（毫秒）。
 *
 * 🔴 它是判据，不是读数：任何一类带动作的回执查出来的 `durationMs` 都不得小于它。
 * 摘掉这一枚常量而把数字各页手写，等于回到立项前那四个 5000。
 */
export const UNDO_RECEIPT_MIN_MS = 7000;

export interface ReceiptTiming {
  /** 从"动作真的做完了"那一刻起算的可见窗口（毫秒）。 */
  readonly durationMs: number;
  /** 指针停在回执上时暂停计时（离开后继续走完剩余窗口，不重置）。 */
  readonly pauseOnHover: boolean;
  /** 键盘焦点落在回执里任意控件时暂停计时（同上，不重置）。 */
  readonly pauseOnFocus: boolean;
  /** 窗口走完是否自然消失。`undo` 取真：常驻的撤销条会变成界面上的第二块东西。 */
  readonly autoDismiss: boolean;
  /**
   * 这一类是否承载动作按钮。
   *
   * 🔴 `notice` 必须为假 —— 一带动作它就变成了撤销承诺，而它的下限只有 4000ms。
   * 这条不变量由契约测试遍历整份清单来钉，不靠注释。
   */
  readonly carriesAction: boolean;
  /** 这一类的**失败**是否留在屏幕上（恒真；见文件头 §8 第二条）。 */
  readonly failureStaysVisible: boolean;
}

/** 定义域清单：契约用例遍历它，漏配策略就红。 */
export const AUTO_DISMISS_RECEIPTS: readonly ReceiptKind[] = ['undo', 'notice'];

const RECEIPT_TIMING: Readonly<Record<ReceiptKind, ReceiptTiming>> = {
  undo: {
    durationMs: 8000,
    pauseOnHover: true,
    pauseOnFocus: true,
    autoDismiss: true,
    carriesAction: true,
    failureStaysVisible: true,
  },
  notice: {
    durationMs: 4000,
    pauseOnHover: true,
    pauseOnFocus: true,
    autoDismiss: true,
    carriesAction: false,
    failureStaysVisible: true,
  },
};

/**
 * 查一类回执的时长策略。
 *
 * 清单外的类别返回 `undefined` —— 这张表的键就是它的定义域。宿主拿到 `undefined`
 * 时**不许**兜一个默认时长：那等于在表外新建一份裁决，而它永远不会红。
 */
export function receiptTimingOf(kind: ReceiptKind): ReceiptTiming | undefined {
  return Object.prototype.hasOwnProperty.call(RECEIPT_TIMING, kind)
    ? RECEIPT_TIMING[kind]
    : undefined;
}
