/**
 * 可开关的功能模块 —— 滴答「功能模块」那一节的 heyta 版
 * ========================================================
 *
 * ## 为什么要有它（两条产品要求，一个机制同时满足）
 *
 * 产品负责人 2026-09-29 连着提了两条：
 *
 * 1. 「**左边的侧边栏那个按钮应该尽可能地减少**」
 * 2. 看到滴答的设置页之后：「**就是这样子的自定义也可以**」
 *
 * 而滴答的做法正是这两条的合体（`docs/desktop-capture` 的截图 + 实测）：
 *
 * ```
 * rail 上段只有 5 个：任务 / 日历 / 四象限 / 习惯 / 搜索
 * 其余全部是「功能模块」—— 在设置里一个一个开关
 *   日历 ✓   四象限 ✓   番茄专注 ✗   习惯打卡 ✓   倒数纪念日 ✗
 * 关掉的模块**从 rail 上消失**。
 * ```
 *
 * ⇒ **默认少 + 用户自己决定留哪些**。只做"默认少"会砍掉别人正在用的东西；
 * 只做"可开关"则默认仍然很长。两个一起才对。
 *
 * ## 🔴 为什么是**设备本地**偏好，不进 op-log
 *
 * 与移动端的 `prefs/device-prefs.ts`（欢迎页看过没有）同一条推理：
 * "这台设备上我想看到哪几个入口"是**这台设备的界面选择**，不是用户数据 ——
 * 做成同步实体等于"我在手机上关掉番茄钟，我的 Mac 上也跟着没了"，
 * 而那两个屏幕的可用空间本来就不同。
 *
 * ⚠️ 所以它**不进** `packages/shared-schema`、**不需要** bump 版本、
 * 也**不会**跨设备同步。如果将来要同步，那是**新实体**的决策（要过 schema 纪律），
 * 不是"顺手把这个 key 挪进 op-log"。
 *
 * ## 契约：**永不抛**
 *
 * 与 `theme.ts` / `locale-preference.tsx` 一致 —— 隐私模式下 `localStorage` 会抛，
 * 而"读不到偏好"绝不等于"应用起不来"。读失败退到默认值，写失败静默。
 */

import type { MessageKey } from '@heyta/i18n';
import type { FeatureModuleKey } from '@heyta/domain';

/**
 * 可开关的模块 key。
 *
 * 🔴 **词表不在这里，在 `@heyta/domain` 的 `FEATURE_MODULE_KEYS`**（W8 / 本文 §7 第 5 条）：
 * "heyta 有哪几个功能域"是产品语义，四个端必须用同一批词；
 * 而"这一端把哪几个摆在哪里、默认开不开"才是平台差异。
 * 这里因此只是**别名** —— 移动端若自己编一个 web 没有的 key，是编译错误而不是漂移。
 *
 * ⚠️ 它是 `apps/web` 的 `ViewKey` 的**子集**（`tasks` / `settings` 不在里面 ——
 * 那两个是"去哪都需要的"，不给关）。这里刻意**不 import `App.tsx` 的 `ViewKey`**：
 * 那会形成 `App.tsx ↔ modules.ts` 的循环 import，而循环 import 的症状是
 * "某一边拿到 undefined"，且**只在某些打包顺序下才出现**。
 */
export type ShellModuleKey = FeatureModuleKey;

export interface ShellModule {
  readonly key: ShellModuleKey;
  /** 模块名（开关的标题）。 */
  readonly labelKey: MessageKey;
  /** 一句话说清它是什么 —— 滴答的每张卡下都有一句（"在 6 种日历视图中规划任务"）。 */
  readonly noteKey: MessageKey;
  /**
   * 默认是否开启。
   *
   * 🔴 默认值本身就是产品判断，照滴答的口径定：
   * **"任务类"的默认开**（四象限 / 习惯 / 时间线 —— 它们改变"怎么看任务"），
   * **"额外玩法"默认关**（番茄钟 / 成长 / 便签 —— 不用的人永远不该看见它们）。
   */
  readonly defaultOn: boolean;
}

