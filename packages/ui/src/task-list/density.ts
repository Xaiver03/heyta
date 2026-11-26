/**
 * `TaskRow` 的**密度契约** —— "同一行、多档紧凑度"的唯一登记处
 * ==========================================================
 *
 * 出处：`docs/research/dida-view-unification.md` §4.2 / §4.3 ——
 *
 * > 四象限卡里的行 = `<TaskRow density="compact" />`，
 * > 日历格里的行 = `<TaskRow density="minimal" />`。**不是三份 JSX。**
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么这张表要单独一个文件（而不是写在 `TaskRow.tsx` 里）
 *
 * 两条理由，都是实测约束，不是风格偏好：
 *
 * 1. **`packages/ui` 的单测跑在 node 环境**（`vitest.config.ts` 明确不 render、
 *    不引 jsdom、不引 `@testing-library/*`）。`TaskRow.tsx` import 了
 *    `react-native`（Flow 源码，node 解析不了），所以任何 import 它的测试**必然挂**。
 *    密度是"显示什么 + 用哪些 token"的**纯判断**，把它放在这个不含 RN 的模块里，
 *    "同一实体在不同档位下的结构不同"才能被测试真的钉住（见
 *    `tests/task-row-density.spec.ts`）。
 * 2. `TaskList.tsx` 与象限/日历那些容器都从**同一个 `resolveTaskRowDensity`** 取档位，
 *    差异只有这一张表 -> "多档密度"不会漂成"多份 if 分支"。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 边界：密度是"同一行的紧凑度"，**不是"另一种行"**
 *
 * 这里只允许两种差异，各自都有明确理由：
 *
 * | 差异轴 | 允许改什么 | 不允许改什么 |
 * |---|---|---|
 * | 空间 | `minHeight` / `bodyPaddingBlock` / `gap` 三个槽位换成别的 token | 引入新 token；写裸数字（`check:design` 会拦） |
 * | 内容 | `showMeta` / `showTrailing`（**要不要渲染宿主给的次要插槽**） | 改行骨架（勾选框 + 标题一定在） |
 * | 排印 | `title` 换成**另一枚已登记的语义样式**（`TEXT_STYLES` 的键） | 写裸字号/字重；新增一枚只为某个调用点服务的样式 |
 *
 * ⚠️ **排印那一行是 2026-11-03 加的**，之前这张表写着"标题永远是 `row-title`"。
 * 改这条规则的不是审美，是一个具体的两难：详情面板要"大字标题"，
 * 而当时的两条出路是 —— ① 在宿主里再手写一份"勾选框 + 标题 + 截止"（
 * `check:row-single-source` 断言 A 抓的就是它，也是本工单第一步要消掉的那条红），
 * ② 让密度表允许换标题的语义样式。① 是"同一判断两份渲染"，比 ② 糟得多，
 * 所以选了 ②。⚠️ 它**不是**"密度从此可以随便调排版"的开口：
 * 值仍然只能取自唯一事实源（裸值被 `check:design` 拦），
 * 每档用哪一枚样式由 `tests/task-row-density.spec.ts` 逐档钉住，
 * 而默认档 `comfortable` 的 `title` 逐字等于 `TASK_ROW_TEXT.title` ——
 * 也就是"不传 `density` 的调用点行为一字不变"这条前提仍然成立。
 *
 * ⚠️ **勾选框几何刻意不进密度**：`size.checkbox` / `touch-target.min` /
 * `radius.sm` 是三端一致的可访问性契约（44 触控下限 + 22 视觉尺寸），
 * 按容器缩它是**回归**，不是"紧凑"。所以 `TaskRow.tsx` 里这几项是常量。
 *
 * ⚠️ 颜色不属于密度，也不属于这个文件：颜色跟随主题（`tokens.css` 亮/暗两套），
 * 与 `task-row-shape.ts` 同一条边界。
 */

import {
  TASK_ROW_SHAPE,
  TASK_ROW_TEXT,
  type TextStyleName,
  type TokenName,
} from '@heyta/design-system';

/**
 * 一行有哪几档紧凑度。**有界**（四档），不做 `number` 之类的连续轴 ——
 * 连续轴会让"这一屏该多高"从设计决定变成每个调用点各写一个数字。
 *
 * ⚠️ `detail` 不是"第三份行"：它是同一份 `<TaskRow>` 的一档，
 * 差异只有表里那五个槽位（其中 `title` 是这一档带来的，见 `TaskRowDensitySpec`）。
 */
export type TaskRowDensity = 'comfortable' | 'compact' | 'minimal' | 'detail' | 'dense';

