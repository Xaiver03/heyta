/**
 * 设置（共享模型）
 * ==================
 *
 * M3 第五刀（settings）的**判断层**：设置项的**可用性判定**、待上传计数的
 * **三态呈现**，以及"一行设置"的**类型化模型**（`SettingsRowModel`）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么需要它（不是"少写点代码"）
 *
 * 迁之前两端各写一套"设置行"：
 *
 *   | | web | mobile |
 *   |---|---|---|
 *   | 行的容器 | `<ul class="ht-settings__list"><li class="ht-settings__item">` + `__toggle-body` / `__toggle-label` / `__hint` | `SectionHeader` + `Card` + 本地 `Row`（`flexDirection:'row'` + `justifyContent:'space-between'`） |
 *   | 开关 | `<label class="ht-settings__toggle"><input type="checkbox" role="switch">` | 整行 `Pressable` + `accessibilityRole="switch"` |
 *   | 不可用时 | 整段不渲染（`probeWidgetPush` 返回 `'hidden'`） | 整段不渲染（`hideTitles === null`） |
 *
 * 前两行是**外观差异**（允许端差异只在 L3，各端外壳本来就不同）；
 * 第三行**不是**外观差异，它是一条**产品判据**，而且两端各自实现了一遍：
 * **一个用户改不动、按了也没反应的设置项，必须整项不渲染，而不是渲染成灰的。**
 *
 * 那条判据两端各写一遍的后果，在 `apps/mobile/src/screens/ProfileScreen.tsx`
 * 的注释里被真实记过一次：安卓上 `readWidgetPrivacy()` 返回 `null`，
 * 若把它当成 `false`，用户会看到一个**按了没反应的开关**，
 * 而他会以为自己设上了 —— 那比不显示更坏。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 本文件**不 import `react-native`，也不 import `@heyta/i18n`**
 *
 *   · `react-native`：`packages/ui/vitest.config.ts` 跑在 **node** 环境，
 *     它解析不了 RN 的 Flow 源码。这条约束顺带钉住了"model 必须宿主无关"。
 *   · `@heyta/i18n`：那个包曾自带一份 React，四端会同时中招
 *     （见 `TaskList.tsx` 文件头）。所以这里**一个文案都不出现** ——
 *     只产出**结构化的呈现结果**（`PendingUploadPresentation`），
 *     词条模板留在有 i18n 的那一侧。
 *
 * 所以本文件里没有一行是"界面文字"，只有"这件事是什么"。
 */

/**
 * ⚠️ 这是**类型**导入（`import type`，编译后整行消失）—— 它没有让
 * `model.ts` 依赖 React 的运行时，也没有破坏"node 环境能加载"这条约束。
 * 行模型里有几个**插槽**字段（`leading`）需要它。
 */
import type { ReactNode } from 'react';

/* ========================================================================
 * 一、设置项的可用性：`null` / `undefined` / `false` 是三件不同的事
 * ====================================================================== */

/**
 * 一个设置项的可用性。
 *
 * 🔴 三个值**必须分开**，因为它们的界面后果完全不同：
 *
 *   · `unknown`（`undefined`）—— 还没读到 / 还没探测完。
 *     ⚠️ **不渲染**：先画一个"关"，半秒后跳成"开"，用户会以为它在自己乱动
 *     （web `WidgetPushPanel` 的探测期就是这一态）。
 *   · `unsupported`（`null`）—— 这台设备/这个平台**根本没有这一项**
 *     （安卓/鸿蒙没有锁屏小组件隐私开关）。**不渲染**。
 *   · `ready`（`true` / `false`）—— 有这一项，开关跟着用户走。
 *     🔴 `false` 是**用户关着**，不是"不可用"。把 `false` 当成不可用，
 *     开关会在用户关掉它的那一刻**消失** —— 而用户再也打不开。
 */
export type SettingAvailability = 'unknown' | 'unsupported' | 'ready';

