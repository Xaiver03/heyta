/**
 * 移动端的**共享写路由装配点**（对应 web 的 `lib/oplog.ts` 里那半份 `ShareWiring`）。
 * ============================================================================
 *
 * 为什么单独一层而不是塞进 `db/open-host.ts`：判据要在 node 里值导入跑
 * （`react-native` 一进来整个 spec 就转译失败，本壳 `feature-entries.spec.ts`
 * 文件头记过同一个坑），而路由的三件输入（个人写入口、share 通道、合并视图）
 * 全是**装配**：AGENTS §3.5 —— 这里一行都不许判断"什么算共享的"，
 * 判据唯一出处是 `@heyta/app-host` 的 `decideShareWrite`。
 *
 * 🔴 **没装共享通道时，逐字等于原来的 `dispatch`**（web 的既有纪律）：
 * `routedDispatch` 只在装配后存在，`dispatchIntent` 的未装配分支原样调 base。
 */
import {
  createShareRoutingCheckedDispatcher,
  createShareRoutingDispatcher,
  type ShareWriteChannelProvider,
} from '@heyta/app-host';
import type { CheckedDispatchBuilder, MaterializedState, OpIntent } from '@heyta/op-log';

/** 引擎（个人 op-log）的三件入口：`AppHost` 本身就满足。 */
export interface MobileOplogBase {
  dispatch(intent: OpIntent): Promise<unknown>;
  dispatchChecked<T>(build: CheckedDispatchBuilder<T>): Promise<T>;
  getState(): MaterializedState;
}

/** 与 web 的 `ShareWiring` 同一形状：通道晚绑定 + 个人状态→合并视图。 */
export interface MobileShareWiring {
  readonly channel: ShareWriteChannelProvider;
  readonly mergeView: (personal: MaterializedState) => MaterializedState;
}

let base: MobileOplogBase | undefined;
let wiring: MobileShareWiring | undefined;
let routedDispatch: ((intent: OpIntent) => Promise<void>) | undefined;
let routedChecked: (<T>(build: CheckedDispatchBuilder<T>) => Promise<T>) | undefined;

function rebuild(): void {
  if (base === undefined || wiring === undefined) {
    routedDispatch = undefined;
    routedChecked = undefined;
    return;
  }
  const ports = {
    personalDispatch: async (intent: OpIntent): Promise<unknown> =>
      requireBase().dispatch(intent),
    channel: wiring.channel,
    // 🔴 交的是合并视图而不是 base 的个人状态（ADR-0068 裁决二：判据与读视图必须同源）。
    getState: () => currentState(),
  };
  routedDispatch = createShareRoutingDispatcher(ports);
  routedChecked = createShareRoutingCheckedDispatcher({
    ...ports,
    engineDispatchChecked: <T>(build: CheckedDispatchBuilder<T>): Promise<T> =>
      requireBase().dispatchChecked(build),
  });
}

function requireBase(): MobileOplogBase {
  if (base === undefined) {
    throw new Error('移动端宿主尚未打开，写路由无处可落。请先 await openTaskHost()。');
  }
  return base;
}

/**
 * `openTaskHost()` 打开后把**未包装**的引擎入口交进来；数据库换代时摘掉。
 * 🔴 交的一定是原始宿主的方法 —— 交包装后的会把路由套进路由（递归）。
 * 🔴 **生产里唯一的绑定点是 `db/open-host.ts` 的 `withWriteSignal()`**：别人再绑一次
 *    拿到的必然是包装后的那份（`openTaskHost()` 是单例，交出的就是包过的那件），
 *    写读两侧都会绕回自己。常驻判据见 `tests/share-routing-assembly.spec.ts`。
 */
export function bindMobileOplogBase(next: MobileOplogBase | undefined): void {
  base = next;
  rebuild();
}

/** 装配/摘掉共享通道（摘掉 = 回到"没有共享"的逐字原状）。 */
export function attachMobileShareWiring(next: MobileShareWiring | undefined): void {
  wiring = next;
  rebuild();
}

/**
 * 唯一写入口的路由版：装了共享就判一次"进哪本 log"（判据在 app-host），
 * 没装就逐字走原路。
 */
export async function dispatchIntent(intent: OpIntent): Promise<void> {
  const routed = routedDispatch;
  if (routed === undefined) await requireBase().dispatch(intent);
  else await routed(intent);
}

/** `dispatchChecked` 的路由版（CAS 那两枚动作也必须过同一判据，web 同一条理由）。 */
export async function dispatchChecked<T>(build: CheckedDispatchBuilder<T>): Promise<T> {
  const routed = routedChecked;
  if (routed === undefined) return await requireBase().dispatchChecked(build);
  return await routed(build);
}

/**
 * 🔴 一次合法的读最多走**这一趟**（`base.getState()` 是引擎自己的同步取值，
 * `mergeView` 拿的是交进去的那份 personal，两者都不该再调回 `currentState`）。
 * 再进来一次就是"路由套进路由"，**必须具名报错**。
 *
 * 为什么要有这道闸门（2026-10-24 iOS 设备腿实测）：`share-signals.ts` 当时把
 * `openTaskHost()` 返回的**包装后**宿主又交了一次 `bindMobileOplogBase`，于是
 * `currentState → base.getState → shareAwareState(=currentState) → …` 逐帧互递归。
 * 真机症状是「在设置页存完凭据，下一帧渲染整个 App 死在
 * `RangeError: Maximum call stack size exceeded`」—— 崩溃栈里只有那两个名字交替，
 * 既不指出是谁交的，也看不出这是装配问题，长得像 RN 的锅。
 */
let readingMergeView = false;

/** 合并视图：没装共享通道时个人状态就是全部状态。 */
export function currentState(): MaterializedState {
  if (readingMergeView) {
    throw new Error(
      '共享读路由递归：交给 bindMobileOplogBase 的宿主，它的 getState 又绕回了 currentState()。' +
        '这里只许交未包装的原始引擎入口（见 bindMobileOplogBase 的注释）。',
    );
  }
  readingMergeView = true;
  try {
    const personal = requireBase().getState();
    return wiring === undefined ? personal : wiring.mergeView(personal);
  } finally {
    readingMergeView = false;
  }
}
