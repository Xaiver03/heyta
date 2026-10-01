/**
 * Windows PWA widget 的**纯逻辑**：tag 映射、点击解析、意图日志上限、页面↔SW 消息协议。
 * ==================================================================================
 *
 * ## 🔴 为什么这里没有"合并"逻辑
 *
 * Android / iOS 上，组件进程会把点击**合并**进一个队列（`mergeIntent`，last-wins，
 * "先折叠再截断"）。这里**刻意不合并** —— 服务 worker 只维护一个**追加式**点击日志。
 *
 * 理由：合并语义是 `@heyta/widget-core` 的 `mergeIntent`，**四端共用一份**。
 * 在 service worker 里再写一遍（它不能直接 import 那个包）就会有两份实现，
 * 而漂移的表现是"某个平台的点击偶尔不回滚" —— 极难发现。
 *
 * 那追加式为什么**同样正确**？因为 `mergeIntent` 是 **last-wins**：
 * 同一个 `taskId` 的多次点击，只有**最后一次**有效。所以
 *
 * - 按顺序重放整个日志 ≡ 合并后的队列（应用在 drain 时用 `mergeIntent` 做这件事）；
 * - **从头部丢弃**永远安全 —— 丢掉的是同一些更早的点击，而更早的本来就会被更晚的覆盖。
 *
 * 唯一的残余损失：如果超过上限的**不同**任务各自只点了一次，最早那些会丢。
 * 上限取 500（正常用户在一次应用打开之间点不到 500 次），并且**不静默** ——
 * 丢弃时会打日志。见 `appendClick`。
 *
 * ⚠️ 这与"先折叠再截断"那条纪律**不矛盾**：那条针对的是**已经折叠过的队列**
 * （在折叠后的队列上直接截断会随机丢掉某些任务）。这里是**未折叠的原始日志**，
 * 从头部丢是良定义的。
 */

import { ADAPTIVE_CARD_KINDS } from '@heyta/widget-core';
import type { AdaptiveCardKind } from '@heyta/widget-core';

/**
 * widget tag 前缀。
 *
 * 🔴 `tag` 是**刷新时的定位键**：`widgets.updateByTag('heyta-today', { data })`。
 * 拼错一个字符不会报错 —— `updateByTag` 只是**什么都不更新**，
 * 而组件就永远停在那里显示旧数据。所以拼法只有这一处，且 manifest 由脚本生成、
 * 与这里共用同一个函数（见 `scripts/gen-pwa.mjs`）。
 */
export const WIDGET_TAG_PREFIX = 'heyta-';

export function widgetTag(kind: AdaptiveCardKind): string {
  return `${WIDGET_TAG_PREFIX}${kind}`;
}

export function kindFromTag(tag: string): AdaptiveCardKind | null {
  if (!tag.startsWith(WIDGET_TAG_PREFIX)) return null;
  const kind = tag.slice(WIDGET_TAG_PREFIX.length);
  return (ADAPTIVE_CARD_KINDS as readonly string[]).includes(kind)
    ? (kind as AdaptiveCardKind)
    : null;
}

// ─────────────────────────────────────────────────────────────────────
// 点击
// ─────────────────────────────────────────────────────────────────────

/** 一条**原始**点击（未合并）。字段与 `WidgetIntent` 一致，但不含合并语义。 */
export interface RawWidgetClick {
  taskId: string;
  targetIsDone: boolean;
  at: number;
}

/**
 * 追加日志的上限。
 *
 * ⚠️ 取 500 而不是契约里的 `WIDGET_INTENT_MAX`（50）：50 是**合并后**队列的上限，
 * 而这里是**未合并**的原始日志 —— 同一个任务点 10 次会占 10 条。
 * 用 50 会让"反复点同一个任务"把别的任务的点击挤掉。
 */
export const SW_CLICK_LOG_MAX = 500;

/**
 * 解析 `widgetclick` 带过来的 `data`。
 *
 * ## 🔴 为什么校验要**这么严**
 *
 * 这个 `data` 来自组件宿主（Edge），内容最终由 Adaptive Card 模板的
 * `Action.Execute.data` 决定 —— 但**它是一次外部输入**，不能当可信：
 *
 * - `taskId` 必须是**非空字符串**。给 undefined 会让应用去 drain 一条
 *   `taskId: undefined` 的意图，最后落到 op 构造里 —— 而 op 构造必须有真实 id。
 * - `targetIsDone` 必须是**真正的布尔**，不能 `Boolean(x)` 一把梭 ——
 *   Adaptive Card 的绑定把未解析的 `${targetIsDone}` **原样当字符串**传过来，
 *   而 `Boolean('false') === true` → **点一下"完成"，任务被标记成完成，再点一下还是完成**。
 *   这是四端都会踩的同一个坑（Swift 那边是 `NSNumber` 桥接）。
 */
