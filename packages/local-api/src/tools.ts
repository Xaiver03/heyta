/**
 * 本地 API / MCP —— 契约与授权
 * =============================
 *
 * ADR-0011 的实现。这是 heyta 的**入站**面：让本机的其他程序
 * （Claude Code / Cursor / Raycast / 用户自己的脚本）读写 heyta 里的任务。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么这是**独立于 `@heyta/ai` 的一个包**
 *
 * 两个包的方向是**相反**的，信任模型也相反：
 *
 * | 包 | 方向 | 谁在请求 | 主要风险 | 默认 |
 * |---|---|---|---|---|
 * | `@heyta/ai` | **出站** | 我们发给模型 | 把用户数据送出去 | 关 |
 * | `@heyta/local-api` | **入站** | 别的程序打进来 | 别的程序把数据读走 / 乱写 | 关 |
 *
 * 把两者放进同一个包会**在类型层面把"我们发数据出去"和"别人拉数据进来"混在一起** ——
 * 那正是最容易配错的地方（例如把 AI 的"允许远程"开关误当成"允许本机程序访问"）。
 * 分开之后，"回退不得跨越隐私边界"（ADR-0010）与"加密条目不可读"（本包）
 * 各自只有一个地方能出错。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ## 设计照抄自 Joplin 与 Bear（证据见 research/e2ee-apps-ai.md）
 *
 * **Joplin 给的是一条可执行的形状**：
 * - 两个开关都**默认关**（AI 与本机工具访问分开控制）
 * - MCP 的 11 个工具**全部默认关**，逐个开
 * - 只监听 `127.0.0.1`
 * - 用 token 防**本机其他程序**（不是防网络攻击 —— 它压根不出机器）
 *
 * **Bear 给的是一条不可商量的底线**：
 * > "Encrypted notes stay encrypted. They can be listed, but never read or
 * >  modified by any of these tools."
 *
 * 也就是：**能看见"有这条"，看不见"这条写了什么"。**
 *
 * ⚠️ 本文件**不实现 HTTP 服务**。按 ADR-0003，`apps/*` 只放平台差异，
 * 业务逻辑在 `packages/`。这里只定义**授权判定**，
 * 真正监听端口、解析 JSON-RPC 的是壳。这样"授权规则"只有一份实现，
 * 而"怎么暴露"可以每个平台不同。
 *
 * ## 文件划分（2026-10-03 的 pack 接缝）
 *
 * ```text
 * tools/shared.ts    底层件：工具/条目类型 · 投影 · list_tasks 日期参数 · 写入意图类型
 * tools/<entity>.ts  一个实体一个文件：目录条目 + 参数 schema + 读分支 + 写分支
 * tools/pack.ts      上面那些文件要实现接缝
 * tools/registry.ts  聚合：目录顺序的唯一规则 + 注册不齐的响亮失败
 * tools.ts           本文件：配置校验 + 逐工具授权
 * ```
 *
 * 为什么要拆：以前加一个工具要改**五处**（这里的目录条目、`mcp.ts` 的 schema、
 * `server.ts` 的两个 switch、`packages/app-host` 的 `submitIntent()`），
 * 五处互相独立、漏掉任何一处的症状都是同一句"这个工具不存在"。
 *
 * ⚠️ 本文件**向下不依赖 pack**：所有 pack 相关的东西经 `./tools/registry.js` 聚合，
 * 方向永远是 `shared ← pack ← registry ← 这里`。**不许反向 import** ——
 * `tools/<entity>.ts` 里出现 `from '../tools.js'` 就是循环 import 的开始。
 */

import { findTool } from './tools/registry.js';
import type { LocalApiTool } from './tools/shared.js';

