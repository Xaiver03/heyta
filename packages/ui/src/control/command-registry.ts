/**
 * 命令登记表（action registry）—— 全局命令面板的数据层
 * ==================================================
 *
 * 覆盖图谱 #6「全局命令面板」缺的那一半：heyta 此前 `⌘K` 只是**搜索**，
 * 没有一张「可执行的动作表」。这一份把「有哪些动作」从「面板怎么画」里拆出来。
 *
 * ## 分工（与 `control/menu.ts`、`control/states.ts` 同一条铁律）
 *
 * · **本文件只有数据与纯判断**：登记 / 注销 / 取列表、按查询过滤、光标位移。
 *   它不 import React、不碰 DOM、不认识 i18n，也不包含任何业务动作 ——
 *   `run` 是实现，由**宿主**在绑定层注入（见 `apps/web` 的装配）。
 * · 所以它可以被**穷举测**：过滤是否大小写无关、多词是否 AND、光标越界怎么绕，
 *   全部在这里答完，各端没有"再解释一遍"的余地。
 *
 * ## 为什么 `title` 是字符串而不是 key
 *
 * 面板的搜索要匹配**用户看到的那句字**。若这里存 key，过滤就得先反查 i18n，
 * 而 i18n 是渲染期的（跟随语言变化）—— 把这两种生命周期混进来，就会得到
 * "切了语言、搜索还按旧语言匹配"那种只在切换后出现的缺陷。
 * 于是：**宿主用当前语言把 `title` 算好再登记**，本文件只对算好的字符串做匹配。
 *
 * ## 为什么是 upsert 而不是 add
 *
 * 命令是**声明式**的（视图一多，同一批命令每次语言切换/依赖变化都会重建一份）。
 * 若 `register` 变成 append，重建就会把同一 id 堆成十几条。按 id upsert：
 * 后登记者覆盖前一条，且**保持它原来的位置**（Map 的语义），列表顺序因此稳定。
 */

/** 一条可执行命令。`run` 是绑定层注入的实现，本文件从不调用它。 */
export interface Command {
  /** 稳定 id（单一面板内唯一）。重复登记按 id 覆盖。 */
  readonly id: string;
  /** 已经是**当前语言**的可见标题（匹配用它，渲染也用它）。 */
  readonly title: string;
  /** 分组 id（面板按它分组显示的顺序即列表顺序）。 */
  readonly group: string;
  /** 额外的匹配词（英文键名等），**不是**给用户看的文案。 */
  readonly keywords?: readonly string[];
  /** 触发这条命令的键位（仅用于「快捷键一览」展示，形如 `Meta+Shift+P`）。 */
  readonly keys?: readonly string[];
  /** 真正执行的动作（由宿主提供）。 */
  readonly run: () => void;
}

export interface CommandRegistry {
  /** 登记或覆盖一条命令（按 id upsert）。 */
  register(command: Command): void;
  /** 注销一条命令；不存在的 id 静默忽略。 */
  unregister(id: string): void;
  /** 当前全部命令（登记顺序）。 */
  list(): readonly Command[];
  /** 按 id 取一条。 */
  get(id: string): Command | undefined;
  /** 清空（切项目 / 卸载时用）。 */
  clear(): void;
}

/**
 * 造一个命令登记表。
 *
 * 🔴 空 id **当场抛**，不是静默收下：一个没有 id 的命令无法注销、也无法去重，
 * 它的症状是"每次重建都多一条、点哪条都一样"，而那要等人去点才发现。
 * 抛在装配时刻（面板第一次构建），比留一个幽灵入口便宜得多。
 */
export function createCommandRegistry(): CommandRegistry {
  const commands = new Map<string, Command>();
  return {
    register(command) {
      const id = command.id.trim();
      if (id === '') throw new Error('命令 id 不能为空：空 id 无法注销也无法去重');
      // Map 对**已存在**的键 set 时保留其插入位置 —— 这正是"重建不掉序"要的语义。
      commands.set(id, command);
    },
    unregister(id) {
      commands.delete(id);
    },
    list() {
      return [...commands.values()];
    },
    get(id) {
      return commands.get(id);
    },
    clear() {
      commands.clear();
    },
  };
}

/** 光标"不在任何一项上"（还没输入 / 结果为空）—— 与搜索光标的同一格。 */
export const COMMAND_CURSOR_NONE = -1;

/**
 * 按查询过滤命令。
 *
 * 规则（每条都有对应单测）：
 * · 空查询（或纯空白）⇒ 原样返回**全部**（面板一打开就能看到动作，而不是一片空白）；
 * · 空白分隔的多个词是 **AND**（每个词都要命中）；
 * · 一个词命中标题或任一 keyword 即可，**大小写无关**；
 * · 返回顺序 = 入参顺序（分组顺序由宿主的登记顺序决定，不在这里重排）。
 */
export function filterCommands(commands: readonly Command[], query: string): Command[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (normalized === '') return [...commands];
  const tokens = normalized.split(/\s+/).filter((token) => token !== '');
  return commands.filter((command) => {
    const haystacks = [command.title, ...(command.keywords ?? [])].map((text) =>
      text.toLocaleLowerCase(),
    );
    return tokens.every((token) => haystacks.some((text) => text.includes(token)));
  });
}

/**
 * 光标走一步（↑ = -1 / ↓ = +1），两端环绕。
 *
 * 🔴 `COMMAND_CURSOR_NONE` 两个方向**不对称**（与 `control/menu.ts` 的
 * `stepFrom` 同一条理由）：还没选中时按 ↓ 落到第一项、按 ↑ 落到最后一项。
 * 写成 `(index + delta + count) % count` 会把 ↑ 那一下送到第一项 ——
 * 读起来就是"方向键反了"。
 */
export function moveCommandCursor(index: number, count: number, delta: -1 | 1): number {
  if (count <= 0) return COMMAND_CURSOR_NONE;
  if (index === COMMAND_CURSOR_NONE) return delta === 1 ? 0 : count - 1;
  return (index + delta + count) % count;
}
