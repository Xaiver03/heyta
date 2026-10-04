/**
 * 规则式快速捕获：自然语言 → 任务字段
 * =====================================
 *
 * 🔴 **这不是 AI，而且这个区别是刻意的。**
 *
 * 把一段话变成结构化任务，是任务管理里**唯一被反复验证**的 AI 场景。
 * 但调研的结论是：这个场景里 AI 的真实增量**不是"解析日期"**，
 * 而是"从一段啰嗦的口语里抽出多个字段"。而"解析今天/下周三"这件事，
 * Todoist 的 Smart Add 早在有 AI 之前就做了，而且用户至今在抱怨它的语法难记
 * （`research/ai-competitors/horizontal-validated-autosched.md` §1）。
 *
 * 更硬的一条证据来自端侧质量基准：格式合规率都 >84%，
 * **但取值准确率没有任何模型超过 80.4%**（SOB 基准，21 个模型）。
 * 一个生产端侧应用因此从"LLM 生成完整结构化 JSON"**退化成**
 * "LLM 只写几条短提示 + 确定性回退"，它的结论是：
 * **"最可靠的端侧 LLM 功能，是 LLM 做得最少的那个功能。"**
 *
 * 所以这里的顺序是：**先把确定性规则做到最好**。
 * 规则不欠模型任何东西 —— 它可测、可解释、零成本、零出境、离线可用，
 * 而且它一旦修好就永远修好了（模型会随版本漂移，规则不会）。
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 🔴 为什么输出里必须带 `matches`（这不是可选的）
 *
 * 中文**没有词边界**。"明天" 会出现在 "明天启程" 里、"周三" 会出现在
 * "周三前交" 里 —— 规则解析的误报是**结构性的，不是可以调参消掉的**。
 * 而"误报"在这里的后果是：**用户写的字被悄悄从标题里删掉了**。
 *
 * 这正是本仓库最忌讳的失败形状（对照 AGENTS.md §7 #20：合法实体被静默丢弃 ——
 * "优雅跳过"这个正确行为替它掩盖了 bug）。所以：
 *
 *   1. **每一个被移除的片段，都对应 `matches` 里一条 `applied: true` 的记录。**
 *      **不存在"没被采纳却被移除"的片段。**（有测试钉住这条不变量）
 *   2. 调用方**必须**把 `matches` 展示给用户确认。UI 层不允许只取 `title` +
 *      `dueDate` 就直接落 op —— 那样误报就变成静默的数据改写了。
 *   3. 同一个字段出现多次时，**只有第一条被采纳**；后一条匹配**原样留在标题里**。
 *      宁可让用户看见"后天"还留在标题中，也不要把它删掉却只取一个值。
 * ═════════════════════════════════════════════════════════════════════════
 */

import type { LocalDate, LocalTime } from './date.js';
import { addDays, isoWeekday, parseLocalDate, parseLocalTime, timeOfDayMs, today } from './date.js';
import { Priority } from './entities.js';

/** 本解析器能识别的字段。刻意很小 —— 见文件头"LLM 做得最少"。 */
export type CaptureField = 'dueDate' | 'dueTime' | 'priority';

/** 一条识别结果。UI 用它渲染"我读懂了什么"，并允许用户逐条取消。 */
export interface CaptureMatch {
  field: CaptureField;
  /** 匹配到的原文片段，**原样**返回（不做任何规范化），供 UI 展示与撤销。 */
  raw: string;
  /** 该片段在输入中的起始下标。 */
  start: number;
  /** 结止下标（不含），即 `input.slice(start, end) === raw`。 */
  end: number;
  /** 人类可读的解析结果，例如 `2026-09-26`。 */
  display: string;
  /**
   * 是否被采纳（= 已从标题中移除，且取值已生效）。
   *
   * `false` 有两种可能，用 `rejected` 区分 —— UI **必须**分开呈现，
   * 否则用户分不清"系统忽略了我要的"和"系统选了别的"。
   */
  applied: boolean;
  /**
   * 用户显式忽略：**这段文字被当作普通标题文字**，不再参与解析。
   *
   * ⚠️ 它**仍然留在 `title` 里**。这正是"取消识别"与"删掉这几个字"的区别 ——
   * 后者会丢掉用户写的东西，是**不允许**的（见文件头的不变量 1）。
   */
  rejected: boolean;
  /** `field === 'dueDate'` 且被采纳时存在。 */
  dueDate?: LocalDate;
  /**
   * `field === 'dueTime'` 且被采纳时存在（`HH:MM`）。
   *
   * 🔴 它**从不单独成立**：没有采纳到日期的时刻一律 `applied: false`
   * （见 `parseCapture` 里那条 `dueTimeNeedsDate` 判定）。理由是"16:00"
   * 既可能是"今天 16:00"，也可能是"明天 16:00"，还可能是"9:16 比例"——
   * 猜一个日子比留着不动更糟。
   */
  dueTime?: LocalTime;
  /** `field === 'priority'` 且被采纳时存在。 */
  priority?: Priority;
}

