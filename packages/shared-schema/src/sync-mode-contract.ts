import { z } from 'zod';

/**
 * 账号级载荷模式（[ADR-0080](../../docs/adr/0080-e2ee-is-optional-with-device-held-key.md)）。
 *
 * - `e2ee`：入口只收密文。这是**默认值**，也是今天唯一存在过的行为。
 * - `readable`：入口只收明文。用户显式关掉端到端加密之后的形态。
 *
 * 🔴 这个值只描述"云上那一份能不能被服务端读"，**不描述**钥匙放在哪 ——
 * 钥匙由设备持有还是每次输入，是客户端自己的偏好，不上线协议。
 */
export const SYNC_PAYLOAD_MODES = ['e2ee', 'readable'] as const;
export type SyncPayloadMode = (typeof SYNC_PAYLOAD_MODES)[number];

export const syncPayloadModeSchema = z.enum(SYNC_PAYLOAD_MODES);

/**
 * 相对路径（不带 `/api`），与 `VAULT_KEY_PATHS` 同一约定。
 *
 * 为什么它必须是**独立**端点而不是塞进 `GET /sync/key-package`：
 * readable 模式下我们会把 key package 删掉，那个端点返回 404 ——
 * 而"暂无包"（新账号）与"已关闭加密"是两件事，客户端无法从 404 里分辨。
 */
export const SYNC_PAYLOAD_MODE_PATHS = {
  mode: 'sync/payload-mode',
} as const;

/**
 * GET 响应。**只有** `mode`：载荷世代仍然只在 `GET /sync/key-package` 上，
 * 两处各留一份就是两处会漂的抄件。
 */
export const syncPayloadModeResponseSchema = z.object({
  mode: syncPayloadModeSchema,
}).strict();

export type SyncPayloadModeResponse = z.infer<typeof syncPayloadModeResponseSchema>;
