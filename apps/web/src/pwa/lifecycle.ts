/**
 * Windows（PWA widget）的生命周期接线。
 * ==========================================
 *
 * 回答一个问题：**什么时候推数据、什么时候收点击。**
 *
 * | 时机 | 做什么 | 为什么 |
 * |---|---|---|
 * | 应用启动（op-log 就绪后） | drain 一次 + 立刻推一次 | 组件里的点击要尽快变成 op；组件要有新数据 |
 * | op-log 变化 | 防抖后推一次 | 用户改了任务，组件该跟着变 |
 * | 页面重新可见 | drain + 推一次 | 应用在后台时组件可能被点过；回到前台是最自然的对账时机 |
 *
 * ## 🔴 为什么"推"是防抖的，而"drain"不是
 *
 * 推是**幂等且昂贵**的：一次 `updateByTag` 要跨进程交给组件宿主，
 * 而一次编辑会连发好几个 op（标题 + 日期 + 优先级）。
 * 不防抖的话，用户改一个任务会让组件闪好几次 —— 而每一次都是完整的重渲染。
 *
 * drain 是**非幂等且必须及时**的：它把用户的点击消费掉。
 * 防抖会让点击在日志里多躺一会儿，没有任何好处。
 *
 * ## 🔴 为什么**不**监听 `widgetclick` 的实时广播
 *
 * service worker 在点击时会向所有客户端 `postMessage`
 * （见 `sw.ts`），但这里**刻意不订阅它**。理由：那个广播是"可能有一条新点击"
 * 的提示，而**权威来源是日志本身**。订阅广播会带来一条只在"广播丢失/顺序错乱"
 * 时才出现的路径 —— 那种 bug 表现为"偶尔点了没反应"，
 * 而它最不可能被复现。回到前台 + 启动各 drain 一次已经覆盖了全部真实场景。
 * （广播仍然有用：它让**其它标签页**知道该 drain 了。见下。）
 *
 * ## 为什么其它标签页也要 drain
 *
 * 用户在标签页 A 打开了应用，在标签页 B 也开着同一个应用，然后点了组件。
 * SW 的广播会同时到达 A 和 B，两个标签页**同时** drain ——
 * 而 drain 是"读出来 + 清空"。这里不会因此丢数据（IndexedDB 事务保证只有一方拿到），
 * 但**两个标签页会各自构造 op**，于是同一次点击可能产生两条 op。
 * `setCompleted` 是幂等的（目标状态语义），所以最终状态正确，
 * 只是 op-log 里多一条 —— 这与"两台设备同时点"是同一类冲突，
 * 由 op-log 自己的合并规则处理。**不为它加跨标签页锁**：
 * 那会把一个罕见的、自愈的问题换成一把要维护的锁。
 */

import { currentState, onEngineChange } from '../lib/oplog.js';
import { useFocusStore } from '../features/focus/store.js';
import { widgetDrainTasks } from '../features/tasks/store.js';

import { planWidgetPublish, publishWidgetCards } from './publish.js';
import { runWidgetDrainQuietly } from './widget-drain.js';

/**
 * 推送防抖窗口（ms）。
 *
 * ⚠️ 取 500 是因为它要盖住"用户连打几个字符"这个最密集的编辑节奏，
 * 同时短到用户点完一个 checkbox 切到桌面时组件**已经**更新了。
 * 再长（比如 2s）会让"我刚点完，组件还是旧的"变成一个能被注意到的现象。
 */
const PUBLISH_DEBOUNCE_MS = 500;

let publishTimer: number | null = null;
let unsubscribe: (() => void) | null = null;
let onVisibility: (() => void) | null = null;
let started = false;

/** 立刻推一次（读当前物化状态与专注状态）。**不抛**。 */
export async function publishNow(): Promise<void> {
  try {
    const plan = planWidgetPublish({
      state: currentState(),
      // ⚠️ 专注状态只在应用活着时存在（正在跑的番茄钟**不落盘**），
      //    所以它是唯一一个必须从内存读、而不是从 op-log 读的输入。
      //    拿不到时会退化成"没有进行中的专注" —— 那在专注运行时是**错的**，
      //    所以这里不强求：拿不到就传 undefined，让选择器给 active:false，
      //    而**绝不**编造一个会话标题。
      focus: useFocusStore.getState().state,
      now: Date.now(),
    });
    await publishWidgetCards(plan);
  } catch (error) {
    // 组件是增强，不是功能前提。推失败绝不能影响应用本身。
    console.warn('[heyta] 推送小组件数据失败（已忽略）', error);
  }
}

function schedulePublish(): void {
  if (publishTimer !== null) window.clearTimeout(publishTimer);
  publishTimer = window.setTimeout(() => {
    publishTimer = null;
    void publishNow();
  }, PUBLISH_DEBOUNCE_MS);
}

/**
 * 起生命周期。**幂等** —— 重复调用只会留一个订阅
 * （React 严格模式会双调用 effect，这里不依赖调用方自觉）。
 */
export function startWidgetLifecycle(): void {
  if (started) return;
  started = true;

  // 启动时先 drain 再推：反过来的话，刚落盘的数据会被"读出来"这一步的
  // 结果覆盖掉（`publishNow` 读的是 `currentState()`，而 drain 会改它）。
  void (async () => {
    await runWidgetDrainQuietly(widgetDrainTasks);
    await publishNow();
  })();

  unsubscribe = onEngineChange(schedulePublish);

  onVisibility = () => {
    if (document.hidden) return;
    void (async () => {
      await runWidgetDrainQuietly(widgetDrainTasks);
      await publishNow();
    })();
  };
  document.addEventListener('visibilitychange', onVisibility);
}

/** 停生命周期。**只为测试存在** —— 生产上它活到页面关闭。 */
export function stopWidgetLifecycle(): void {
  if (publishTimer !== null) {
    window.clearTimeout(publishTimer);
    publishTimer = null;
  }
  unsubscribe?.();
  unsubscribe = null;
  if (onVisibility !== null) document.removeEventListener('visibilitychange', onVisibility);
  onVisibility = null;
  started = false;
}