/** 用户忽略掉的一条识别。传入 `options.exclude` 让解析器不要再认领它。 */
export interface CaptureExclusion {
  field: CaptureField;
  raw: string;
}

export interface CaptureParse {
  /** 原始输入，**未经任何修改**。 */
  input: string;
  /**
   * 去掉已采纳片段后的标题。
   *
   * ⚠️ **可能为空字符串** —— 用户只输入了"明天"时就是空的。
   * 空标题该不该允许提交是**交互**决策，不是数据决策：
   * 本函数不做这个判断，也不抛错（对照 `createTaskActions.create` 的注释，
   * 它对空标题抛错是因为它的调用方是程序而不是人）。
   */
  title: string;
  /** 采纳的截止日期（本地日历日）。 */
  dueDate?: LocalDate;
  /**
   * 采纳的时刻（`HH:MM`）。🔴 **只在 `dueDate` 也被采纳时才可能出现。**
   * 调用方要拿它算 epoch，用 `dueDateToEpoch(dueDate, dueTime)` ——
   * 不要自己拼，时区那一刀只允许有一处（见该函数）。
   */
  dueTime?: LocalTime;
  /** 采纳的优先级。 */
  priority?: Priority;
  /** 全部识别结果（含 `applied: false` 的），按 `start` 升序。 */
  matches: CaptureMatch[];
}

export interface CaptureOptions {
  /**
   * 时间源（epoch ms）。默认 `Date.now`。
   *
   * 必须可注入：本文件的输出**依赖"今天是几号"**，
   * 用真实时钟写测试会得到一个**过几天就变红**的测试。
   * 对照 AGENTS.md §7 #25：会随机失败的测试比没有测试更糟。
   */
  now?: number;
  /**
   * 用户显式忽略的识别。命中的规则**不再参与解析** ——
   * 那段文字会被当作普通标题文字留在 `title` 里。
   *
   * ⚠️ 按 `field + raw` 匹配，不按下标。原因是**下标会随输入编辑而失效**，
   * 而 `raw` 是稳定的。代价是同一次输入里两处相同的"明天"会被一起忽略 ——
   * 这个代价可以接受，而且它是**可见的**（两处都会变成"已忽略"）。
   */
  exclude?: readonly CaptureExclusion[];
}

/** 优先级数字 → 优先级枚举。`!1`/`p1` 最高（与 Todoist 的 p1 一致）。 */
const PRIORITY_BY_NUMBER: Record<number, Priority> = {
  1: Priority.High,
  2: Priority.Medium,
  3: Priority.Low,
  4: Priority.None,
};

const PRIORITY_LABEL: Record<Priority, string> = {
  [Priority.High]: '高',
  [Priority.Medium]: '中',
  [Priority.Low]: '低',
  [Priority.None]: '无',
};

/**
 * 中文优先级词。
 *
 * 🔴 **加这一段是被真实输入逼出来的，不是想当然。**
 * 一次真实端点实测（`pnpm verify:ai-live` + 同一个输入）暴露：
 * 「明天下午三点开周会 **高优先级**」里，规则内核**没认出「高优先级」**，
 * `priority` 是 `undefined`，而这三个字**留在了标题里**。
 *
 * 原来的规则只认 `!1`–`!4` 和 `p1`–`p4` —— 那是**英文/极客写法**。
 * 中文用户写的是「高优先级」「紧急」「重要」。**只支持前者等于不支持中文用户。**
 *
 * 每条都是**完整词**，不是单个字 —— 单字「高」会误伤「高铁」「高度」
 * （对照本文件顶部的原则：宁可少认，不可错认）。
 */
