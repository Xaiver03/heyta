/**
 * 助手能力档位的**持久化语义**（宿主无关）
 * ======================================
 *
 * 本文件只管三件事，且只有这三件：
 *
 *   1. 两档的**字面量**在哪里定义（一份，不是四份）；
 *   2. **出厂默认**是哪一档；
 *   3. 从持久化通道**读回来**时怎么归一（fail-closed 的方向）。
 *
 * `AssistantTier` 这个**类型**与 `assistantGrants()` 这个**授权判定**在
 * `./ai-assistant.ts`，本文件不搬、也不重定义 —— 搬类型会让"档位"这件事
 * 有两个出处，而 ADR-0045 §2.2 的全部理由就是它只有一个旋钮。
 *
 * ## 为什么持久化语义要在 `packages/app-host`
 *
 * AGENTS.md §3.5：`apps/*` 只允许有一处平台差异。**"默认算只读还是算开写"
 * 就是业务语义** —— 它决定"模型这一次能不能改用户的数据"。
 *
 * 它原先长在 `apps/web/src/features/settings/aiStore.ts` 里（默认值 +
 * 一句 `candidate.assistantTier === 'read-and-propose' ? … : …` 的三元）。
 * 那是这份仓库已经付过学费的形状：`createTaskActions` 抽出来之后 web 那份
 * **从没被删掉**，两份漂了半年（§3.5 末尾那条教训）。写在这里的判据是：
 * **node-host 与移动壳接助手时，必然会自己再写一遍这三行** —— 而它们三个
 * 只要有一个的默认值或归一方向不同，同一个用户在三台设备上就有三种权限，
 * 且**没有任何一层会报错**。
 *
 * ## 🔴 本文件不碰"存哪儿"
 *
 * 持久化**通道**属于壳：Web 是 `localStorage` 里那块 `heyta.ai.settings` 的
 * JSON（与其他 AI 偏好同生共死，这是现状，本文件刻意没有去改它 ——
 * 换存储位置就是一次迁移，而它不属于"分层收口"这一步）；
 * 原生端会是 SQLite 或系统偏好。
 *
 * 所以这里的形状与 `./admin-client.ts` 同一条：**端口类型 + 纯逻辑**。
 * 壳给一个 `AssistantTierStorePort`，判定用这份，字面量不用自己写。
 *
 * ## 🔴 fail-closed 的方向是承重的
 *
 * `normalizeAssistantTier()` 只认**逐字等于**开写那一档的值。别的都落回只读，
 * 包括 `true`、`1`、`'READ-AND-PROPOSE'`、`'read_and_propose'`、`undefined`、
 * 以及旧版本根本没存过这个字段的情形。
 *
 * 持久化坏值仍然必须回到只读：未知或缺失的值不能因为一次配置损坏而获得写提案能力。
 */

import type { AssistantTier } from './ai-assistant.js';

/** 只读档：模型只看得见读工具，不产出写入提案。 */
export const ASSISTANT_TIER_READ_ONLY = 'read-only';

/** 开写档：写工具进上下文，但**仍然只产出提案**（确认才落 op，ADR-0045）。 */
export const ASSISTANT_TIER_READ_AND_PROPOSE = 'read-and-propose';

/**
 * 产品层的名称：执行。
 *
 * 持久化值继续保留 `read-and-propose`，这样已有设备和跨端配置无需迁移；
 * “提议”是内部确认链路的实现细节，不再作为用户可见的第三档心智。
 */
export const ASSISTANT_TIER_EXECUTE = ASSISTANT_TIER_READ_AND_PROPOSE;

/**
 * 两档**按权限从低到高**的固定顺序。
 *
 * ⚠️ 顺序是承重的，不只是列表：设置界面用 `.map()` 渲染单选项，
 * 低权限选项固定在前，高权限选项固定在后，避免不同端展示顺序漂移。
 */
export const ASSISTANT_TIER_ORDER: readonly AssistantTier[] = [
  ASSISTANT_TIER_READ_ONLY,
  ASSISTANT_TIER_READ_AND_PROPOSE,
];

/** 出厂默认：执行模式；真正落库仍必须逐条确认。 */
export const DEFAULT_ASSISTANT_TIER: AssistantTier = ASSISTANT_TIER_READ_AND_PROPOSE;

/**
 * 把持久化通道里读回的**原始值**归一成档位。
 *
 * 参数是 `unknown` 而不是 `string | undefined`：落盘的东西经过别人的手
 * （JSON 编辑、旧版本、别的实现写的同名键），把它假定成字符串就是
 * 把"看起来像真"重新请回来。
 */
export function normalizeAssistantTier(raw: unknown): AssistantTier {
  return raw === ASSISTANT_TIER_READ_AND_PROPOSE
    ? ASSISTANT_TIER_READ_AND_PROPOSE
    : ASSISTANT_TIER_READ_ONLY;
}

/**
 * 壳要提供的**唯一**端口。
 *
 * 🔴 `read()` 的契约是"取回原始值，取不到就返回 `undefined`，**不许抛**"。
 * 抛异常会把"存储坏了"变成"应用起不来"，而本文件这一层的最安全结果
 * 一直是"按只读继续"。
 *
 * `write()` 收到的值已经过 `normalizeAssistantTier()`，
 * 所以**坏值不可能被写回磁盘** —— 这一句是本端口存在的理由之一：
 * 归一如果放在壳那一侧，就仍然是每个壳各写一遍。
 */
export interface AssistantTierStorePort {
  read(): unknown;
  write(tier: AssistantTier): void;
}

export interface AssistantTierStore {
  /** 读回并归一（通道里没有 / 值不认识 ⇒ 只读）。 */
  get(): AssistantTier;
  /** 归一后写入，返回**真正落盘**的那一档（调用方以此为准，不要用自己传进来的值）。 */
  set(raw: unknown): AssistantTier;
  /** 回到出厂档并落盘。 */
  clear(): AssistantTier;
}

/**
 * 用壳给的端口装出一个档位仓库。
 *
 * 给"自己存这一档"的宿主用（node-host / 原生壳）。Web 不从这里取值 ——
 * 它的档位寄存在整块 AI 设置的 JSON 里，走 `loadAiSettings()`，
 * 但那条路上用的仍然是同一个 `normalizeAssistantTier()` 与
 * `DEFAULT_ASSISTANT_TIER`，**判定只有一份**。
 */
export function createAssistantTierStore(port: AssistantTierStorePort): AssistantTierStore {
  return {
    get: () => normalizeAssistantTier(port.read()),
    set: (raw: unknown) => {
      const tier = normalizeAssistantTier(raw);
      port.write(tier);
      return tier;
    },
    clear: () => {
      port.write(DEFAULT_ASSISTANT_TIER);
      return DEFAULT_ASSISTANT_TIER;
    },
  };
}