export function parseWidgetClick(data: unknown, now: number): RawWidgetClick | null {
  if (!data || typeof data !== 'object') return null;
  const raw = data as Record<string, unknown>;

  const taskId = raw.taskId;
  if (typeof taskId !== 'string' || taskId.length === 0) return null;

  const targetIsDone = raw.targetIsDone;
  if (typeof targetIsDone !== 'boolean') return null;

  return { taskId, targetIsDone, at: now };
}

/**
 * 把一条点击追加进日志。超过上限时**从头部丢弃**并返回是否丢了。
 *
 * ⚠️ 返回值存在的意义：丢弃是**有损**的，调用方应当留一条日志。
 * 一个静默丢弃的队列会让"我的点击偶尔不见了"变成一个无法归因的 bug。
 */
export function appendClick(
  log: readonly RawWidgetClick[],
  click: RawWidgetClick,
): { log: RawWidgetClick[]; dropped: number } {
  const next = [...log, click];
  if (next.length <= SW_CLICK_LOG_MAX) return { log: next, dropped: 0 };
  const dropped = next.length - SW_CLICK_LOG_MAX;
  return { log: next.slice(dropped), dropped };
}

// ─────────────────────────────────────────────────────────────────────
// 页面 → SW 的消息协议
// ─────────────────────────────────────────────────────────────────────

/**
 * 页面把**算好的 Adaptive Card 数据**交给 SW。
 *
 * ## 🔴 为什么是页面算，而不是 SW 自己从加密快照算
 *
 * 两个原因，第二个是决定性的：
 *
 * 1. **密钥不在 SW 里**。设备密钥由页面持有（IndexedDB + WebCrypto 的
 *    **不可导出** `CryptoKey`），SW 拿不到也不该拿。
 * 2. **Adaptive Card 宿主只吃明文 JSON** —— 模板是声明式的，不能跑 JS，
 *    所以"把密文交给组件、让组件解密"这条路上根本没有解密的一侧。
 *    解密只能在推数据之前完成，而能解密的那一侧是页面。
 *
 * ⚠️ 这带来一个**必须在产品说明里讲清的边界**：Windows 上，组件数据
 * 以**明文**经过一次进程/IPC 边界交给系统组件宿主。iOS / Android 上解密发生在
 * 组件进程内部（宿主只看到渲染结果），这里多了一次明文交接。
 * **不是"加密坏了"，是平台能力边界** —— 记在账本里。
 */
export interface WidgetDataMessage {
  type: 'heyta:widget-data';
  kind: AdaptiveCardKind;
  data: unknown;
  /**
   * 这一款的**占位态**（"打开 Heyta 以显示小组件"），由页面**预先渲染成数据**。
   *
   * 🔴 为什么 SW 不自己拼那句话：词条表在 `@heyta/i18n`，把它 import 进 SW
   * 会把**全部语言的全部界面文案**打进 `public/sw.js`（它是每次 SW 启动都要
   * 加载的文件）。而"占位文案该是什么语言"这个判断，页面在推数据时**已经做过一次** ——
   * 存成品保证占位态与数据**同一语言**，不会出现"数据是英文、半夜过期后变中文"。
   */
  placeholder: unknown;
  /** 这份数据属于哪一天（应用算的，**不是** SW 推的）。 */
  dayStr: string;
  /** 这份数据什么时候开始不可信 = **下一个本地零点**（应用算的）。 */
  validUntil: number;
}

/**
 * 缓存的组件数据 + 它的**新鲜度**信息。
 *
 * ## 🔴 为什么必须带着 `validUntil` 一起存 —— 这是 Windows 上最危险的一个缺口
 *
 * iOS / Android 的组件**每次渲染都会自己判** `now >= validUntil`，
 * 于是过期的组件会**自己**降级成"数据已过期，打开 Heyta 刷新"。
 * 那份判定在原生渲染路径上，应用**不需要活着**。
 *
 * Windows 没有这一层：Adaptive Card 是**静态 JSON**，宿主只会把我们最后推的
 * 那份原样画出来。于是如果没有这个字段，一台三天没打开的 Windows 电脑上的
 * "今日任务"组件会**一直显示三天前的任务列表** —— 而且它看起来完全正常。
 *
 * 这正是本项目从头到尾在防的那类缺陷（组件骗用户说"今天没有任务"、
 * 用过期的任务列表装作今天）。修法：SW 在**响应 `data` 请求**时判一次新鲜度
 * （见 `sw.ts` 的 fetch 分支）—— 那是 Windows 上唯一一个"应用不在也能跑"
 * 的判定点。
 */
export interface WidgetDataRecord {
  kind: AdaptiveCardKind;
  data: unknown;
  /** 过期时该显示什么（页面预渲染的占位态，见 `WidgetDataMessage.placeholder`）。 */
  placeholder: unknown;
  dayStr: string;
  validUntil: number;
  /** 推送时刻。**只用于诊断**，不参与判定。 */
  pushedAt: number;
}

