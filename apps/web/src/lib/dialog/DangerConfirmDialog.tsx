import { useRef, type ReactNode } from 'react';

import { WebModalShell } from './WebModalShell.js';

/**
 * 危险确认（Web 侧，2026-10-27 全局 UX 整改 P2）
 * ============================================
 *
 * **这一枚组件只拥有三件事**，其余都归宿主或归表：
 *
 * 1. 三条关闭通道**问同一张表**（`packages/ui/src/overlay/dismissal.ts` 的 `danger-confirm`），
 *    不在这里内联比较 `scrim === 'deny'`（那条禁令写在该文件里）；
 * 2. 焦点那一套（初始焦点给**安全侧**、Tab 不外逃、关掉归还触发者）—— 见 `useModalFocusIsolation`；
 * 3. 出口是**两个具名动作**，没有 ×（表里 `explicitCloseButton: false`）。
 *
 * 布局、宽度、显隐、文案与"点确认之后做什么"全在宿主 —— 宿主外壳不许有业务判断，
 * 反过来这一枚也不许知道"这是删任务还是撤设备"。
 *
 * ## 🔴 为什么 Web 侧要自己画一枚，而不是用共享 `DangerDialog`
 *
 * 共享那枚的外壳是 react-native-web 的 `Modal`，而它在 Web 真实浏览器里**那一层根本不挂载**
 * —— 零 console、零 pageerror，同一棵树上 jsdom 契约测试全绿。逐条读数、已排除的假设
 * 与那句"能定死成因的断言"都在 `docs/reference/environment-traps.md` §7 第 606 条。
 *
 * ⚠️ 这是**渲染分端**，不是判断分端：该不该问、能不能绕过、有没有 × 三件事两端都查同一张表。
 *    P6 那档（把自绘浮层迁到共享原语）的前置正是第 606 条那一格，**没量出来之前不许把这里
 *    再改回 `DangerDialog`**。
 *
 * ## 为什么就地画在宿主的堆叠上下文里
 *
 * 第一版走 `createPortal` 到 `body` + 全局 z 阶梯，结果被两层坑各撞一次：
 * 锚定层在 `z.popover`(500) 而确认层在 `z.modal`(400) ⇒ 画得出来点不动；
 * 而习惯新建那层当时用的是 `z.splash`(900) ⇒ 数字竞赛必输（那一枚已在 P7 拆回
 * `z.modal`，并由 `pnpm check:z-ladder` 守着不再回来）。教训与复量命令见 §7 第 607 条。
 * ⇒ 宿主传 `className` 进来，确认层跟着宿主的 z 走。
 */
export interface DangerConfirmClassNames {
  readonly overlay?: string;
  readonly dialog?: string;
  readonly actions?: string;
}

export interface DangerConfirmDialogProps {
  /**
   * 六个类槽全由宿主给（遮罩 / 对话框 / 头部行 / 图标位 / 文字列 / 动作行）。
   *
   * ⚠️ 为什么是六个而不是组件自己定一套类名：宿主的功能 CSS 已经按这六个槽写好了
   *    （`ht-trash__dialog-head` 等），组件凭空造一套 BEM 名只会得到**没有 CSS 的类**——
   *    迁移当场就把画面弄坏，而"布局归宿主"这条边界也一起没了。
   */
  readonly classNames?: DangerConfirmClassNames;
  /**
   * 标题 + 正文，**整块由宿主给**。
   *
   * ⚠️ 组件不替宿主排正文（原先试过"图标槽 / 文字列 / 标题类名"六个槽）：那样每加一枚宿主
   *    就要多一处对不上的 CSS，而"内容长什么样"本来就不是这一层的职责 —— 这一层管的是
   *    **能不能绕过它**（三条通道）、**焦点在哪**、**出口是不是具名动作**。
   */
  readonly children?: ReactNode;
  /** `aria-labelledby` 指向宿主那一枚标题的 id。 */
  readonly labelledBy?: string;
  /**
   * 这一格是否落"模态强制表态"（`requiresModalCommitment` 的读数，由宿主派生）。
   *
   * 它**只**决定焦点接管的强度：模态 ⇒ 初始焦点给安全侧、Tab 不外逃、关闭归还触发者；
   * 非模态（就地确认行）不该抢走页面焦点。
   * 🔴 它**不**决定这一层画不画 —— 拿它当渲染条件的话，表一改口径，
   *    触发它的那颗按钮就变成一次**什么都不发生的点击**，那比多弹一个框坏得多。
   */
  readonly modalCommitment?: boolean;
  /** 安全侧出口。初始焦点落在这一枚上。 */
  readonly cancelLabel: string;
  /** 🔴 主按钮必须**复述动词与范围**（「彻底删除」「撤销这台设备」）；禁「确定」「OK」「是」。 */
  readonly confirmLabel: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  /**
   * testID 前缀：`${testId}` / `${testId}-cancel` / `${testId}-submit`。
   *
   * ⚠️ 这三个名字是**契约**（e2e 与截图矩阵都按它寻址）。换名要连 `e2e/tests/*.spec.ts` 一起改，
   *    别只改组件 —— 那会让用例从"断言界面"退化成"断言它自己找得到东西"。
   */
  readonly testId: string;
}

export function DangerConfirmDialog({
  classNames,
  children,
  labelledBy,
  modalCommitment = true,
  cancelLabel,
  confirmLabel,
  onCancel,
  onConfirm,
  testId,
}: DangerConfirmDialogProps): ReactNode {
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  /**
   * P6 起：遮罩 / 面板 / 三条通道 / 焦点接管这四件事搬进 `WebModalShell`，
   * 这一枚只剩**危险确认特有的那一格**——初始焦点给安全侧那枚「取消」。
   *
   * 🔴 DOM 逐字不变（类名、`role`、`aria-modal`、两个 testID 全在原位），
   *    所以 P2 那 13 条 e2e 是这次抽取的验收，不是"看着应该没坏"。
   *    策略口径也不在这里：`policy="danger-confirm"` 只是**选行**，
   *    该不该问、能不能绕过、有没有 × 仍然只住 `packages/ui/src/overlay/dismissal.ts`。
   */
  return (
    <WebModalShell
      overlayClass={classNames?.overlay ?? 'ht-danger-confirm__overlay'}
      dialogClass={classNames?.dialog ?? 'ht-danger-confirm__dialog'}
      labelledBy={labelledBy}
      policy="danger-confirm"
      testId={testId}
      onCancel={onCancel}
      modalCommitment={modalCommitment}
      initialFocusRef={cancelRef}
    >
      {children}
        <div className={classNames?.actions ?? 'ht-danger-confirm__actions'}>
          {/*
              两枚的重量是**有序**的：「取消」走次要档（有填充），主按钮走危险实底档。
              🔴 这里不许"简化"成两枚都不带色调 —— 确认层里破坏性那枚必须比安全侧更重，
              配方与档位都由 `packages/ui/src/control/states.ts` 那张表定义（`danger` +
              `commit`），Web 只是把它的名字翻译成类。
          */}
          <button
            type="button"
            ref={cancelRef}
            className="ht-btn ht-btn--secondary"
            data-testid={`${testId}-cancel`}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="ht-btn ht-btn--danger ht-btn--commit"
            data-testid={`${testId}-submit`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
    </WebModalShell>
  );
}
