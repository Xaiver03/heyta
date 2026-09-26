/**
 * 端点健康状态 → 词条（+ 插值参数）
 * ==================================
 *
 * 🔴 与 `features/ai/disclosure-copy.ts` **完全同形**，理由也一样：
 * 设置页原来直接渲染 `describeEndpointHealth(health, now)` ——
 * 那是 `packages/ai` 里的一句**中文**，于是英文界面的用户看到
 * 「暂时停止使用（连续失败 3 次，30 秒后重试）」。
 *
 * 结构早在包里就做好了（`endpointHealthDisclosure()` 返回
 * `ok` / `failing` / `circuit-open` 三个 kind），只是壳里一直没用它 ——
 * 和「留多久」那条通道是一模一样的病。
 *
 * ⚠️ 这里返回 **key + 参数**而不是拼好的字符串：
 * 词条表负责文字，壳负责插值（和 `FocusTimer` 的 `{ reason }` 同一套规矩）。
 *
 * ⚠️ `switch` 穷尽三个 kind。`packages/ai` 以后加了新状态（比如"半开"），
 * 这里会**编译报错**（返回类型是 `HealthCopy`，漏 return 就是 `undefined`），
 * 而不是静默退回一句笼统的话。
 */

import type { EndpointHealthDisclosure } from '@heyta/ai';
import type { MessageKey } from '@heyta/i18n';

export interface HealthCopy {
  key: MessageKey;
  params: Record<string, string | number>;
}

export function endpointHealthCopy(disclosure: EndpointHealthDisclosure): HealthCopy {
  switch (disclosure.kind) {
    case 'ok':
      return { key: 'web.ai.health.ok', params: {} };
    case 'failing':
      return { key: 'web.ai.health.failing', params: { failures: disclosure.failures } };
    case 'circuit-open':
      return {
        key: 'web.ai.health.circuitOpen',
        params: {
          failures: disclosure.failures,
          retryInSeconds: disclosure.retryInSeconds,
        },
      };
  }
}