/** 全档位清单（测试与 `satisfies` 共用，避免"加了档位忘了登记"）。 */
export const TASK_ROW_DENSITIES = [
  'comfortable',
  'compact',
  'minimal',
  'detail',
  'dense',
] as const satisfies readonly TaskRowDensity[];

/**
 * 缺省档 = **`dense`**（2026-11-26 产品决定：所有端、所有任务列表统一收紧密度）。
 *
 * 为什么把默认档从 `comfortable` 换成 `dense`，而不是每端各传一次：
 * 手机端、Web、桌面壳共用同一份 `<TaskList>`，缺省档是**唯一**能被所有端
 * 一起命中、且不会漏掉某个调用点的落点。改这一处 ⇒ 所有没收窄过的列表一起变紧；
 * 象限（`compact`）、日历（`minimal`）、详情（`detail`）这些显式档不受影响。
 *
 * ⚠️ `comfortable` 档**保留**：它仍是"抽取前那段内联行"的几何，供需要宽松排版的
 * 调用点显式选择；只是不再是缺省。
 */
export const DEFAULT_TASK_ROW_DENSITY: TaskRowDensity = 'dense';

/**
 * 一档密度的完整定义。
 *
 * ⚠️ 每加一个字段，都要同时回答"三档里它真的需要不同吗"。字段越多，
 * "密度"越容易退化成"第二个 `variant`"。
 */
export interface TaskRowDensitySpec {
  /**
   * 行的最小高度（token 名）。`null` = **不设下限**，行高完全由内容决定。
   *
   * 这是三档里唯一允许为 `null` 的槽位 —— "要让这一行比内容的自然高度更矮"
   * 没有意义，所以最低那一档直接去掉下限。
   */
  readonly minHeight: TokenName | null;
  /** 标题文字块的上下内间距。 */
  readonly bodyPaddingBlock: TokenName;
  /** 行内主要元素之间的间距（勾选框与文字块之间）。 */
  readonly gap: TokenName;
  /** 宿主给的 `renderMeta`（截止 / 优先级 / 重复）要不要渲染。 */
  readonly showMeta: boolean;
  /** 宿主给的 `renderTrailing`（删除按钮 / 拖动手柄…）要不要渲染。 */
  readonly showTrailing: boolean;
  /**
   * 标题用哪一枚**语义文字样式**（只能是 `TEXT_STYLES` 里登记过的名字）。
   *
   * 🔴 这一格是 2026-11-03 随 `detail` 档加进来的，加它的理由与不加它的边界
   * 都写在文件头那张差异表里 —— 它不是"密度可以随便改排版"的开口：
   * 值仍然只能取自唯一事实源，裸值会被 `check:design` 拦，
   * 而"这一档到底换了哪枚样式"由 `tests/task-row-density.spec.ts` 逐档钉住。
   */
  readonly title: TextStyleName;
}

/**
 * 🔴 **差异单点定义。** 组件里不许再出现 `if (density === …)`。
 *
 * 三档的实际差异（这就是全部，没有藏在别处的）：
 *
 * | 档位 | 用途 | minHeight | bodyPaddingBlock | showMeta | showTrailing | title |
 * |---|---|---|---|---|---|---|
 * | `comfortable` | 列表（默认） | `size.row-min-height`（60） | `space.3`（12） | ✅ | ✅ | `row-title` |
 * | `compact` | 四象限卡 | `touch-target.min`（44） | `space.1`（4） | ✅ | ✅ | `row-title` |
 * | `minimal` | 日历格 / 时间线泳道 | 无下限 | `space.1`（4） | ❌ | ❌ | `row-title` |
 * | `detail` | 详情面板内容层那一行 | `size.row-min-height`（60） | `space.3`（12） | ✅ | ✅ | **`detail-title`** |
 * | `dense` | 桌面列表（对标滴答密度） | `touch-target.min`（44） | `space.2`（8） | ✅ | ✅ | `row-title` |
 *
 * ⚠️ 上面这段"三档"是旧话，第四档 `detail` 于 2026-11-03 加入（表里已列全）。
 * 判"某档有没有偷偷多改东西"的尺不是这段注释，是
 * `packages/ui/tests/task-row-density.spec.ts`：它逐档读出这六个槽位。
 *
 * 为什么 `compact` 的 `minHeight` 是 `touch-target.min` 而不是新造一个
 * `size.row-min-height-compact`：44 正是勾选框的**触控下限**，紧凑档压到它为止 ——
 * 再矮就要么牺牲可点性、要么让勾选框溢出容器。用已有 token 表达这条下限，
 * 比新增一个语义更窄的尺寸 token 更诚实（新增 token 的成本是刻意的）。
 *
 * 为什么 `compact` **不**隐藏 `renderTrailing`：象限格里的 `renderTrailing`
 * 是**拖动手柄**（`quadrant` 一刀已把"整行可拖"改成"握把可拖"）。
 * 如果紧凑档把它藏掉，象限会**静默失去拖拽** —— 那不是紧凑，是功能回归。
 * 真正该藏次要插槽的是日历格（`minimal`）：那种格子里一行只有"勾选框 + 标题"。
 */