const PRIORITY_BY_WORD: readonly { readonly re: RegExp; readonly priority: Priority }[] = [
  { re: /高优先级|最高优先级|紧急|加急/g, priority: Priority.High },
  { re: /中优先级|普通优先级/g, priority: Priority.Medium },
  { re: /低优先级|不着急|不急/g, priority: Priority.Low },
];

/** 星期字符 → ISO 星期几（1=周一 … 7=周日）。 */
const WEEKDAY_CHAR: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 7,
  天: 7,
};

/**
 * 裸「N 号」的取值范围（月内日）。
 *
 * ⚠️ **这条不是守卫，是早退。** 实测（变异：整段摘掉 ⇒ 用例 0 红）：
 * 「37 号」「0 号」被拒**靠的是 `makeLocalDate` 的日期存在性校验**，
 * 不是这里的 1..31。留着它的理由只有两条，都不涉及正确性：
 * 不可能的日子不必再试满 12 个月；以及读代码的人一眼看得出上限是 31。
 * 所以**别把它当防线** —— 要改误伤面就改下面两张黑名单。
 */
const DAY_OF_MONTH_MIN = 1;
const DAY_OF_MONTH_MAX = 31;

/**
 * 「号」**后面**接这些字 ⇒ 这个「N 号」是编号/地址，不是日子。
 *
 * 每一项都对应一个真实中文说法（楼/栋/座/院/单元 → 地址，门/口/层/区/排/列 →
 * 位置编号，电/会/字/文/车/票/码/线/站/路/街/巷/弄/床/铺/船/舰/车 → 物件名）。
 * ⚠️ 刻意**不含**「中」「上」「下」「晚」「之」「那」「生」——
 * 「5 号中午」「5 号下午三点」「5 号之前」「5 号生日」都是日子，
 * 把它们挡掉的代价远大于「5 号中央大厅」这种漏网。
 */
const DAY_NUMBER_LABEL_AFTER = new Set([
  '楼',
  '栋',
  '座',
  '幢',
  '院',
  '区',
  '层',
  '门',
  '口',
  '排',
  '列',
  '线',
  '站',
  '路',
  '街',
  '巷',
  '弄',
  '室',
  '电',
  '会',
  '字',
  '文',
  '车',
  '票',
  '码',
  '牌',
  '床',
  '铺',
  '船',
  '舰',
]);

/**
 * 「N 号」**前面**接这些字 ⇒ 同样是编号（「房间 8 号」「3 单元 8 号」「第 5 号」）。
 *
 * 与上面那张表分开列是因为它们判的是**不同的字符位置**，合并会看不出漏了哪一侧。
 * 「月/日/年」在这里是必要的而不是冗余的：`M月D日` 规则会整段认领「10 月 8 号」，
 * 去重叠那一层已经挡掉了；这一条兜的是**月规则自己没匹配上**的写法
 * （「几月 5 号」—— 没有数字前缀，月规则不成立，此时「5 号」也不该被当日子，
 * 因为用户说的是一件还没定月份的事）。
 */
const DAY_NUMBER_LABEL_BEFORE = new Set([
  '月',
  '日',
  '年',
  '第',
  '房',
  '间',
  '室',
  '楼',
  '栋',
  '座',
  '床',
  '铺',
  '元',
  '号',
]);

interface Resolved {
  display: string;
  dueDate?: LocalDate;
  dueTime?: LocalTime;
  priority?: Priority;
}

interface RuleContext {
  today: LocalDate;
  /** 完整输入。给需要在 `resolve` 里自查边界的规则用（见 `M/D` 规则）。 */
  input: string;
}

interface Rule {
  field: CaptureField;
  re: RegExp;
  resolve(match: RegExpExecArray, ctx: RuleContext): Resolved | undefined;
}