/**
 * 原始读值 → 可用性。
 *
 * 传进来的形状刻意是 `boolean | null | undefined`：它正好是三态读值的形状
 * （`readWidgetPrivacy()` 返回 `Promise<boolean | null>`、探测中就是 `undefined`），
 * 调用点不需要先归一化一遍 —— 归一化写两遍就是两份会漂移的判据。
 */
export function resolveSettingAvailability(raw: boolean | null | undefined): SettingAvailability {
  if (raw === undefined) return 'unknown';
  if (raw === null) return 'unsupported';
  return 'ready';
}

/**
 * 这一项现在**能不能被用户改动**。
 *
 * 只有 `ready` 能。`unknown` / `unsupported` 都必须走"整项不渲染"那条路
 * （见 `SettingAvailability` 的注释），而不是渲染成灰的。
 */
export function isSettingActionable(availability: SettingAvailability): boolean {
  return availability === 'ready';
}

/* ========================================================================
 * 二、待上传计数 → 呈现（三态 + 单复数）
 * ====================================================================== */

/**
 * 「待上传」该显示成什么。
 *
 * 🔴 三态不能合并，这是**一次真实的界面撒谎**：`pendingUpload` 的初值曾经是
 * `0`，于是"还没读到队列"显示成"已全部上传" —— 本地一条没传也这么说。
 * 现在 `undefined`（还没读到）与 `0`（真的全传完了）是两种呈现。
 *
 * `plural` 单独给出而不是让调用点自己判：词条表没有 ICU，英文复数要靠
 * **兄弟词条**（`…count` / `…countOne`）。判据留在这一层，两端就不会
 * 一个显示 `1 items`、另一个显示 `1 item`。
 */
export type PendingUploadPresentation =
  | { readonly kind: 'unknown' }
  | { readonly kind: 'none' }
  | { readonly kind: 'count'; readonly count: number; readonly plural: boolean };

/**
 * 待上传条数 → 呈现。**负数按"没有待上传"处理**（计数不该为负，
 * 真的为负说明上游读错了 —— 显示成"欠 -3 条"比显示成 0 更糟）。
 */
export function resolvePendingUploadPresentation(
  pending: number | undefined,
): PendingUploadPresentation {
  if (pending === undefined) return { kind: 'unknown' };
  if (pending <= 0) return { kind: 'none' };
  return { kind: 'count', count: pending, plural: pending !== 1 };
}

/* ========================================================================
 * 三、一行设置的类型化模型
 * ====================================================================== */

/**
 * 一行的语义色调。
 *
 * 🔴 它只表达**重要性/状态**，不表达"什么颜色"—— 颜色映射在
 * `SettingsRow.tsx` 里（那一层才碰 token）。这样"危险的那一行该是什么颜色"
 * 就只有一处答案。
 */
export type SettingsRowTone = 'default' | 'muted' | 'subtle' | 'danger' | 'warning';

/** 所有行共有的字段。 */
interface SettingsRowCommon {
  /**
   * 这一行的 DOM `data-testid` / RN `testID`。
   *
   * ⚠️ 设置页的行是**真机验收脚本的锚点**（`verify-mobile-*.sh` 靠文字与 testID
   * 定位），所以 testID 由宿主给、共享层原样透传，不自己编。
   */
  readonly testID?: string;
  /**
   * 这一行上面画一条发丝分隔线。
   *
   * 🔴 它是**逐行开关**，不是列表的自动行为：web 的 `ht-settings__list`
   * 靠每项自己的边框分段（没有分隔线）、mobile 的卡片只在两处画 `Divider`。
   * 自动给每一行都加线会把两端原有的留白各改一遍 —— 那是"顺手改外观"，
   * 不是统一契约。所以由宿主显式说"这里断开"。
   */
  readonly divider?: boolean;
}