// 契约底层件与工具目录：从本文件转发出去。
// ⚠️ 这里加一个导出件，`index.ts` 的出口就跟着加一个 —— 那两个出口**必须同步**，
// 否则宿主侧 `import { … } from '@heyta/local-api'` 会在**消费方**报"没有这个导出"，
// 而生产方一路绿灯（`tools.ts` 有、`index.ts` 没转发 = 运行时 undefined）。
export {
  DEFAULT_LIST_LIMIT,
  LIST_TASKS_MAX_DUE_SPAN_DAYS,
  MAX_TASK_CHECKLIST_ITEM_LENGTH,
  MAX_TASK_CHECKLIST_ITEMS,
  MAX_TASKS_PER_BATCH_COMPLETE,
  MAX_TASKS_PER_BATCH_PRIORITY,
  MAX_TOOLS_PER_ENTITY,
  MAX_TOOLS_PER_ENTITY_BY_TYPE,
  TOOL_ENVELOPE_EGRESS_FIELDS,
  calendarDaysBetween,
  clampListLimit,
  maxToolsPerEntity,
  parseCalendarDay,
  parseTimeOfDay,
  projectAllForTool,
  projectForTool,
  projectListForTool,
  readItemForTool,
  readListTasksDueArgs,
} from './tools/shared.js';
export type {
  CalendarDay,
  ListTasksDueArgs,
  ListTasksDueArgsVerdict,
  LocalApiItem,
  LocalApiTool,
  LocalApiWriteIntent,
  LocalApiWritePort,
  LocalApiWriteResult,
  LocalApiWrittenEntityType,
  ReadVerdict,
  ToolBudgetEntityType,
  TimeOfDay,
  ToolKind,
} from './tools/shared.js';

export { LOCAL_API_TOOLS, findTool, toolNames } from './tools/registry.js';

// ─────────────────────────────────────────────────────────────────────────
// 倒数日 / 纪念日（`EVENT`）的投影 —— 与上面**同一套规则**，不是第二套
// ─────────────────────────────────────────────────────────────────────────

/**
 * 喂给 `list_events` / `get_event` 的一条倒数日。
 *
 * 🔴 形状刻意照 `LocalApiItem`：**"存在"与"内容"是两件事**这条立场
 * 只允许有一份实现，两个实体各自表达一遍就会各漂各的。
 *
 * 字段名口径与 `packages/shared-schema` 一致（`date` / `kind` / `isLunar` / `notes`）；
 * `nextOccurrence` 与 `daysFromToday` 是**派生值**（先例：`project.taskCount`），
 * 由宿主用领域层的 `nextEventOccurrence` / `eventDaysFromToday` 算好 ——
 * 🔴 本包**不做日历算术**（零依赖，也不许在这里长出第二套"下一次是哪天"的判断，
 * 那个判断的唯一归属是 `packages/domain/src/events.ts`）。
 */
export interface LocalApiEventItem {
  id: string;
  title: string;
  /** 锚点日期 `YYYY-MM-DD`。倒数日没有"几点"，所以不是时间戳。 */
  date: string;
  /**
   * 类型档位。**由领域层单点判定**（用户选过就照他说的，没选才按日期方向兜底）。
   *
   * ⚠️ 这里是 `string` 而不是字面量联合，**与 `LocalApiItem.priority` 同一取舍**：
   * 本包零依赖，把 `countdown / anniversary / birthday / festival` 抄一份进来
   * 就是词表的**第二份定义**，而领域层加一档时这里不会红（它只会一直"少一档"）。
   * 谁认识这四个值：`packages/domain` 的 `CountdownEventKind`，
   * 判定与校验点在 `packages/app-host/src/local-api-host.ts`。
   */
  kind: string;
  /** 下一次发生日。**一次性且已过 ⇒ 缺席**（不是 `null`、不是"今天"）。 */
  nextOccurrence?: string;
  /** 正 = 还有 N 天，负 = 已经 N 天，0 = 就是今天。 */
  daysFromToday: number;
  /** 是否每年/按规则重复。 */
  repeating: boolean;
  /** 重复时按农历锚点推。 */
  isLunar: boolean;
  /** 置顶（就是 `pinnedAt` 有值，没有第二个字段）。 */
  pinned: boolean;
  /** 备注正文。🔴 只在 `get_event` **且** `readable` 为真时出现。 */
  notes?: string;
  /** 这条能不能被本机工具读到正文。逐条判定，不是逐库。 */
  readable: boolean;
}