export const SHELL_MODULES: readonly ShellModule[] = [
  {
    // 日历默认开：它是滴答 rail 的 5 个主菜单之一，属于"任务类"而不是"额外玩法"。
    key: 'calendar',
    labelKey: 'web.shell.modules.calendar.label',
    noteKey: 'web.shell.modules.calendar.note',
    defaultOn: true,
  },
  {
    key: 'quadrant',
    labelKey: 'web.shell.modules.quadrant.label',
    noteKey: 'web.shell.modules.quadrant.note',
    defaultOn: true,
  },
  {
    key: 'habits',
    labelKey: 'web.shell.modules.habits.label',
    noteKey: 'web.shell.modules.habits.note',
    defaultOn: true,
  },
  {
    key: 'timeline',
    labelKey: 'web.shell.modules.timeline.label',
    noteKey: 'web.shell.modules.timeline.note',
    defaultOn: true,
  },
  {
    key: 'focus',
    labelKey: 'web.shell.modules.focus.label',
    noteKey: 'web.shell.modules.focus.note',
    defaultOn: false,
  },
  {
    key: 'growth',
    labelKey: 'web.shell.modules.growth.label',
    noteKey: 'web.shell.modules.growth.note',
    defaultOn: false,
  },
  {
    key: 'notes',
    labelKey: 'web.shell.modules.notes.label',
    noteKey: 'web.shell.modules.notes.note',
    defaultOn: false,
  },
  {
    // 🔴 默认关是产品负责人拍的（`docs/plans/countdown-anniversary.md` §3 W8）。
    //    它和「日历」的区别不是重不重要，而是**用的频率**：倒数日一周点几次，
    //    而 rail 是每天点几十次的地方。关掉的模块**不进 DOM**（不是 `display:none`），
    //    所以这条默认值不会动到任何既有的 tab 计数断言。
    key: 'countdown',
    labelKey: 'web.shell.modules.countdown.label',
    noteKey: 'web.shell.modules.countdown.note',
    defaultOn: false,
  },
];

const STORAGE_KEY = 'heyta.shell.modules';

/** 每个模块的默认开关（从 registry 推，**不手抄一份**）。 */
function defaults(): Record<ShellModuleKey, boolean> {
  return Object.fromEntries(SHELL_MODULES.map((m) => [m.key, m.defaultOn])) as Record<
    ShellModuleKey,
    boolean
  >;
}

/**
 * 读已启用的模块集合。
 *
 * 🔴 **读失败退到默认值**，不抛 —— 见文件头的契约。
 * 🔴 存的是**显式覆盖**（`{focus: true}`）而不是整个集合：
 *    这样将来给 registry 加一个默认开的模块，老用户也能**拿到新默认**，
 *    而不是被一份"当年存下来的完整集合"永久钉在旧状态上
 *    （那是"加了新功能但老用户永远看不到"的经典成因）。
 */
export function loadEnabledModules(): ReadonlySet<ShellModuleKey> {
  const base = defaults();
  let overrides: Record<string, unknown> = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        overrides = parsed as Record<string, unknown>;
      }
    }
  } catch {
    // 隐私模式 / 坏 JSON：用默认值，不崩。
  }
  const enabled = new Set<ShellModuleKey>();
  for (const m of SHELL_MODULES) {
    const override = overrides[m.key];
    const on = typeof override === 'boolean' ? override : base[m.key];
    if (on) enabled.add(m.key);
  }
  return enabled;
}

/**
 * 存**显式覆盖**（见 `loadEnabledModules` 的说明）。
 *
 * 只写与默认不同的那几项 —— 全等默认时把整个键删掉，避免留一份冗余状态。
 */
export function saveEnabledModules(enabled: ReadonlySet<ShellModuleKey>): void {
  const base = defaults();
  const overrides: Partial<Record<ShellModuleKey, boolean>> = {};
  for (const m of SHELL_MODULES) {
    const on = enabled.has(m.key);
    if (on !== base[m.key]) overrides[m.key] = on;
  }
  try {
    if (Object.keys(overrides).length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // 存不上不影响本次生效（与 theme.ts 同）。
  }
}

/** 切换一个模块，返回新的集合（**不改入参**）。 */
export function toggleModule(
  enabled: ReadonlySet<ShellModuleKey>,
  key: ShellModuleKey,
): Set<ShellModuleKey> {
  const next = new Set(enabled);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}
