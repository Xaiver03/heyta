/**
 * Windows（PWA widget）的发布管线：物化状态 → 载荷 → **Adaptive Card 数据** → 组件。
 * =================================================================================
 *
 * 与移动端 [`apps/mobile/src/widgets/publish.ts`] 是**同一条链路的上半截**，
 * 只有最后一步不同：那边把**加密信封**写进 App Group，这边把**Adaptive Card 数据**
 * 交给 service worker（`widgets.updateByTag`）。
 *
 * ## 🔴 为什么这条路上**没有加密** —— 这是平台能力边界，不是遗漏
 *
 * 移动端那条链路：应用加密 → 共享容器（App Group）→ **组件进程**解密 → 渲染。
 * 宿主自始至终只看到密文与渲染结果，所以那一层加密是**有意义的**（决策 D1）。
 *
 * Windows 这条路：
 *
 * ```
 * 页面（有密钥） → 明文 Adaptive Card 数据 → service worker → 操作系统组件宿主
 * ```
 *
 * 组件宿主吃的是**声明式模板 + 明文 JSON**（Adaptive Card 不能跑 JS），
 * 所以链路上**根本没有解密的那一侧**。在这里加密再解密，解密方只能是页面自己 ——
 * 那是纯粹的密码学表演，**不增加任何安全性**，却会让代码看起来像"已经加密了"。
 * 本项目最反对的就是这种东西。
 *
 * **那静态数据呢？** Adaptive Card 数据存在 IndexedDB 里，是明文。
 * 这与应用**自己的**本地数据库是同一个姿态（本地优先应用靠设备加密，
 * E2EE 保护的是**同步**，不是本机落盘）。所以这里没有引入新的暴露面。
 *
 * ⚠️ 但有一处**确实**与移动端不同，必须写进产品说明而不是含糊过去：
 * 在 Windows 上，组件数据以明文经过一次**进程边界**交给系统组件宿主。
 * 移动端没有这次交接。记在账本 W3 的证据块里。
 *
 * ## 哪些决定是从移动端**照搬**的（不是重新想的）
 *
 * 1. 🔴 `dayStr` / `validUntil` **由应用算，绝不由原生推**。时区、跨日切点都是产品规则；
 *    四端各推一遍必然出现"两个平台对同一时刻给出不同的任务列表"，且没有任何一处报错。
 * 2. 🔴 `validUntil` = **下一个本地零点**（不是 `now + msUntilNextMidnight(now)`）。
 *    用后者在午夜前最后一秒会落到午夜**之后**，组件会在新的一天里继续显示昨天的任务。
 * 3. 🔴 与选择器之间只做一次 `Record → 数组` 转换（`Object.values`）。
 *    让每个调用方各自转，"哪个忘了转"会表现为"某个 section 永远是空的"，类型系统拦不住。
 */

import type { FocusState, LocalDate } from '@heyta/domain';
import { addDays, parseLocalDate, toLocalDate } from '@heyta/domain';
import { translate, type Locale } from '@heyta/i18n';
import type { MaterializedState } from '@heyta/op-log';
import {
  ADAPTIVE_CARD_KINDS,
  buildAdaptiveCardData,
  buildAdaptiveCardPlaceholder,
  buildWidgetPayload,
} from '@heyta/widget-core';
import type {
  AdaptiveCardData,
  AdaptiveCardKind,
  WidgetPayload,
  WidgetTranslate,
} from '@heyta/widget-core';

import { currentLocale } from '../lib/locale.js';

import { pushWidgetData } from './register.js';

/** 选择器要的那几个集合。**故意收窄**：发布管线不许碰 settings / aiFeedback。 */
export type WidgetPublishStateSlice = Pick<
  MaterializedState,
  'tasks' | 'projects' | 'habits' | 'habitLogs'
>;

export interface WidgetPublishPlan {
  dayStr: LocalDate;
  /** 这份数据什么时候开始不可信 = **下一个本地零点**。 */
  validUntil: number;
  /** 这一轮文案是用哪门语言渲染的（同时告诉 SW 该按哪门语言存占位态）。 */
  locale: Locale;
  payload: WidgetPayload;
  /** 每一款组件各自要推的 JSON。 */
  cards: Record<AdaptiveCardKind, AdaptiveCardData>;
  /**
   * 每一款的**占位态**（"打开 Heyta 以显示小组件"），与 `cards` 同一语言。
   *
   * 🔴 一起算而不是让 SW 到时需要时再算：SW 不 import 词条表 —— 把整份表打进
   * `public/sw.js` 是每次 SW 启动都要加载的成本，而"过期时该说什么"这句话
   * 的**语言**必须与数据同源。SW 只需要缓存成品。
   */
  placeholders: Record<AdaptiveCardKind, AdaptiveCardData>;
}