/** 这份缓存还值不值得信？判据与原生三端**逐字相同**：`now >= validUntil`。 */
export function isRecordStale(record: WidgetDataRecord, now: number): boolean {
  if (!Number.isFinite(record.validUntil)) return true;
  return now >= record.validUntil;
}

/** 页面请求 SW 立刻用缓存的（或刚推的）数据刷新一款组件。 */
export interface WidgetRefreshMessage {
  type: 'heyta:widget-refresh';
  kind: AdaptiveCardKind;
}

/** 页面请求排空点击日志。**返回通过 `event.ports[0]`**（MessageChannel）。 */
export interface WidgetDrainMessage {
  type: 'heyta:widget-drain';
}

/**
 * 页面把**执行失败**的意图写回日志。
 *
 * ## 🔴 为什么必须有这一条
 *
 * drain 是"读出来 + 清空"，执行在**之后**。这两步之间：
 *
 * - 用户可能又点了一下（那个新点击不能被覆盖）；
 * - 执行可能失败（库锁着、刚开机）—— 失败必须**留着下次重试**。
 *
 * 少了这条消息，drain 的意义就变成了"读出来然后丢掉"，
 * 而症状是**用户的点击偶尔失效且无法复现**。原生三端都靠
 * `updateIntents` 的写回做到这件事（见 `apps/mobile/src/widgets/drain.ts` 文件头）。
 */
export interface WidgetRequeueMessage {
  type: 'heyta:widget-requeue';
  intents: RawWidgetClick[];
}

export type PageToWorkerMessage =
  | WidgetDataMessage
  | WidgetRefreshMessage
  | WidgetDrainMessage
  | WidgetRequeueMessage;

export function parsePageMessage(raw: unknown): PageToWorkerMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const msg = raw as Record<string, unknown>;

  if (msg.type === 'heyta:widget-drain') return { type: 'heyta:widget-drain' };

  if (msg.type === 'heyta:widget-requeue') {
    // 逐条校验：这是页面传回来的，但服务 worker 的边界上**一律不信**。
    // 放一条坏数据进日志，会让之后每一次 drain 都带着它。
    if (!Array.isArray(msg.intents)) return null;
    const intents = msg.intents
      .map((entry) => parseWidgetClick(entry, (entry as { at?: number })?.at ?? 0))
      .filter((entry): entry is RawWidgetClick => entry !== null);
    return { type: 'heyta:widget-requeue', intents };
  }

  if (msg.type === 'heyta:widget-data' || msg.type === 'heyta:widget-refresh') {
    const kind = msg.kind;
    if (typeof kind !== 'string') return null;
    if (!(ADAPTIVE_CARD_KINDS as readonly string[]).includes(kind)) return null;
    if (msg.type === 'heyta:widget-data') {
      // 🔴 `data` 必须是**非 null 的对象**。
      //
      // 只判 `'data' in msg` 是**不够**的：`{ data: undefined }` 也满足它，
      // 而一条 `data: undefined` 的消息会让 `updateByTag` **把组件清空** ——
      // 用户看到的是桌面上一块空白，而**没有任何报错**。
      // `null` 同理（结构化克隆会原样保留它，`JSON.stringify(null)` = `"null"`，
      // 宿主拿到一个不是 Adaptive Card 的 JSON，渲染成空白）。
      // 四款组件的数据都是对象，所以"必须是非 null 对象"是**恰好正确**的判据。
      if (typeof msg.data !== 'object' || msg.data === null) return null;
      // 🔴 `dayStr` / `validUntil` 是**新鲜度**信息，缺了它们这条数据
      //    就永远无法被判为过期 —— 而"永远不过期"在 Windows 上等于
      //    "永远显示旧任务"。所以宁可不收这条数据，也不收一条没有期限的。
      if (typeof msg.dayStr !== 'string') return null;
      if (typeof msg.validUntil !== 'number' || !Number.isFinite(msg.validUntil)) return null;
      // ⚠️ `placeholder` 判据**同上**（必须是对象），但非法时**不能**把整条消息拒了：
      //    那是次要载荷，拒收的代价是"合法数据没进缓存" ⇒ 组件停在旧任务上直到午夜 ——
      //    正是这条链路要防的那个缺陷。归一成 `null`，让 SW 在真要用它的那一步
      //    退回构建期生成的静态占位文件（见 `sw.ts` 的 fetch 分支）。
      const placeholder =
        typeof msg.placeholder === 'object' && msg.placeholder !== null ? msg.placeholder : null;
      return {
        type: 'heyta:widget-data',
        kind: kind as AdaptiveCardKind,
        data: msg.data,
        placeholder,
        dayStr: msg.dayStr,
        validUntil: msg.validUntil,
      };
    }
    return { type: 'heyta:widget-refresh', kind: kind as AdaptiveCardKind };
  }

  return null;
}