/**
 * `list_events` 专用的**再窄一层**投影：连可读条目的备注也不出。
 *
 * ⚠️ 这里**刻意没有**对应 `projectForTool` 的"单条投影"函数 —— 不是漏了，是
 * 倒数日的单条路径**不剥正文，而是直接拒绝**（{@link readEventForTool}）。
 * 加一个"可读就原样返回、不可读就剥掉"的函数会造出**第二个**执行点，
 * 而那个执行点在产品里永远走不到（`get_event` 对不可读条目根本不会返回条目）。
 * 与任务侧的差别只在 `get_task` 用的就是那条 —— 两边各按自己的调用图留件。
 *
 * 🔴 照 `projectListForTool` 的样子做，理由逐字相同：目录描述与 `egressFields`
 * 都承诺"列表里没有正文"，而宿主侧 `listEvents` 与 `getEvent` 用的是**同一个**
 * `eventToItem`。不窄这一层，那句承诺就是空话 —— 而 `list_tasks` 上
 * 恰恰是这么被抓现行的（见 `projectListForTool` 的注释与 W10 判据）。
 */
export function projectEventListForTool(
  items: readonly LocalApiEventItem[],
): readonly LocalApiEventItem[] {
  // 逐条**重建**成元数据形状（白名单，不是 `delete`）：
  // 列表要的是"连可读条目的正文也没有"，所以每条都得走这一遍。
  return items.map(eventMetadata);
}

/** 倒数日的**元数据白名单**（正文类字段一律不在这里）。 */
function eventMetadata(item: LocalApiEventItem): LocalApiEventItem {
  const meta: LocalApiEventItem = {
    id: item.id,
    title: item.title,
    date: item.date,
    kind: item.kind,
    daysFromToday: item.daysFromToday,
    repeating: item.repeating,
    isLunar: item.isLunar,
    pinned: item.pinned,
    // `readable` **照抄**：受保护的条目仍然说"有我，但不给你看"（这正是 Bear 那句）
    readable: item.readable,
  };
  if (item.nextOccurrence !== undefined) meta.nextOccurrence = item.nextOccurrence;
  // 🔴 `notes` 在这里**故意不被复制** —— 这就是整件事的目的。
  return meta;
}

/**
 * `get_event` 专用：不可读的倒数日**明确报错**，不是返回一个"没有备注"的空结果。
 * 与 `readItemForTool` 同一取舍（见它上面的说明）。
 */
export type EventReadVerdict =
  | { ok: true; item: LocalApiEventItem }
  | { ok: false; reason: 'not-readable'; message: string };