/**
 * 值行：左边标签，右边一个**只读的值**。
 *
 * `onPress` 给了就变成"整行可点的开关式行"—— 可点区域是**整行**而不是行里
 * 那个小方框：设置项的目标点击区在 iOS 上是 44pt，而一个 20pt 的方框在
 * "我看着这一行、想把它打开"的心智下是打不中的（移动端的原注释记的就是这条）。
 */
export interface SettingsValueRow extends SettingsRowCommon {
  readonly kind: 'value';
  readonly label: string;
  readonly value: string;
  readonly tone?: SettingsRowTone;
  readonly onPress?: () => void;
  /** 值那一格自己的 testID（宿主断言读数时要它）。 */
  readonly valueTestID?: string;
}

/**
 * 开关行：标签（+ 一句提示）+ 一个能改变状态的控件。
 *
 * `availability` 给了且不是 `ready` → **整行不渲染**（判据见 `SettingAvailability`）。
 * 由共享层执行这条，而不是交给宿主 —— 交给宿主就是"每个调用点各自记得"，
 * 而漏掉的那一处不会报错、只会画画错。
 */
export interface SettingsToggleRow extends SettingsRowCommon {
  readonly kind: 'toggle';
  readonly label: string;
  readonly hint?: string;
  readonly checked: boolean;
  readonly onToggle: () => void;
  readonly availability?: SettingAvailability;
  /** 正在忙（上一笔写还没回来）—— 期间不接受第二次点击。 */
  readonly disabled?: boolean;
  /**
   * 正在忙，而且这件事**要花可见的时间**（网络往返）。
   *
   * 与 `disabled` **不是同一件事**：`disabled` 说的是"别点"，
   * `busy` 说的是"我正在做事"。原来 web 的推送开关同时给了
   * `disabled` 与 `aria-busy` —— 只留前者会让读屏用户不知道在等什么。
   */
  readonly busy?: boolean;
  /** 标签前面那个记号（图标 / 忙时的转圈），由宿主渲染。理由同 `SettingsActionRow.leading`。 */
  readonly leading?: ReactNode;
}

/**
 * 动作行：标签（+ 一句说明）+ 一个"去哪里/做什么"。
 *
 * `href` 与 `onPress` **至少要有一个**：
 *   · `href` —— web 的站内链接。它在 `react-native-web` 下渲染成**真实的
 *     `<a>`**（见 `SettingsRow.tsx` 的实测证据）；原生端忽略它。
 *   · `onPress` —— 原生端的入口（原生没有 `<a>`）。
 * 两个都给时两边各自生效，这正是"同一行、两个端各走各的腿"。
 */
export interface SettingsActionRow extends SettingsRowCommon {
  readonly kind: 'action';
  readonly label: string;
  readonly hint?: string;
  readonly href?: string;
  readonly onPress?: () => void;
  /**
   * 标签前面那个记号（图标），由宿主渲染。
   *
   * 🔴 与 `SettingsSectionProps.leading` 同一个理由：两端的字形不同源
   * （共享层吃 `lucide` 的**数据**，`apps/mobile` 用 `lucide-react-native`
   * 的**组件**）。这也顺带保住了 web「帮助与关于」三个入口各自不同的图标 ——
   * 让共享层只接受一种字形，就只能**把它们删掉**，那是为统一而降级。
   */
  readonly leading?: ReactNode;
}

/** 说明行：一整句（不是某一项的标签）。`role='alert'` 时读屏会立刻念出来。 */
export interface SettingsNoteRow extends SettingsRowCommon {
  readonly kind: 'note';
  readonly text: string;
  readonly tone?: SettingsRowTone;
  readonly role?: 'alert';
  /** 句子前面那个记号（图标），由宿主渲染。理由同 `SettingsActionRow.leading`。 */
  readonly leading?: ReactNode;
  /**
   * 这一行的序号（从 1 开始）。给了就在句子前面画"1."。
   *
   * 🔴 **序号由共享层画，不由宿主拼**：web 原来用 `<ol>`（浏览器生成编号），
   * mobile 原来拼的是 `` `${index + 1}. ${t(key)}` `` —— 两种格式、两端各一份。
   * 这正是"一行只有一个实现"要消掉的那类漂移：宿主各拼各的，就没有第二处会红。
   */
  readonly index?: number;
}

