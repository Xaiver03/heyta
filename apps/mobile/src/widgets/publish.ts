import type { FocusState } from '@heyta/domain';
import { planWidgetPublish, type WidgetPublishStateSlice, type WidgetPublishPlan } from '@heyta/app-host';
export { planWidgetPublish, type WidgetPublishStateSlice, type WidgetPublishPlan } from '@heyta/app-host';

import { sealWidgetSnapshot, setWidgetSnapshot } from './widget-bridge';
import {
  beginWidgetCleanup,
  canCommitPublish,
  currentPublishEpoch,
  registerPublish,
  resetWidgetPublishCoordinatorForTests,
} from './publish-coordinator';

/**
 * 发布管线：物化状态 → 载荷 → 加密信封 → 共享容器
 * ==================================================
 *
 * 这是 W1-4 那条闭环的上半截。下半截是 [drain.ts] 的意图回写。
 *
 * ## 为什么要把"算"和"做"分开
 *
 * [planWidgetPublish] 是**纯函数**：给定状态与"现在"，算出 `dayStr` / `validUntil` /
 * 载荷 JSON。它可以被单测直接调用 —— 而移动端测试**刻意不 import `react-native`**
 * （在 node 里加载它直接失败），所以任何碰到原生的写法都测不到。
 *
 * [publishWidgetSnapshot] 才是那个碰原生的薄壳。
 *
 * ## 三条要么安静出错、要么骗用户的决定
 *
 * 1. 🔴 **`dayStr` 与 `validUntil` 由应用算，绝不由原生推**。
 *    时区、跨日切点、"今天从几点开始"都是产品规则。四端各推一遍，
 *    必然出现"iOS 认为还是今天、Android 认为已经是明天" —— 而症状是
 *    两份快照对同一时刻给出不同的任务列表，且**没有任何一处会报错**。
 *
 * 2. 🔴 **`validUntil` = 下一个本地零点**（[msUntilNextMidnight]）。
 *    它与组件侧 `TodayWidgetModelBuilder` 的过期判据是**同一个时刻**：
 *    过了零点组件自己就会显示"数据已过期"，而**不需要**应用在那时还活着。
 *    这正是"应用算今天、原生只判 `now >= validUntil`"这条分工的落点 ——
 *    组件永远不会自己推导"今天"，它只会说"这份数据过期了"。
 *
 * 3. 🔴 **发布失败绝不能让用户的写入失败**。这条管线挂在 `dispatch` 后面
 *    （见 `db/open-host.ts` 的 `withWriteSignal`），如果它抛出去，
 *    用户会看到"任务没保存"——而任务其实已经保存了。所以所有失败都被吞掉并记日志。
 *
 * ## 合并（coalescing）
 *
 * 写入可能很密集（连续勾选、批量编辑）。同一个时刻只需要一份快照，
 * 所以并发调用会被合并：**正在发布时再来的请求只记一个标记，等当前这轮结束后补跑一次**。
 * 关键是"补跑一次"而不是"直接返回"—— 直接返回会**丢掉最后一次写入**，
 * 而它的症状是"刚勾的那一条在组件上没变"，下次别的写入一来又"好了"。
 */

/**
 * 发布的结果。
 *
 * 🔴 刻意**不是一个 boolean**：`false` 会把"原生模块不存在"（开发机上正常、
 * 发布包里是真故障）与"封包失败"混成同一个信号，而这两者要查的地方完全不同。
 */
export type WidgetPublishOutcome =
  | 'published'
  /** 原生模块不可用（例如 Expo Go / 未链接）。开发时常见，发布包上是故障。 */
  | 'no-native-module'
  /** 原生封包失败（Keystore 不可用、参数非法……）。细节在日志的错误码里。 */
  | 'seal-failed'
  /** 信封被原生侧拒了（`E_WIDGET_INVALID_ENVELOPE`）或写盘失败。 */
  | 'write-rejected'
  /** 清理账号状态已经开始，旧快照不能再写入。 */
  | 'fenced';

/** 这条管线需要的外部动作。做成可注入是为了让合并逻辑能在单测里跑。 */
export interface WidgetPublishDeps {
  seal(payloadJson: string, dayStr: string, validUntil: number): Promise<string | null>;
  write(envelopeJson: string): Promise<boolean>;
}

