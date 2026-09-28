/**
 * 清除凭据时，小组件必须**一起**清掉（决策 D6）。
 * ==================================================
 *
 * ## 🔴 为什么这不是"顺手多调一个函数"
 *
 * 用户在「我的」里点「清除凭据」，意思是：**我不再有权访问这些数据了。**
 * 可能是换账号、可能是要把手机给别人、也可能只是想重新登录。
 *
 * 但小组件的那份快照**不是用凭据加密的** —— 它用的是**设备密钥**
 * （Keychain / Keystore，见决策 D1）。所以：
 *
 * ```
 * 清掉凭据 ≠ 小组件读不到数据
 * ```
 *
 * 不一起清的话，**锁屏和主屏上会继续显示上一个账号的任务**，
 * 而且看起来完全正常 —— 没有任何报错、没有任何提示。
 * 这是决策 D6 记着的那一类缺陷里最严重的一种：
 * **用户以为已经退出了，数据还挂在他给别人看的屏幕上。**
 *
 * ## 🔴 顺序：先清凭据，后清组件
 *
 * 反过来会有一个真实的空档：
 *
 * | 顺序 | 危险 |
 * |---|---|
 * | 先清组件 → 再清凭据 | 清凭据可能触发一次状态变化 → 触发一次 publish → **组件又被填上一份新快照**。而这一步之后没有任何清理，用户以为清干净了 |
 * | **先清凭据 → 再清组件** | 清凭据是同步的，中间不存在"能发布"的时刻；最后一步必然是清的 |
 *
 * ⚠️ 这与 `lifecycle.ts` 里"先 drain 后 publish"是**同一类推理**：
 * 顺序在这里是一个可验证的性质，不是风格。
 *
 * ## 🔴 凭据清理失败时，**仍然必须**清组件
 *
 * 这条是刻意的，方向是"宁可多清一次"：
 * 小组件清空了最多是用户要重新打开应用；**没清空是数据留在屏幕上**。
 * 两者严重程度差一个数量级，所以这里不用 `try/finally` 之外的花样 ——
 * 无论凭据那一步抛没抛，组件都要清。
 */

/** 这个流程需要的外部动作。**全部注入**，所以它在 node 里能跑、能测。 */
export interface CredentialWipeDeps {
  /** 清掉服务器地址 / token / 密码。**同步**的（见文件头的顺序推理）。 */
  clearCredentials: () => void;
  /** 清掉快照、意图队列与设备密钥（原生侧实现）。 */
  clearWidgets: () => Promise<void>;
  /** 凭据清理抛出的错。**吞掉但不丢** —— 调用方决定怎么显示。 */
  onCredentialError?: (error: unknown) => void;
  /** 组件清理失败时的通知。⚠️ 这个**一定要有日志**，见下。 */
  onWidgetError?: (error: unknown) => void;
}

/** 结果。**不用 `void`** —— 调用方需要知道组件到底清掉没有。 */
export interface CredentialWipeResult {
  /** 凭据清干净了吗。 */
  credentialsCleared: boolean;
  /** 组件状态清干净了吗。⚠️ `false` 意味着**数据可能还在屏幕上**。 */
  widgetsCleared: boolean;
}

/**
 * 清凭据 + 清组件。
 *
 * **永不抛。**
 *
 * ⚠️ 关于 `onWidgetError`：组件清理失败是这一整套里**唯一一个真正危险的失败**，
 * 而它的实现路径（原生模块在 `clearWidgetState` 里已经有 `try`）决定了
 * 它不会自己冒出来。所以这里必须给它一个明确的出口 ——
 * 不然"没清干净"会退化成一个**没人知道的 `false`**。
 */
export async function wipeCredentialsAndWidgets(
  deps: CredentialWipeDeps,
): Promise<CredentialWipeResult> {
  let credentialsCleared = false;

  // ① 先清凭据。同步 —— 这一步之后就不该再有任何东西能发布新快照。
  try {
    deps.clearCredentials();
    credentialsCleared = true;
  } catch (error) {
    deps.onCredentialError?.(error);
  }

  // ② 再清组件。**无条件执行**（即使 ① 抛了）。
  let widgetsCleared = false;
  try {
    await deps.clearWidgets();
    widgetsCleared = true;
  } catch (error) {
    deps.onWidgetError?.(error);
  }

  return { credentialsCleared, widgetsCleared };
}