/**
 * 小标题行：一个区块内部的**次级**标题（如"怎么把卡片加上去"）。
 *
 * 它不是"一行设置"，但它在**同一个列表里**—— 所以它是这个联合的一个成员，
 * 而不是让宿主在列表外面插一个 `<h3>`。理由与滴答的 `SectionCell` 相同
 * （`dida-view-unification.md` §1.4）：**分组头也是一行**。
 */
export interface SettingsHeadingRow extends SettingsRowCommon {
  readonly kind: 'heading';
  readonly text: string;
}

/**
 * 尾随动作行：左边一段"关于某个对象的信息"（标题 + 副行 + 说明），
 * 右边**一枚宿主给的控件**（撤销 / 删除 / 退出…），它有自己的 testID。
 *
 * 🔴 为什么不是 `action` 档：`SettingsActionRow` 的 `onPress` 让**整行**可点，
 * 语义是"这一行是一个入口"。而会话/设备列表那一行不是入口 —— 它是一个**对象**
 * （一台设备）带着几行事实，外加一个只对得起那个对象的动作。整行可点会把
 * "选中这行"与"撤销这台设备"混成同一个手势，而那两者代价完全不同。
 *
 * 🔴 为什么 `actions` 是**插槽**而不是 `onPress: () => void`：
 *   · 两端要画的控件不同（web 是 `<button className="ht-btn">`，RN 是 `Pressable`），
 *     而忙态图标、确认态、"这一台是当前设备所以没有出口"这些**行内差异**
 *     都属于宿主（AGENTS §3.5 的 L3）。共享层拥有的是**行的解剖**，不是按钮的行为。
 *   · 移动端 `SessionsSection` 与 web `SessionsPanel` 此前**各写一遍**这个形状，
 *     正是本契约要消掉的那类重复。
 *
 * ⚠️ `label` 可缺省：设备名允许为空（UA 也拿不到时**什么都不编**），
 *    这时这一行只剩副行与动作 —— 不许为了填满版面编一个"未命名设备"。
 */
export interface SettingsTrailingRow extends SettingsRowCommon {
  readonly kind: 'trailing';
  readonly label?: string;
  /**
   * 标签那一格自己的 testID（宿主断言读数时要它）。
   *
   * 🔴 理由与 `SettingsValueRow.valueTestID` 同一个，但这里更硬：web 的会话列表有一条
   * 判据是「设备名与 UA 都拿不到时**标签元素必须不存在**」（不是渲染一个空串、
   * 更不是编一个"未命名设备"）。共享层画的这一格若没有可锚定的 id，
   * 那条判据就只能靠文本内容去猜。
   * ⚠️ `meta` / `note` / `actions` 都是宿主自己渲染的节点，宿主在里面挂自己的 testID 即可，
   *    所以契约只缺这一格。
   */
  readonly labelTestID?: string;
  /** 标签下面那行小字（时间戳、元信息）。由宿主格式化好再给，共享层不碰日期。 */
  readonly meta?: ReactNode;
  /** 再下面那行说明。给了就画；它是**反馈**那一族，不进 `?`。 */
  readonly note?: ReactNode;
  /** 行右侧的控件区，由宿主渲染。 */
  readonly actions: ReactNode;
  /** 标签前面那个记号（图标），由宿主渲染。理由同 `SettingsActionRow.leading`。 */
  readonly leading?: ReactNode;
}