const defaultDeps: WidgetPublishDeps = {
  seal: sealWidgetSnapshot,
  write: setWidgetSnapshot,
};

/**
 * 跑一轮发布。**不吞异常** —— 吞异常的职责在 [publishWidgetSnapshot]。
 *
 * 顺序是刻意的：**先封包、后写盘**。反过来会先写下一份空信封，
 * 而封包失败时容器里就留下一份"合法的空快照" —— 组件会显示
 * **"今天没有任务"**，而真相是"还没发布成功"。那是本项目最反对的那类 bug。
 */
export async function runWidgetPublish(
  plan: WidgetPublishPlan,
  deps: WidgetPublishDeps = defaultDeps,
  canWrite: () => boolean = () => true,
): Promise<WidgetPublishOutcome> {
  const envelopeJson = await deps.seal(plan.payloadJson, plan.dayStr, plan.validUntil);
  if (envelopeJson === null) return 'seal-failed';
  if (!canWrite()) return 'fenced';

  const written = await deps.write(envelopeJson);
  return written ? 'published' : 'write-rejected';
}

// ─────────────────────────────────────────────────────────────
// 合并（coalescing）
// ─────────────────────────────────────────────────────────────

let inFlight: Promise<void> | null = null;
let rerunRequested = false;

/**
 * 发布时"当前状态"的来源。
 *
 * 🔴 这里收的是**函数**而不是值，理由是补跑：合并时补跑的那一轮必须用
 * **那一刻**的最新状态，而不是首次调用时捕获的那份。传值会让
 * "连续勾选三条"只发布前两条 —— 而第三次调用看到的快照是**第一次的**。
 */
export interface WidgetPublishSource {
  read(): { state: WidgetPublishStateSlice; focus?: FocusState };
}

/**
 * 发布一份新快照。**永不抛异常**（见文件头第 3 条）。
 *
 * 并发语义：正在发布时再调用**不会**并发跑第二轮，而是记一个标记，
 * 等当前这轮结束后**补跑一次**（并且重读状态）。丢了这一次补跑，
 * 症状是"最后一次改动在组件上没出现，直到下次别的改动"。
 */
export async function publishWidgetSnapshot(
  source: WidgetPublishSource,
  deps: WidgetPublishDeps = defaultDeps,
): Promise<void> {
  const epoch = currentPublishEpoch();
  if (epoch === undefined) return;

  if (inFlight !== null) {
    rerunRequested = true;
    return inFlight;
  }

  inFlight = (async () => {
    try {
      do {
        rerunRequested = false;

        const { state, focus } = source.read();
        // ⚠️ `Date.now()` 在这里取（而不是由调用方传）：补跑的那一轮可能比首次调用
        //    晚几百毫秒，用旧的 now 会让 `validUntil` 早一点点 —— 跨零点时
        //    那就是"刚发布就过期"。而"发布的是现在这一刻的视图"本来就该用现在的时钟。
        const plan = planWidgetPublish({ state, focus, now: Date.now() });

        let outcome: WidgetPublishOutcome;
        try {
          outcome = await runWidgetPublish(plan, deps, () => canCommitPublish(epoch));
        } catch (error) {
          // 走到这里说明原生侧抛了（不是返回 false）。写入本身已经成功，
          // 所以只记日志 —— 让小组件的问题不影响用户正在做的事。
          console.warn('[widget] 发布快照失败（不影响本地数据）：', error);
          return;
        }

        if (outcome !== 'published' && outcome !== 'fenced') {
          console.warn(`[widget] 快照未发布：${outcome}`);
        }
      } while (rerunRequested && canCommitPublish(epoch));
    } finally {
      inFlight = null;
    }
  })();
  registerPublish(inFlight);

  return inFlight;
}

export { beginWidgetCleanup };

/**
 * 只给测试用：清掉合并状态。
 *
 * ⚠️ 不这么做，上一个用例留下的 `inFlight` 会让下一个用例的调用**直接返回**，
 * 于是"合并"这件事看起来正常、而实际上什么都没跑 —— 又是一个"不可能失败的检查"。
 */
export function __resetWidgetPublishForTests(): void {
  inFlight = null;
  rerunRequested = false;
  resetWidgetPublishCoordinatorForTests();
}