export const DENSITY_SPEC = {
  comfortable: {
    minHeight: TASK_ROW_SHAPE.minHeight,
    bodyPaddingBlock: TASK_ROW_SHAPE.bodyPaddingBlock,
    gap: TASK_ROW_SHAPE.gap,
    showMeta: true,
    showTrailing: true,
    title: TASK_ROW_TEXT.title,
  },
  compact: {
    minHeight: 'touch-target.min',
    bodyPaddingBlock: 'space.1',
    gap: 'space.1',
    showMeta: true,
    showTrailing: true,
    title: TASK_ROW_TEXT.title,
  },
  minimal: {
    minHeight: null,
    bodyPaddingBlock: 'space.1',
    gap: 'space.1',
    showMeta: false,
    showTrailing: false,
    title: TASK_ROW_TEXT.title,
  },
  /**
   * 详情面板那一档（工单「任务详情面对标滴答清单」第一步要的"大字档"）。
   *
   * 与默认档的差别**只有标题那枚样式**：几何（`minHeight` / 内间距 / `gap`）
   * 全部沿用 `comfortable`，两个次要插槽也照旧渲染 ——
   * 详情面板要的是"同一条信息更大"，不是"另一种紧凑度"。
   * 这正是它配得上待在密度表里、而不是变成 `TaskRow` 上第二个 `variant` 的原因。
   */
  detail: {
    minHeight: TASK_ROW_SHAPE.minHeight,
    bodyPaddingBlock: TASK_ROW_SHAPE.bodyPaddingBlock,
    gap: TASK_ROW_SHAPE.gap,
    showMeta: true,
    showTrailing: true,
    title: 'detail-title',
  },
  /**
   * **桌面列表的紧凑档**（对标滴答的密度，2026-11-26）。
   *
   * 与 `comfortable` 的差别只在两处空间：行最小高降到触控下限 `44`，
   * 文字块上下内间距降到 `space.2`(8)。单行行高因此是 44（28 行高 + 上下各 8），
   * 与滴答桌面单行 ≈48 同档；配 `rowDividers` 后行距从 68 收到 44。
   *
   * 槽位与标题样式**完全同 `comfortable`** —— 这是"同一行的更紧一档"，
   * 不是"另一种行"，也不是给某处调排版留的口子（排印仍只 `detail` 一档偏离）。
   * 移动端/象限/日历都不传它，行为不变。
   */
  dense: {
    minHeight: 'touch-target.min',
    bodyPaddingBlock: 'space.2',
    gap: TASK_ROW_SHAPE.gap,
    showMeta: true,
    showTrailing: true,
    title: TASK_ROW_TEXT.title,
  },
} as const satisfies Record<TaskRowDensity, TaskRowDensitySpec>;

/**
 * 🔴 **`gap` 目前三档完全相同，不产生任何差异**（只读审计 2026-09-28 实测）：
 * `TASK_ROW_SHAPE.gap`、`compact.gap`、`minimal.gap` **都是 `'space.1'`**。
 *
 * 它**不是** bug，也不该现在删：`comfortable` 那一档连的是
 * `TASK_ROW_SHAPE.gap`（共享形状登记处），**将来那处一改，默认档会正确跟随**
 * —— 删掉就等于把这个连接切断。
 *
 * 但它是一个**读者陷阱**：看这张表的人会以为"密度会影响行内间距"。
 * 所以在这里写死结论：**当前真正区分档位的只有 `minHeight` 与
 * `bodyPaddingBlock` 两项，加上 `minimal` 独有的 `showMeta=false` /
 * `showTrailing=false`。** 上面规格表**刻意没有列 `gap`** —— 那是准确的，不是遗漏。
 *
 * ⚠️ 若将来要让某一档真的改间距，**必须同时更新规格表**，否则表与实现对不上。
 */

/**
 * 档位 -> 规格。**唯一的解析入口。**
 *
 * ⚠️ 传 `undefined`（或什么都不传）走默认档；不在这里兜 "未知字符串"，
 * 因为 `TaskRowDensity` 是联合类型，编译期就排除了 —— 运行时兜底只会把
 * "写错档位名"从编译错误降级成静默的默认档。
 */
export function resolveTaskRowDensity(density?: TaskRowDensity): TaskRowDensitySpec {
  return DENSITY_SPEC[density ?? DEFAULT_TASK_ROW_DENSITY];
}