export function readEventForTool(item: LocalApiEventItem): EventReadVerdict {
  if (item.readable) return { ok: true, item };
  return {
    ok: false,
    reason: 'not-readable',
    message:
      `倒数日「${item.title}」受保护，本机工具只能看到它存在，不能读取备注内容。` +
      '这是设计如此，不是错误。',
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 配置与授权
// ─────────────────────────────────────────────────────────────────────────

/**
 * 本机 API 配置。
 *
 * 三个字段各有一次"默认必须是安全值"：
 * - `enabled: false` —— 不打开就不存在这个面
 * - `bindAddress` 只允许回环（见 `validateLocalApiConfig`）
 * - `token` 打开时**必须非空**（见下）
 */
export interface LocalApiConfig {
  enabled: boolean;
  /**
   * 监听地址。
   *
   * ⚠️ 默认 `127.0.0.1`。**类型上不阻止写别的，但 `validateLocalApiConfig`
   * 会拒绝一切非回环地址** —— 因为监听 `0.0.0.0` 等于把用户全部任务
   * 暴露给同一网络里的任何人，而"本机 API"这个名字会让用户以为它是本机的。
   */
  bindAddress: string;
  port: number;
  /**
   * 🔴 显式 token，**打开时必须非空**。
   *
   * 它防的**不是**网络攻击（服务不出机器），而是**本机其他程序**：
   * 没有 token 的话，用户装的任何一个程序、浏览器里的任何一个页面
   * 都能直接打 `http://127.0.0.1:PORT` 读走任务。
   *
   * 对照 Joplin：同样"token guards against local programs"。
   */
  token?: string;
  /**
   * 逐工具授权。**未列出的工具一律视为关闭。**
   *
   * 值允许 `undefined` 不是松一口子：判定是 `=== true`（fail-closed），而判据必须能
   * 表达"键存在、值是 undefined"这一档 —— 它挡的是"有人把判定改成 `name in grants`"。
   */
  grants?: Readonly<Record<string, boolean | undefined>>;
}

export const DEFAULT_LOCAL_API_CONFIG: LocalApiConfig = {
  enabled: false,
  bindAddress: '127.0.0.1',
  port: 47_119,
};

/** 配置被拒绝的原因。 */
export type LocalApiConfigError = {
  ok: false;
  reason: 'not-loopback' | 'token-required' | 'bad-port';
  message: string;
};

export type LocalApiConfigVerdict = { ok: true } | LocalApiConfigError;

/**
 * 校验配置。
 *
 * 🔴 它**只在 `enabled === true` 时**校验 token 与地址 ——
 * 关着的时候允许配置不完整（用户可以先填一半再打开）。
 * 这避免了"想先存个草稿却被拦"的烦人体验，同时保证
 * **真正开始监听的那一刻配置一定是安全的**。
 */
export function validateLocalApiConfig(config: LocalApiConfig): LocalApiConfigVerdict {
  if (!config.enabled) return { ok: true };

  // 端口范围：0 是"随机端口"，对固定 token 的服务没意义，拒绝掉。
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65_535) {
    return {
      ok: false,
      reason: 'bad-port',
      message: `端口必须是 1–65535 的整数，当前是 ${String(config.port)}。`,
    };
  }

  if (config.token === undefined || config.token.trim() === '') {
    return {
      ok: false,
      reason: 'token-required',
      message:
        '打开本机 API 必须设置一个访问 token。' +
        '没有 token 的话，这台机器上的任何程序都能读走你的全部任务。',
    };
  }

  if (!isLoopbackAddress(config.bindAddress)) {
    return {
      ok: false,
      reason: 'not-loopback',
      message:
        `只允许监听回环地址（127.0.0.1 / ::1 / localhost），拒绝了「${config.bindAddress}」。` +
        '监听其他地址会把你的任务暴露给同一网络里的其他人 —— ' +
        '如果你确实想这样，正确的做法是用你自己的反向代理，而不是让 heyta 直接对外监听。',
    };
  }

  return { ok: true };
}

/**
 * 判断一个监听地址是不是回环。
 *
 * ⚠️ 与 `@heyta/ai` 的 `isLoopbackEndpoint` **刻意不共用**：
 * 那个函数处理的是**完整 URL**（端点是 `http://host:port/path`），
 * 这个处理的是**裸主机/地址**。共用会诱使某一方放宽自己的规则
 * （例如为了复用而允许 `localhost:11434` 这种带端口的字符串），
 * 而放宽的方向通常是**不安全**的那一边。
 *
 * 🔴 特别处理 `0.0.0.0` 与 `::`：它们是"绑定所有网卡"，
 * 最容易被误当成"本机"（字面上像"所有地址"，直觉上像"随便"）。
 * 必须显式拒绝。
 */
export function isLoopbackAddress(address: string): boolean {
  const host = address.trim().toLowerCase().replace(/^\[|\]$/g, '');

  if (host === '0.0.0.0' || host === '::' || host === '*') return false;
  if (host === 'localhost' || host === '::1') return true;

  // 127.0.0.0/8 全部是回环，不只是 127.0.0.1
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4 !== null) {
    const octets = [ipv4[1], ipv4[2], ipv4[3], ipv4[4]].map(Number);
    if (octets.some((o) => o > 255)) return false;
    return octets[0] === 127;
  }

  return false;
}

// ─────────────────────────────────────────────────────────────────────────
// 工具调用授权
// ─────────────────────────────────────────────────────────────────────────

export type ToolCallDenialReason =
  | 'api-disabled'
  | 'token-missing'
  | 'token-mismatch'
  | 'tool-unknown'
  | 'tool-not-granted';

export type ToolCallVerdict =
  | { allowed: true; tool: LocalApiTool }
  | { allowed: false; reason: ToolCallDenialReason; message: string };