/**
 * 宿主自己渲染的一格，**占一个位置**在有序行列表里。
 *
 * 🔴 为什么必须有这一档（2026-11-04，不是"方便"）：`SettingsSection` 原来只支持
 *   "先 rows 后 children"，于是**类型化行与宿主内容不能交错**。`ProfilePanel` 的
 *   头像行 / 昵称字段 / 邮箱行就是这个死局的现场：昵称是一格字段（走 `FormField`），
 *   夹在两行中间 ⇒ 两行迁不进契约，只能继续手写 `__row`。
 *   2026-11-04 真浏览器现量：同一屏里手写行行距 ≈85px、字段行控件右缘 1255、
 *   手写行控件右缘 1267 —— 用户最初抱怨的"同一屏两种起点"就是这么来的。
 *
 * ⚠️ 它**不是**"什么都能塞"的逃生口：这一档只负责**顺序与分组归契约**，
 *   内容自己的解剖仍由它所属的那族负责（字段就还是 `FormField`，见
 *   `docs/agents/ux-principles.md` §1 / §1b）。判断"这一格该走哪族"的口径没变，
 *   变的只是"一屏可以按用户读到的顺序把两族排在一起"。
 */
export interface SettingsHostRow extends SettingsRowCommon {
  readonly kind: 'host';
  /** 宿主渲染的内容。为 `null` / `undefined` 时这一整条不占位（见 `shouldRenderSettingsRow`）。 */
  readonly node?: ReactNode;
}

/** 一行设置。**穷尽联合** —— 新增一种行类型时每个 `switch` 都会编译失败。 */
export type SettingsRowModel =
  | SettingsValueRow
  | SettingsToggleRow
  | SettingsActionRow
  | SettingsTrailingRow
  | SettingsHostRow
  | SettingsNoteRow
  | SettingsHeadingRow;

/**
 * 行的 React key。
 *
 * 🔴 `testID` 优先，其次 `label` / `text`，最后才回落到下标。
 * 直接用下标会在**插进一行时让 React 复用错的行**（步骤表那种常量表尤其危险，
 * 移动端原来就为这条专门留了注释）。这里让宿主给的稳定标识先被用上。
 */
export function settingsRowKey(row: SettingsRowModel, index: number): string {
  if (row.testID !== undefined && row.testID !== '') return row.testID;
  switch (row.kind) {
    case 'value':
      return `value:${row.label}`;
    case 'toggle':
      return `toggle:${row.label}`;
    case 'action':
      return `action:${row.label}`;
    case 'trailing':
      // ⚠️ `label` 可缺省（设备名与 UA 都拿不到时**什么都不编**），所以这里必须有回落，
      // 否则会拼出 `trailing:undefined` —— 两行都缺名时它们会撞成同一个 React key。
      return `trailing:${row.label ?? `#${String(index)}`}`;
    case 'host':
      // 宿主内容没有可当 key 的语义字段 ⇒ 有 testID 就用它，否则按位置。
      return `host:#${String(index)}`;
    case 'note':
      return `note:${row.text}`;
    case 'heading':
      return `heading:${row.text}`;
    default: {
      // 穷尽自检：新增 kind 而没在这里给 key → 编译期报错。
      const never: never = row;
      return `unknown:${String(index)}:${JSON.stringify(never)}`;
    }
  }
}

/**
 * 一行该不该被渲染。
 *
 * 只有**开关行**有"不渲染"这一态（它带 `availability`）；其余行永远渲染。
 * 单独抽出来是为了让"不渲染"这件事可被单测钉住 —— 否则它只会体现在
 * 某个 JSX 分支里，而那种分支**不报错、只会画错**。
 */
export function shouldRenderSettingsRow(row: SettingsRowModel): boolean {
  if (row.kind === 'host') {
    // 空内容不占位：否则宿主传 `node={cond ? x : undefined}` 时会留出一个空行间距。
    return row.node !== undefined && row.node !== null;
  }
  if (row.kind !== 'toggle') return true;
  if (row.availability === undefined) return true;
  return isSettingActionable(row.availability);
}