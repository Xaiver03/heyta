/**
 * 注销账号 = 服务端删 + 本机清，两件事的**顺序**在这里
 * =====================================================
 *
 * 批次 E3 量的原始缺陷：`DELETE /api/account` 在服务端存在了很久，
 * 但**客户端没有任何调用点** —— "自助注销"在界面上是一句空话，
 * 而 E2 修好的那条销毁反应也没有人去触发它（除了被动等一次同步拿到 401/410）。
 *
 * 这个文件是那条**主动**路径，而它存在的唯一硬理由是下面这条不变量：
 *
 * 🔴 **服务端没删成，一次本机销毁都不许发生。**
 *
 * 反过来的后果是自己造得出来的：一次 5xx、一次断网、一次响应形状不对，
 * 就把本机数据清了 —— 而账号在云端**还活着**。用户下次登录看到云端那份旧数据，
 * 于是"注销"变成了一次无声的数据丢失，而他刚刚以为自己行使了删除权。
 * 这条顺序由 `tests/account-closure.spec.ts` 用"失败时销毁器调用次数为 0"钉住。
 *
 * ## 四种结局必须各有各的名字
 *
 * `eraseLocalData()` 只说"清没清成功"，而界面要回答的是**两句不同的话**：
 * "账号没了没有"与"这台设备干净了没有"。把它们压成一个布尔，
 * 就会出现"账号还在、界面说已清除"或反过来。所以这里是一条**封闭词表**：
 *
 *   · `closed-and-erased`   —— 两件事都成了。
 *   · `closed-erase-failed`  —— 账号没了，本机没清（宿主没注册销毁器 / 销毁器抛错）。
 *   · `closed-erase-partial` —— 账号没了，本机清了一部分（逐类报告里有 `containerRemoved: false`）。
 *   · `not-closed`          —— 什么都没动，带服务端失败原因。
 *
 * ⚠️ 后三种都**不许**说成"彻底销毁"。备份与其它设备不在这次动作的作用域里
 * （ADR-0048 的分层实话），句子由壳按词表取词条。
 */

import { closeAccount, type HostedAuthFailureReason, type HostedAuthOptions } from './hosted-auth.js';
import type { DbDestroyReport } from '@heyta/storage';
import { eraseLocalData } from './local-erasure.js';

/** 注销这一步走到了哪里（封闭词表，见文件头）。 */
export type ClosureDisposition =
  | 'closed-and-erased'
  | 'closed-erase-failed'
  | 'closed-erase-partial'
  | 'not-closed';

export type ClosureResult = {
  disposition: ClosureDisposition;
  /** 只在 `not-closed` 时有值：服务端/网络那一侧的原因。 */
  failure?: HostedAuthFailureReason;
  /** 销毁的逐类凭据。没跑销毁就是 `undefined`（不是空数组 —— 两者要能分开）。 */
  reports?: readonly DbDestroyReport[];
  /** `closed-erase-failed` 的具体原因，进日志给人看。 */
  erasureError?: string;
};

export async function closeAccountAndEraseLocal(
  options: HostedAuthOptions,
  token: string,
): Promise<ClosureResult> {
  const closed = await closeAccount(options, token);
  if (!closed.ok) {
    return { disposition: 'not-closed', failure: closed.reason };
  }

  let reports: readonly DbDestroyReport[];
  try {
    reports = await eraseLocalData();
  } catch (error) {
    return {
      disposition: 'closed-erase-failed',
      erasureError: error instanceof Error ? error.message : String(error),
    };
  }

  // 逐类看，不看"有没有抛"：一类失败是**报告**，不是异常（抛了剩下的几类就不做了）。
  return reports.some((r) => !r.containerRemoved)
    ? { disposition: 'closed-erase-partial', reports }
    : { disposition: 'closed-and-erased', reports };
}