/**
 * 判断某个下标前后是否构成"独立数字"边界。
 *
 * 🔴 **为什么手写而不用正则的 lookbehind（`(?<!...)`）**：
 * 本文件会跑在 **Hermes** 上（RN 移动壳），而 Hermes 的正则实现对
 * lookbehind / 命名捕获组 / Unicode 属性转义的支持是**落后且有版本差异**的。
 * 这个仓库已经因为"假定某个运行时能力存在"付出过代价
 * （AGENTS.md §7 #26：Hermes 缺 `WebAssembly`，移动端一条数据都同步不出去，
 * 而且**没有 polyfill 可装**）。正则能力属于同一类风险，
 * 而手写边界的成本只是两行 `charAt`。
 * **lookahead（`(?!...)`）支持面广得多，但为了统一也只在这里手写。**
 */
function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

/**
 * 构造并校验一个本地日历日。
 *
 * 🔴 **范围校验现在只有一处：`parseLocalDate` 自己。**
 *
 * 这里原来还有一份"`parse → toLocalDate` 往返比对"，因为那时
 * `parseLocalDate` 只校验格式，越界日期会被 `new Date` 静默进位
 * （`2026-02-30` → 3 月 2 日），所以下游必须自己再拦一次。
 *
 * 等 `parseLocalDate` 补上回读校验之后，这份下游校验就变成了**第二个权威**，
 * 而且形状是错的 —— 它假定 `parseLocalDate` 会返回一个滚过的 Date，
 * 于是新抛出的异常直接穿过 `parseCapture` 传给了调用方：
 * `parseCapture('2月30日交')` 从"解析不出来"变成了"抛错"。
 * 而用户输入里带一个不存在的日期是很常见的，不该让整条解析炸掉。
 *
 * 所以这里改成：**尝试构造，失败就返回 `undefined`** ——
 * 把"这个日期不存在"交给唯一的那处判定，本函数只负责把异常
 * 翻译成解析器该有的空结果。
 */
function makeLocalDate(year: number, month: number, day: number): LocalDate | undefined {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return undefined;
  }
  const candidate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  try {
    parseLocalDate(candidate);
    return candidate;
  } catch {
    return undefined;
  }
}

/** 本周一。ISO 星期几是 1..7，往回退 `iso - 1` 天即可。 */
function mondayOf(date: LocalDate): LocalDate {
  return addDays(date, -(isoWeekday(date) - 1));
}

/**
 * 规则表。**顺序即优先级** —— 长模式必须排在短模式前面，
 * 否则 `大后天` 会被 `后天` 先吃掉，`下下周三` 会被 `下周三` 先吃掉。
 */