/**
 * 判定一次工具调用能不能执行。
 *
 * 顺序即**检查顺序**，且顺序是有意义的：
 * 1. 总开关 —— 关着就什么都不存在
 * 2. 配置合法性（token 必须存在）—— 配置坏了不该继续
 * 3. token 匹配 —— **在知道"哪个工具"之前就验**，避免通过错误信息探测工具是否存在
 * 4. 工具存在
 * 5. 该工具被授权
 *
 * 🔴 第 3 步放在第 4 步之前是刻意的：先验身份、再谈权限。
 * 反过来的话，一个没带 token 的调用方可以通过"未知工具"与"未授权工具"
 * 两种不同错误，**枚举出 heyta 到底提供了哪些工具**。
 *
 * ⚠️ token 比较用**定长比较**（`timingSafeEqual` 风格的逐字符累积），
 * 不用 `===`：后者会在第一个不同字符处提前返回，理论上可被计时探测。
 * 对 localhost 场景这是偏执，但它的成本是零。
 */
export function authorizeToolCall(
  config: LocalApiConfig,
  toolName: string,
  presentedToken: string | undefined,
): ToolCallVerdict {
  if (!config.enabled) {
    return {
      allowed: false,
      reason: 'api-disabled',
      message: '本机 API 未启用。',
    };
  }

  // 🔴 这里**刻意只查 token**，不查整个配置。
  //
  // 第一版调的是 `validateLocalApiConfig(config)`，于是**端口也参与了鉴权**：
  // 一份 token 完全正确、但端口写成 0 的配置会让**每一次工具调用都被拒**，
  // 而报错说的是"未启用"—— 排查方向完全被带偏。
  //
  // 端口是**监听**的属性，不是**鉴权**的属性；它只该在
  // `startLocalApiServer` 里被检查一次（那里查错了才是真的起不来）。
  if (config.token === undefined || config.token.trim() === '') {
    return {
      allowed: false,
      reason: 'token-missing',
      message: '本机 API 需要访问 token。',
    };
  }

  const expected = config.token;
  if (presentedToken === undefined || !constantTimeEquals(presentedToken, expected)) {
    return {
      allowed: false,
      reason: 'token-mismatch',
      message: '访问 token 不正确。',
    };
  }

  const tool = findTool(toolName);
  if (tool === undefined) {
    return {
      allowed: false,
      reason: 'tool-unknown',
      message: `没有名为「${toolName}」的工具。`,
    };
  }

  if (!isToolGranted(config.grants, toolName)) {
    return {
      allowed: false,
      reason: 'tool-not-granted',
      message: `工具「${toolName}」没有被授权。本机工具默认全部关闭，需要在设置里逐个打开。`,
    };
  }

  return { allowed: true, tool };
}

/**
 * 工具是否被用户授权。**未列出 = 关闭。**
 *
 * 🔴 抽出来是因为**判据只能有一份**（不变量 19）。
 * 现在有**两个调用方**要用这条判断：
 *
 * | 调用方 | 为什么不能直接复用 `authorizeToolCall` |
 * |---|---|
 * | MCP / 本机 API | 它还要验会话：总开关、token、工具是否存在 |
 * | **heyta 自己的 AI**（`@heyta/app-host` 的 AI 工具路径） | 那是**进程内**调用：没有 listener、没有 token —— 那两道闸在这里不成立，硬套就得伪造一个 token |
 *
 * 所以把「授权」这一条单独拿出来给两边共用；`authorizeToolCall` 仍然是
 * 它加会话闸的组合。这样"同一个工具在两个入口被两套规则判定"这件事**不会发生**。
 *
 * ⚠️ **它不检查工具是否存在** —— 不存在的工具在 `grants` 里也不会是 `true`，
 * 所以返回 `false` 是安全的（fail-closed）。调用方若要区分"不存在"与"未授权"，
 * 得自己先 `findTool()`：MCP 侧刻意这么做，为的是**不泄露工具目录**。
 */
export function isToolGranted(grants: LocalApiConfig['grants'], toolName: string): boolean {
  return grants?.[toolName] === true;
}

/**
 * 定长比较。
 *
 * 长度不同时**不提前返回** —— 先累积全部差异再判断，
 * 让耗时与"第几个字符不同"无关。
 */
function constantTimeEquals(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i += 1) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}
