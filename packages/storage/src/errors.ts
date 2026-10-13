/**
 * 存储失败的**结构化原因**
 * ==========================
 *
 * 为什么需要它：错误屏（`apps/web/src/main.tsx` → `ErrorScreen.tsx`）渲染的是
 * `error.message` 的**原文**。而这条路径上有一条中文是**无条件**抛的：
 *
 * ```
 * IndexedDB 升级被其它标签页阻塞 —— 请关闭该应用的其它窗口后重试
 * ```
 *
 * 触发条件是真实用户场景（同一个站点开了两个标签页，其中一个是旧版本）。
 * 于是**用英文界面的用户会在应用启动失败时读到一句中文**。
 *
 * 做法与 `packages/ai` 的 `AiFailure.reason`、`sync-client` 的同步状态完全一致：
 * **来源只给结构化的原因，措辞归各壳**。
 *
 * 🔴 `message` 保持原样不动，这是刻意的：
 *   1. 它有诊断价值（错误屏把它降级成"详情"，容器里看不到真错误时靠它）；
 *   2. 现有测试按 `message` 断言（`rejects.toThrow('故意失败')`），
 *      改 `message` 等于把一堆与本次改动无关的测试一起改掉。
 *
 * ⚠️ **已知未覆盖**：`memory-adapter.ts` 与 `sqlite-adapter.ts` 仍然抛裸 `Error`。
 * 它们的中文全是**编程错误**（未定义的 store、嵌套事务、缺索引…）或驱动的原始报错，
 * 不是用户会读到的界面文案 —— 所以这一轮只转 IndexedDB（Web 的启动路径）。
 * 要收口时按同样方式加 `kind`，并在测试里钉住"message 逐字未变"。
 */

/**
 * 存储失败的原因。
 *
 * 前四种是**用户会遇到的**，第五种是**开发者搞错了**：
 * 两者的处置方式不同 —— 前者要翻译成用户能读懂的句子，后者该带着技术细节
 * 出现在"详情"里，而不是被本地化成一句亲切的提示。
 */
export type StorageFailure =
  /** 数据库打不开：隐私模式、配额不足、被中止…… */
  | { kind: 'open-failed' }
  /**
   * 🔴 升级被**其它标签页**阻塞。
   *
   * 这是唯一一种"用户看一眼就知道怎么办"的失败（关掉别的窗口即可），
   * 也是唯一一种**无条件**抛出的（`onblocked` 事件没有 `error` 对象可以借）。
   */
  | { kind: 'upgrade-blocked' }
  /** 一次读写请求失败（驱动报了错，或驱动没给错误对象）。 */
  | { kind: 'request-failed' }
  /** 事务失败或被中止。 */
  | { kind: 'transaction-failed' }
  /** 编程错误：调用方用错了适配器。用户对它无从下手。 */
  | { kind: 'programming-error' };

/**
 * 带结构化原因的存储错误。`message` 与改造前逐字相同。
 *
 * 🔴 `cause` 保留**驱动/浏览器给的原始错误**（`request.error` / `idbTx.error`…），
 * 这一点是必须的：包一层之后 `error.name` 就变成 `'StorageError'` 了，
 * 而唯一索引冲突的判定**只能看驱动自己的名字**（`ConstraintError`）。
 *
 * 这不是假想 —— 改这一版时我把 `error.name` 弄丢了，
 * `DbOpLogStore` 的"同一 opId 写两次只留一条"当场红了 4 个既有用例。
 * **既有测试抓到了它，这也正是"先有基线再改"的价值。**
 */
export class StorageError extends Error {
  readonly failure: StorageFailure;

  constructor(message: string, failure: StorageFailure, cause?: unknown) {
    super(message);
    this.name = 'StorageError';
    this.failure = failure;
    this.cause = cause;
  }
}

/**
 * 把驱动给的东西包成 `StorageError`，**`message` 与 `request.error ?? new Error(兜底)` 逐字相同**：
 *
 * - `cause` 是 `Error` → 用**它自己的** `message`（浏览器/驱动给的细节优先，与改造前一致）
 * - `cause` 缺席（`undefined`/`null`）→ 用 `fallbackMessage`
 * - 其它（理论上不会发生）→ `String(cause)`
 *
 * ⚠️ 唯一的行为差异：改造前非 `Error` 的 `cause` 会被**原样**当作 rejection 值抛出去，
 * 现在一律包成 `StorageError`。调用方拿到的始终是 `Error`，这是更严的形状。
 */
export function storageError(
  cause: unknown,
  fallbackMessage: string,
  failure: StorageFailure,
): StorageError {
  if (cause instanceof Error) return new StorageError(cause.message, failure, cause);
  if (cause === undefined || cause === null) return new StorageError(fallbackMessage, failure);
  return new StorageError(String(cause), failure, cause);
}
/**
 * 已经是 `StorageError` 就**原样返回**，否则包一层。
 *
 * 🔴 这条"一手结构优先"的规则是必须的：适配器内部有一层**统一 catch**
 * （事务体的 `catch`），它会把里面抛出来的一切重新包一遍。
 * 而里面抛出来的可能已经是更具体的原因 —— 比如 `makeTx` 的 `programming-error`。
 * 用 `storageError()` 直接包会把它**降级**成笼统的 `request-failed`，
 * 于是"用户无从下手"和"重试一下"被混成同一类。
 *
 * 测试钉住了这一点（`tests/storage-error.spec.ts`）。
 */
export function asStorageError(
  cause: unknown,
  fallbackMessage: string,
  failure: StorageFailure,
): StorageError {
  if (cause instanceof StorageError) return cause;
  return storageError(cause, fallbackMessage, failure);
}

/**
 * 在**已经 `destroy()` 过的适配器实例**上继续读写。
 *
 * 🔴 为什么要有这个类型，而不是让它静默成功：
 * `destroy()` 会把连接关掉。此前的实现里，之后任何一次普通读都会走
 * `open()`/`ensureOpen()` 那条重开路径，于是**刚删掉的容器被重新建成空壳**
 * （SQLite 侧实测 73728 字节 / 6 张空表，见计划 §10.146）。表现是：
 * 调用方拿到"销毁成功"的报告，盘上却重新出现了库 —— 而内容读出来是空的，
 * 所以**没有任何一层会说谎**。这是"永远通过的判据"那一族的存储层版本。
 *
 * 现在销毁即死路：第二次 `destroy()` 返回同一份报告（幂等仍然成立），
 * 其余任何操作一律抛这个错。要重新用就换一个新实例 ——
 * 每个真实宿主在注销之后都是这么做的（重新登录 / 重启进程 / 重新加载页面）。
 *
 * `kind` 是 `programming-error`：用户对它无从下手，能做的只有把接线改对
 * （销毁器之后不该再有人拿着同一个实例发起读）。
 */
export class AdapterDestroyedError extends StorageError {
  constructor(target: string) {
    super(
      `这份存储已被销毁（${target}）。销毁后的实例不可再用 —— 它会拒绝读写，` +
        '而不是把刚删掉的容器重新建成空壳。请改用一个新的适配器实例。',
      { kind: 'programming-error' },
    );
    this.name = 'AdapterDestroyedError';
  }
}