const RULES: Rule[] = [
  // ── 相对日（长优先）────────────────────────────────────
  {
    field: 'dueDate',
    re: /大后天/g,
    resolve: (_m, ctx) => ({ display: addDays(ctx.today, 3), dueDate: addDays(ctx.today, 3) }),
  },
  {
    field: 'dueDate',
    re: /后天/g,
    resolve: (_m, ctx) => ({ display: addDays(ctx.today, 2), dueDate: addDays(ctx.today, 2) }),
  },
  {
    field: 'dueDate',
    re: /(?:明天|明日)/g,
    resolve: (_m, ctx) => ({ display: addDays(ctx.today, 1), dueDate: addDays(ctx.today, 1) }),
  },
  {
    field: 'dueDate',
    re: /(?:今天|今日)/g,
    resolve: (_m, ctx) => ({ display: ctx.today, dueDate: ctx.today }),
  },
  {
    field: 'dueDate',
    re: /(?:昨天|昨日)/g,
    resolve: (_m, ctx) => ({ display: addDays(ctx.today, -1), dueDate: addDays(ctx.today, -1) }),
  },
  {
    field: 'dueDate',
    re: /前天/g,
    resolve: (_m, ctx) => ({ display: addDays(ctx.today, -2), dueDate: addDays(ctx.today, -2) }),
  },

  // ── 周几（长优先：下下周 > 下周 > 本周 > 裸周）──────────
  {
    field: 'dueDate',
    re: /下下(?:周|星期|礼拜)([一二三四五六日天])/g,
    resolve: (m, ctx) => {
      const target = WEEKDAY_CHAR[m[1]!];
      if (target === undefined) return undefined;
      // 下下周的周一 = 本周一 + 14 天，再加 (target - 1)
      const d = addDays(mondayOf(ctx.today), 14 + (target - 1));
      return { display: d, dueDate: d };
    },
  },
  {
    field: 'dueDate',
    re: /下(?:周|星期|礼拜)([一二三四五六日天])/g,
    resolve: (m, ctx) => {
      const target = WEEKDAY_CHAR[m[1]!];
      if (target === undefined) return undefined;
      const d = addDays(mondayOf(ctx.today), 7 + (target - 1));
      return { display: d, dueDate: d };
    },
  },
  {
    field: 'dueDate',
    re: /(?:本|这)(?:周|星期|礼拜)([一二三四五六日天])/g,
    resolve: (m, ctx) => {
      const target = WEEKDAY_CHAR[m[1]!];
      if (target === undefined) return undefined;
      // ⚠️ 本文件的"本周X"可能**已经过去**。这是有意的：用户说"本周一"时，
      // 若今天已是周三，那件事就是**逾期**的。把它悄悄挪到下周才是篡改意图。
      const d = addDays(mondayOf(ctx.today), target - 1);
      return { display: d, dueDate: d };
    },
  },
  {
    field: 'dueDate',
    re: /(?:周|星期|礼拜)([一二三四五六日天])/g,
    resolve: (m, ctx) => {
      const target = WEEKDAY_CHAR[m[1]!];
      if (target === undefined) return undefined;
      // 裸"周三"= **最近的**那个周三，**含今天**（今天就是周三 → 就是今天）。
      // 取含今天而不是严格未来，是因为不含今天会让"周三"在周三当天跳到下周，
      // 那是用户最不会预期的一种行为。
      const delta = (target - isoWeekday(ctx.today) + 7) % 7;
      const d = addDays(ctx.today, delta);
      return { display: d, dueDate: d };
    },
  },

  // ── N 天后 ────────────────────────────────────────────
  {
    field: 'dueDate',
    re: /(\d{1,3})\s*天后/g,
    resolve: (m, ctx) => {
      const n = Number(m[1]);
      if (!Number.isFinite(n)) return undefined;
      const d = addDays(ctx.today, n);
      return { display: d, dueDate: d };
    },
  },

  // ── 绝对日期 ──────────────────────────────────────────
  {
    field: 'dueDate',
    re: /(\d{4})-(\d{1,2})-(\d{1,2})/g,
    resolve: (m) => {
      const d = makeLocalDate(Number(m[1]), Number(m[2]), Number(m[3]));
      return d === undefined ? undefined : { display: d, dueDate: d };
    },
  },
  {
    field: 'dueDate',
    re: /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/g,
    resolve: (m, ctx) => {
      const year = Number(ctx.today.slice(0, 4));
      let d = makeLocalDate(year, Number(m[1]), Number(m[2]));
      if (d === undefined) return undefined;
      // 今年的这个日子已经过了 → 顺延到明年。
      // 理由是"9 月打 1 月 5 日"几乎只能是明年的 1 月 5 日；
      // 而如果真的想表达逾期，用户会用"昨天"这类相对说法。
      if (d < ctx.today) {
        const next = makeLocalDate(year + 1, Number(m[1]), Number(m[2]));
        if (next === undefined) return undefined;
        d = next;
      }
      return { display: d, dueDate: d };
    },
  },
  {
    field: 'dueDate',
    re: /(\d{1,2})\s*号/g,
    resolve: (m, ctx) => {
      // 裸「14 号」= 月内日。这条是**最后加**的绝对日期写法，因为它在中文里
      // 天生有歧义：「37 号楼」「5 号电池」「3 号会议室」里的「N 号」是**编号**，
      // 不是日子。误伤的后果是把用户写的字从标题里删掉并挂上一个错日期，
      // 所以这里的立场和本文件一致：**宁可少认，不可错认**（见文件头）。
      //
      // 三层守卫，缺一不可（每一层都由不同的反例钉住，见 capture.spec.ts）：
      //   1. **日期存在性** —— `makeLocalDate` 判"这个月有没有这一天"，
      //      「37 号」「0 号」在这里被拒（不是靠下面那个 1..31 的早退）；
      //   2. 双侧非数字 —— 挡掉「2026 号」被切成「26 号」、以及「5 号101」；
      //   3. 前后不接编号用语 —— 挡掉「号楼/号电池/会议室」与「房间 8 号 / 单元 8 号」。
      // 守卫 3 是**黑名单**而不是白名单，这是有意的取舍：白名单（"号后面必须是
      // 交/开/去/下午…"）会把「5 号体检」「5 号见客户」这类无穷无尽的动词全漏掉，
      // 少认少到这条规则几乎没有产出；黑名单只放过"最常见的确实是日子"的形状，
      // 代价是新出现一个编号词（如「5 号站台」）时会被误认 —— 而那一处用户
      // 可以在识别条里点掉（`matches` + `exclude`，见文件头不变量 2）。
      const before = m.index > 0 ? ctx.input.charAt(m.index - 1) : '';
      const afterIdx = m.index + m[0].length;
      const after = afterIdx < ctx.input.length ? ctx.input.charAt(afterIdx) : '';
      if (isDigit(before) || isDigit(after)) return undefined;
      if (DAY_NUMBER_LABEL_BEFORE.has(before) || DAY_NUMBER_LABEL_AFTER.has(after)) {
        return undefined;
      }

      const day = Number(m[1]);
      if (!Number.isInteger(day) || day < DAY_OF_MONTH_MIN || day > DAY_OF_MONTH_MAX) {
        return undefined;
      }

      // 从**本月**开始往后找第一个"这个日子存在、且不早于今天"的月份。
      // 两个都必须查：29/30/31 号在有些月份根本不存在（不能像 `addMonths` 那样
      // 夹到月末 —— 用户说 31 号，给他 28 号是错的），而这个日子在本月往往已过。
      let year = Number(ctx.today.slice(0, 4));
      let month = Number(ctx.today.slice(5, 7));
      for (let step = 0; step < 12; step += 1) {
        const candidate = makeLocalDate(year, month, day);
        if (candidate !== undefined && candidate >= ctx.today) {
          return { display: candidate, dueDate: candidate };
        }
        month += 1;
        if (month > 12) {
          month = 1;
          year += 1;
        }
      }
      return undefined;
    },
  },
  {
    field: 'dueDate',
    re: /(\d{1,2})\/(\d{1,2})/g,
    resolve: (m, ctx) => {
      // 必须自己查边界（不用 lookbehind，见 isDigit 的注释）。
      // 拦掉的典型误报：`2026/09/26` 里的 `09/26` 与 `26/09`、
      // 网址里的 `x/26`、以及 `1/2/3` 这种多段数字。
      const before = m.index > 0 ? ctx.input.charAt(m.index - 1) : '';
      const afterIdx = m.index + m[0].length;
      const after = afterIdx < ctx.input.length ? ctx.input.charAt(afterIdx) : '';
      if (isDigit(before) || before === '/' || before === ':') return undefined;
      if (isDigit(after) || after === '/') return undefined;

      const year = Number(ctx.today.slice(0, 4));
      let d = makeLocalDate(year, Number(m[1]), Number(m[2]));
      if (d === undefined) return undefined;
      if (d < ctx.today) {
        const next = makeLocalDate(year + 1, Number(m[1]), Number(m[2]));
        if (next === undefined) return undefined;
        d = next;
      }
      return { display: d, dueDate: d };
    },
  },

  // ── 时刻（`HH:MM`）──────────────────────────────────────
  //
  // 🔴 这一条**只在认领到日期之后才成立**（判定在 `parseCapture` 末尾，
  //   名字就叫 `dueTimeNeedsDate`）。理由不是实现方便：`16:00` 单独出现时，
  //   "今天 16:00""明天 16:00""视频比例 9:16"三种意思都合法，
  //   而猜一个日子会把用户的文字**悄悄**变成一条别的数据 —— 那是本文件
  //   开头那条不变量禁止的事。所以没有日期时这条匹配 `applied: false`，
  //   文字原样留在标题里。
  {
    field: 'dueTime',
    re: /(?:[01]?\d|2[0-3]):[0-5]\d/g,
    resolve: (m, ctx) => {
      // 手写边界（不用 lookbehind，理由见 `isDigit` 那里的 Hermes 说明）。
      // 拦掉的典型误报：`12:30:45`（带秒的时刻，两侧都挨着数字/冒号 → 整条不认）、
      // `2026:09`（年:月）、版本号 `v1:20`。
      const before = m.index > 0 ? ctx.input.charAt(m.index - 1) : '';
      const afterIdx = m.index + m[0].length;
      const after = afterIdx < ctx.input.length ? ctx.input.charAt(afterIdx) : '';
      if (isDigit(before) || before === ':') return undefined;
      if (isDigit(after) || after === ':') return undefined;
      const time = parseLocalTime(m[0]);
      return time === undefined ? undefined : { display: time, dueTime: time };
    },
  },

  // ── 优先级 ────────────────────────────────────────────
  {
    field: 'priority',
    re: /!\s*([1-4])/g,
    resolve: (m) => {
      const p = PRIORITY_BY_NUMBER[Number(m[1])];
      return p === undefined ? undefined : { display: PRIORITY_LABEL[p], priority: p };
    },
  },
  {
    field: 'priority',
    // `\b` 在中文旁边是有效的：JS 的 `\w` 不含中文，
    // 所以 "任务p1" 里 `务` 与 `p` 之间确实存在词边界。
    re: /\bp([1-4])\b/gi,
    resolve: (m) => {
      const p = PRIORITY_BY_NUMBER[Number(m[1])];
      return p === undefined ? undefined : { display: PRIORITY_LABEL[p], priority: p };
    },
  },
  // 中文优先级词。**放在数字写法之后**：数字写法更明确，优先采纳它们。
  ...PRIORITY_BY_WORD.map(({ re, priority }) => ({
    field: 'priority' as const,
    re,
    resolve: () => ({ display: PRIORITY_LABEL[priority], priority }),
  })),
];

