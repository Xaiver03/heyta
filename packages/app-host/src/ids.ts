/**
 * 标识符生成（宿主无关）
 * =========================
 *
 * 仓库里原先没有这个东西，于是每个宿主各写一份，而且**行为不一致**：
 *
 *   | 位置                        | clientId                      | 任务 entityId                    |
 *   |-----------------------------|-------------------------------|----------------------------------|
 *   | apps/web/src/lib/oplog.ts   | randomUUID + **回退**         | `task-${Date.now()}-${counter}`  |
 *   | apps/node-host/src/host.ts  | `crypto.randomUUID()`（无回退）| `task-${crypto.randomUUID()}`    |
 *
 * node-host 那份直接假定 `crypto.randomUUID` 存在。在 Node 22 上这没问题，
 * 但**这正是一个会在移动端炸掉的假定**：
 *
 *   - React Native 的 Hermes 引擎历史上**没有 `globalThis.crypto`**；
 *     即便有，`randomUUID` 也比 `getRandomValues` 晚得多才补齐。
 *   - 换句话说，`crypto.randomUUID()` 在 iOS/鸿蒙上很可能就是
 *     `TypeError: crypto.randomUUID is not a function` —— 而且是在
 *     **用户点"新建任务"的那一刻**炸，不是在启动时。
 *
 * 所以这里统一成一份带完整回退的实现，三端共用。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ 回退路径的强度差异要说清楚，不能假装等价：
 *
 * `randomUUID()` 是密码学随机的 122 位。回退用的是 `Date.now()` + 单调计数
 * + `Math.random()`，**不是密码学随机**。
 *
 * - 对 **entityId** 这没问题：它只需要在"同一个用户的所有设备"范围内不撞，
 *   而这个范围小到时间戳+计数就足够。撞了也不会静默 —— 会表现为两条任务合并，
 *   且有 op-log 可查。
 * - 对 **clientId** 这是有代价的：它是 LWW 的**确定性决胜依据**（AGENTS.md §1），
 *   两台设备撞 id 会让冲突裁决失去确定性。但两台设备在**同一毫秒**生成
 *   clientId、且 `Math.random()` 也撞，这个概率远低于其它失败模式；
 *   相比之下"直接抛异常、应用起不来"是确定会发生的坏结果。
 *   这是**有意识的取舍**，不是疏忽。
 *
 * 真正的修复是让平台注入一个可靠的随机源（RN 上加 `react-native-get-random-values`
 * 之类的 polyfill），届时 `randomUUID` 存在，回退路径根本不会被走到。
 * ─────────────────────────────────────────────────────────────────────────
 */

/** 单调计数：同一毫秒内连续生成也不会撞。 */
let counter = 0;

/**
 * 取一个随机 UUID（若运行时有），否则回退。
 *
 * 返回值形态在两条路径下不同（UUID vs `xxxx-timestamp-counter-random`），
 * **不要解析它**，只当不透明字符串用。
 */
export function randomId(): string {
  const c: Crypto | undefined = globalThis.crypto;
  if (c !== undefined && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  counter += 1;
  return `${Date.now().toString(36)}-${String(counter)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 当前是否走的是回退路径。诊断用 —— 不要拿它做分支逻辑。 */
export function usingRandomIdFallback(): boolean {
  const c: Crypto | undefined = globalThis.crypto;
  return c === undefined || typeof c.randomUUID !== 'function';
}

/**
 * 任务实体 id。
 *
 * 与 `randomId()` 一样只保证"实际不撞"，不保证密码学强度 —— entityId 不需要后者。
 */
export function newTaskId(): string {
  return `task-${randomId()}`;
}
