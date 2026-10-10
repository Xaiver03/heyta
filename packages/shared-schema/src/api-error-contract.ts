/**
 * 全局 HTTP 错误响应的**唯一信封**（2026-10-10 产品负责人裁决）
 * ================================================================
 *
 * ## 它解决什么
 *
 * 此前服务端的错误体至少有四种形状并存：
 *
 * | 形状 | 出处 |
 * |---|---|
 * | `{ error: string, code: string }` | 邮箱口令 / 注册验证码那条路 |
 * | `{ error: '字面量' }` | 全仓 200+ 处散写 |
 * | `{ statusCode, error, message }` | Fastify 默认（校验失败 / 404 / 未处理异常） |
 * | `{ statusCode: 500, error: 'Internal Server Error' }` | 兜底脱敏 |
 *
 * 同一台服务器对"同一类失败"说四种话，客户端就得写四种解析 —— 而漏写的那一种
 * 症状是"界面只说登录失败"（AGENTS §6.2 那张白屏表的第一行就是这类漂移的产物）。
 *
 * ## 信封
 *
 *   `{ "code": "stable_machine_code", "message": "human readable fallback" }`
 *
 * - `code`：**必填**、`snake_case`、稳定。客户端按**白名单**消费它（认不出就按
 *   HTTP 状态码分类），所以加码是纯加法，不改老客户端的行为。
 * - `message`：**必填**、给人与日志兜底的英文串。**界面文案不来自它** ——
 *   文案归 i18n（客户端按 code 取词条），这里只是"没有任何一层认得这个 code"时的兜底。
 * - 可选的上下文字段与 `code`/`message` **平级**（如 `policyCode`）—— 不嵌套，
 *   客户端的读取器保持"读顶层字段"一种写法。
 * - 限速/过载的秒数走 HTTP 标准的 **`Retry-After` 头**，不进响应体。
 *
 * ## 兼容性（读 AGENTS §0 再说"破坏"两个字）
 *
 * 客户端（`app-host/hosted-auth.ts`）本来就读顶层的 `code` 与 `message`，
 * 所以信封切换对认证客户端**零改动可消费**；读 `body.error` 的三处
 * （sync-client 两处、checkout 一处）随本批一起改。开发阶段、无存量客户端，
 * 不做双写。
 */

import { z } from 'zod';

/** 错误响应体的唯一形状。可选上下文字段（如 `policyCode`）与这两项平级。 */
export interface ApiErrorBody {
  readonly code: string;
  readonly message: string;
}

/**
 * 信封形状的 zod 判据（服务端测试与门禁共用这一份，不另写正则）。
 *
 * 🔴 `code` 的形状判定在这里只此一份：门禁脚本、信封单测、路由测试全都消费它。
 * `code` 取值允许三档既有写法：`snake_case`（auth 那条路，新码**应当**用它）、
 * `UPPER_SNAKE`（同步/分享协议的既有码，改拼写 = 动线协议契约，不值）、
 * `kebab-case`（`avatar-absent` 一个既有码）。**形状是契约，大小写不是。**
 */
export const apiErrorBodySchema = z.object({
  code: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/),
  message: z.string().min(1),
});

/** 判定一个响应体是否是信封形状（测试与门禁用；运行时客户端不用它）。 */
export const isApiErrorBody = (body: unknown): body is ApiErrorBody => {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return false;
  const record = body as Record<string, unknown>;
  return (
    typeof record['code'] === 'string' &&
    /^[A-Za-z][A-Za-z0-9_-]*$/.test(record['code']) &&
    typeof record['message'] === 'string' &&
    record['message'].length > 0
  );
};

/**
 * 服务端**不再逐字重说**的那批通用码（error handler 兜底与高频散写共用）。
 *
 * 🔴 这些串一旦有客户端白名单消费就不能改拼写；目前只有 `internal_error` 与
 * `validation_failed` 被泛化消费（按状态码分类兜底），其余是给日志与排障看的。
 */
export const COMMON_API_ERROR_CODES = {
  validationFailed: 'validation_failed',
  notFound: 'not_found',
  unauthorized: 'unauthorized',
  forbidden: 'forbidden',
  conflict: 'conflict',
  rateLimited: 'rate_limited',
  internalError: 'internal_error',
} as const;