/**
 * 把一门语言绑成 widget-core 要的翻译口。
 *
 * widget-core **一个词条都不 import**（见该包 `adaptive-card.ts` 文件头的"三不"），
 * 文案由宿主注入。而这条链路的调用方不在 React 里、拿不到 `useI18n()`，
 * 所以走 `lib/locale.ts` 那个唯一的非 React 读取口 —— 与 auth store 带
 * `body.locale` 是同一个来源，两处各自读 localStorage 就会漂移。
 */
function translateFor(locale: Locale): WidgetTranslate {
  return (key, vars) => translate(locale, key, vars);
}

/**
 * **纯函数**：算出这一轮该推什么。
 *
 * 与移动端的 `planWidgetPublish` 名字刻意保持一致 —— 两端是同一个概念，
 * 名字不同会让"改一处忘另一处"变得更容易。
 */
export function planWidgetPublish(input: {
  state: WidgetPublishStateSlice;
  focus?: FocusState;
  locale: Locale;
  now: number;
}): WidgetPublishPlan {
  const { state, focus, locale, now } = input;
  const today = toLocalDate(now);

  const payload = buildWidgetPayload({
    tasks: Object.values(state.tasks),
    projects: Object.values(state.projects),
    habits: Object.values(state.habits),
    logs: Object.values(state.habitLogs),
    // ⚠️ 专注状态只在应用活着时存在（正在跑的番茄钟不落盘），由调用方传入；
    //    拿不到时传 `undefined`，选择器会给 `{ active: false }`。
    focus,
    today,
    now,
  });

  const cards = {} as Record<AdaptiveCardKind, AdaptiveCardData>;
  const placeholders = {} as Record<AdaptiveCardKind, AdaptiveCardData>;
  const t = translateFor(locale);
  for (const kind of ADAPTIVE_CARD_KINDS) {
    cards[kind] = buildAdaptiveCardData(kind, payload, today, t);
    placeholders[kind] = buildAdaptiveCardPlaceholder(kind, t);
  }

  return {
    dayStr: today,
    // 见文件头第 2 条：**确切的**下一个本地零点
    validUntil: parseLocalDate(addDays(today, 1)).getTime(),
    payload,
    cards,
    placeholders,
    locale,
  };
}

/**
 * 把一份计划推给四款组件。**返回成功推出去的款数**。
 *
 * ⚠️ 返回 0 **不是错误** —— 用户可能一款组件都没装。所以这里不用抛错表达失败，
 * 也不打 error 日志；真正的诊断信息在 `register.ts` 的 `pushWidgetData` 里。
 *
 * 🔴 先把**数据发出去**，再关心有没有人收。顺序反过来的话（先问"装了没"）
 * 会需要一次额外的异步握手，而 `widgetinstall` 事件可能就在那之间到达 ——
 * 那时组件会显示"打开 Heyta 以显示小组件"，**而用户明明已经打开了**。
 */
export async function publishWidgetCards(plan: WidgetPublishPlan): Promise<number> {
  let pushed = 0;
  for (const kind of ADAPTIVE_CARD_KINDS) {
    // 数据 + 占位态 + 期限一起传：SW 会把这三样**一并**存下来，并在**应用不在**时
    // 用期限判过期、用占位态决定过期后画什么（见 `sw.ts` 的 fetch 分支）。
    await pushWidgetData(
      kind,
      plan.cards[kind],
      plan.placeholders[kind],
      plan.dayStr,
      plan.validUntil,
    );
    pushed += 1;
  }
  return pushed;
}

/**
 * 快照拿不到时的推送：把**四款**组件都置成诚实的空/占位态。
 *
 * 🔴 只在**明确知道快照不可信**（解密失败、版本不认识）时调用。
 * 退出登录时必须走这条 —— 否则组件会在用户已经登出后继续显示任务，
 * 而那是最严重的一类缺陷（决策 D6）。
 */
export async function publishWidgetPlaceholders(): Promise<number> {
  const t = translateFor(currentLocale());
  for (const kind of ADAPTIVE_CARD_KINDS) {
    const placeholder = buildAdaptiveCardPlaceholder(kind, t);
    // 占位态**永远成立**（"打开 Heyta 以显示小组件"不会过期），
    // 所以给它一个无限远的期限 —— 而不是"立刻过期"，
    // 那会让 SW 的拦截逻辑把一条正确的数据判成旧的。
    // 同一份占位态也当作"以后过期了画什么"存下去 —— 这条链路没有更新的数据进来，
    // SW 手里唯一诚实的降级目标就是它自己。
    await pushWidgetData(kind, placeholder, placeholder, '', Number.MAX_SAFE_INTEGER);
  }
  return ADAPTIVE_CARD_KINDS.length;
}