/**
 * 解析一段捕获文本。
 *
 * 纯函数：不读时钟（除 `options.now`）、不写状态、不抛错。
 *
 * @example
 * parseCapture('明天交周报 !1', { now: Date.parse('2026-09-25T10:00:00') })
 * // => { title: '交周报', dueDate: '2026-09-26', priority: Priority.High, ... }
 */
export function parseCapture(input: string, options: CaptureOptions = {}): CaptureParse {
  const base = today(options.now ?? Date.now());

  interface Candidate extends Resolved {
    field: CaptureField;
    raw: string;
    start: number;
    end: number;
    order: number;
  }

  const candidates: Candidate[] = [];

  RULES.forEach((rule, order) => {
    // 每次解析都新建正则，避免 lastIndex 在多次调用间泄漏
    // （`/g` 正则有状态，共用会是那种"第一次对、第二次错"的 bug）。
    const re = new RegExp(rule.re.source, rule.re.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(input)) !== null) {
      // 零宽匹配会让 exec 永远不前进
      if (m[0].length === 0) {
        re.lastIndex += 1;
        continue;
      }
      const resolved = rule.resolve(m, { today: base, input });
      if (resolved === undefined) continue;
      candidates.push({
        ...resolved,
        field: rule.field,
        raw: m[0],
        start: m.index,
        end: m.index + m[0].length,
        order,
      });
    }
  });

  // 排序：先按位置，再按规则顺序（长模式在前），最后按长度。
  // 位置优先保证"从左往右读"符合人的直觉。
  candidates.sort((a, b) => a.start - b.start || a.order - b.order || b.raw.length - a.raw.length);

  // 去重叠：同一段文字不能被两条规则同时认领。
  // 例如 `9/26` 同时满足 `M/D`；并且 `2026-09-26` 里的 `09-26` 不该再被认领。
  const nonOverlapping: Candidate[] = [];
  for (const c of candidates) {
    if (nonOverlapping.some((k) => c.start < k.end && k.start < c.end)) continue;
    nonOverlapping.push(c);
  }

  // 每个字段只采纳**第一条未被忽略的**匹配。
  // 被忽略（rejected）与"同字段已有更早者"是两件事，必须分开表达：
  //   - rejected  = 用户说"这段字是标题的一部分" → 不采纳，**也不移除**
  //   - 其余 false = 系统选不中它 → 不采纳，**同样不移除**
  // 两种情况都满足同一条不变量：**没被采纳的片段一定留在标题里。**
  const excluded = new Set((options.exclude ?? []).map((e) => `${e.field}\u0000${e.raw}`));

  const firstOfField = new Map<CaptureField, Candidate>();
  for (const c of nonOverlapping) {
    const isRejected = excluded.has(`${c.field}\u0000${c.raw}`);
    if (isRejected) continue;
    if (!firstOfField.has(c.field)) firstOfField.set(c.field, c);
  }

  /*
   * 🔴 `dueTimeNeedsDate`：时刻**不单独成立**。
   *
   * 把 `firstOfField` 里那条删掉，而不是在规则表里判断 —— 因为规则表看不到
   * 别的规则认了什么（它是逐条扫全文的），而"有没有日期"是**整次解析**的事实。
   * 删掉之后 `applied` 自然是 `false`，于是那条不变量自动成立：
   * **没被采纳的片段一定留在标题里**（"剪 9:16 的视频"不会被吃掉 9:16）。
   */
  const dueTimeNeedsDate = !firstOfField.has('dueDate');
  if (dueTimeNeedsDate) firstOfField.delete('dueTime');

  const matches: CaptureMatch[] = nonOverlapping.map((c) => {
    const isRejected = excluded.has(`${c.field}\u0000${c.raw}`);
    return {
      field: c.field,
      raw: c.raw,
      start: c.start,
      end: c.end,
      display: c.display,
      applied: !isRejected && firstOfField.get(c.field) === c,
      rejected: isRejected,
      ...(c.dueDate !== undefined ? { dueDate: c.dueDate } : {}),
      ...(c.dueTime !== undefined ? { dueTime: c.dueTime } : {}),
      ...(c.priority !== undefined ? { priority: c.priority } : {}),
    };
  });

  // 只移除被采纳的片段，从后往前删以免下标失效。
  let title = input;
  for (const m of [...matches].filter((x) => x.applied).sort((a, b) => b.start - a.start)) {
    // 🔴 紧跟其后的那个「的」**属于这个短语**，不是标题的一部分。
    // 中文没有词间空格，"标记 + 的 + 名词"是定语写法：「明天的会议」只删
    // 「明天」会得到「的会议」—— 用户没做错任何事，建出来的标题却是残句。
    // 英文形状（`tomorrow meeting`）不存在这个连接词，所以这条只有中文侧咬人。
    // ⚠️ 只多带一个「的」，而且只对**被采纳**的片段做 —— 未采纳的片段
    //    （同字段第二条、被 exclude 拒掉的）连它自己的「的」一起原样留着，
    //    那才是"没被采纳的片段一定留在标题里"这条不变量的完整意思。
    const end = input.charAt(m.end) === '的' ? m.end + 1 : m.end;
    title = title.slice(0, m.start) + title.slice(end);
  }
  // 合并因移除产生的空白（`明天 开会` → ` 开会` → `开会`）。
  title = title.replace(/\s+/g, ' ').trim();

  const dueDate = firstOfField.get('dueDate')?.dueDate;
  const dueTime = firstOfField.get('dueTime')?.dueTime;
  const priority = firstOfField.get('priority')?.priority;

  return {
    input,
    title,
    ...(dueDate !== undefined ? { dueDate } : {}),
    ...(dueTime !== undefined ? { dueTime } : {}),
    ...(priority !== undefined ? { priority } : {}),
    matches,
  };
}

/**
 * 把 `CaptureParse` 的采纳结果翻成 `Task` 需要的 `dueDate`（epoch ms）。
 *
 * 存在这个函数是为了**让时区转换只有一处**：`Task.dueDate` 是 epoch ms，
 * 而本文件一律用本地日历日。约定是**本地零点** ——
 * 因为"今天"视图是按 `new Date(dueDate).toDateString()` 比对日历日的，
 * 用本地零点才能让"今天到期"在本地时间的任何时刻都属于今天。
 *
 * 🔴 第二个参数是**可选的时刻**：传了就落在本地那一天几点几分，
 * 不传（或传 `undefined`）就是原来的本地零点，也就是"只到日"。
 * 这两者共用同一个字段、同一个函数 —— 加时刻**没有**新增持久化字段，
 * 也没有改"日期那一刀"的语义（`toLocalDate(ms)` 对两者给出同一个日子）。
 */
export function dueDateToEpoch(date: LocalDate, time?: LocalTime): number {
  return parseLocalDate(date).getTime() + (time === undefined ? 0 : timeOfDayMs(time));
}