# SSOS "AI 配置路由"层 设计分析

> 目标：为「本地优先、端到端加密的任务管理器」提取可复用设计。
> 证据均来自只读阅读；未证实的内容一律列入文末「未读到」。
> 仓库根：`/Users/rocalight/Desktop/All in one Data/01_PROJECTS/ssos`（焦点文件全部存在，`src/` 优先）。

## 数据模型

核心是**单表多用途**：`public.ai_configurations`（DDL：`services/api/migrations/V1.0.0__baseline_schema.sql:10146`）。字段（同处）：

`id uuid PK`、`workspace_id uuid`(可空)、`name`、`provider`、`api_key_encrypted text`、`base_url`、`model`、`is_active`、`is_default`、`config_options jsonb`、`max_tokens_per_request`(默认4096)、`temperature numeric(3,2)`(默认0.7)、`rate_limit_rpm`、`description`、`last_used_at`、`last_error_message/at`、`created_by/at`、`updated_at`、`task_type text DEFAULT 'all'`、`system_prompt`、`prompt_variables jsonb`、`embedding_model`、`embedding_dimensions`、`embedding_base_url`、`is_global bool`、`failover_priority integer`、`updated_by`。

约束：`api_key_encrypted IS NULL OR <> ''`；`provider = ANY(['aiping','openai','deepseek','anthropic','azure','custom'])`（后由 `V40.20` 增列 `typesafe`）；`task_type` CHECK；`temperature between 0 and 2`；`chk_global_no_workspace CHECK ((is_global=false) OR workspace_id IS NULL)`；唯一 `(workspace_id,name)`；`idx_ai_config_global_default ON (task_type) WHERE is_global AND is_default`（`V4.0__feat_admin_ai_global_config.sql:20-22`）；`uq_ai_config_active_default ON (workspace_id,task_type) WHERE is_default`（`V6.7__feat_validation_constraints.sql:77`）。

运行时契约 `AIConfig`（`services/api/src/lib/ai-adapter.ts:28`）：

```ts
export interface AIConfig {
  provider: string; model: string; api_key_encrypted: string; base_url: string
  cache_scope?: string; response_cache_enabled?: boolean
  temperature?: number; max_tokens_per_request?: number
  system_prompt?: string; config_options?: Record<string, unknown>
}
```

嵌入用独立 `EmbeddingConfig { base_url; api_key; model; dimensions }`（`ai-adapter.ts:143`）。任务枚举 `AI_CONFIG_TASK_TYPES`（`services/api/src/domain/ai-config-contract.ts:3`）：`all, bookkeeping, ocr, embedding, compliance_qa, contract_review, trial_balance_diagnostics, task_planning, data_analysis, system_one`（注释说明 `system_one` 因 API 不是 chat-completions 形状而单列）。存储位置：Postgres 表（明文键经 AES 加密），环境变量仅作最后兜底（`config-resolver.ts:100-109, 177-195`）。注：baseline 里 `embedding_dimensions` 默认是 1536，种子迁移改为 1024（`V23.4__configure_optimal_ai_models.sql:229-243`）。

**配置演化证据（说明"模型名写死在迁移里"的实际后果）**：`V11.8__feat_seed_global_ai_config.sql:38-221` 种下 4 条全局行（`all/ocr/embedding/bookkeeping`，provider 全 `aiping`）；`V23.4` 先 `UPDATE ... SET is_active=false WHERE is_global=true` 清空再按评测重种（OCR 主 `Qwen3-VL-30B-A3B-Instruct`、备 `moonshot-v1-k2.5`）；`V30.9__unify_dialogue_ai_models.sql` 又把 7 个对话任务强制成 `DeepSeek-V4-Flash-0731`；`V34.87__switch_active_ai_models_to_deepseek.sql` 再禁用 aiping 与非 DeepSeek 行、改直连 `https://api.deepseek.com`（OCR 用 `deepseek-v4-flash-vision-exp`）。每一次换模型都是一次数据迁移。同文件 `:76, :96` 的排序是 `failover_priority NULLS LAST, updated_at DESC, id`。

## 路由机制

不是"模型名→用途"硬编码，而是四层：**task → workload → capability → config chain**（`docs/08-project/ai-routing-unified-architecture.md:9-12`，词表见 `services/api/src/lib/ai-routing-contract.ts:4-5`）：

```ts
export type AIWorkload = 'text'|'vision_extract'|'vision_reasoning'|'embedding'|'image_generation'
export type AICapability = 'vision'|'tool_calling'|'structured_output'|'embedding'|'image_generation'
```

调用方只表达 `AIRoutingInput { taskType, workspaceId?, hasImage?, workload?, requiresToolCalling? }`；`resolveAIRoutingRequest`（`ai-routing-contract.ts:64`）推导 workload 与 `requiredCapabilities`（如 `vision_extract → ['vision','structured_output']`）。`getAIConfigCapabilities`（`:40`）先读 `config_options.capabilities`，缺失才按 provider/model 规则推断。统一入口 `resolveAIConfigs(input)`（`services/api/src/lib/config-resolver.ts:150`）逐候选做 `requiredCapabilities.every(cap => configSupportsCapability(...))` 过滤（`:157-159, 167-169`）。`selectAIConfigs`（`services/api/src/lib/ai-model-router.ts:32`）再按 `userTier/complexity` 重排。选择逻辑有明确例外：`embedding`/`image_generation` 直接返回，不与聊天模型混用（`ai-model-router.ts:41`；`getTaskFallbackChain` 在 `ai-routing-contract.ts:98` 对这两类返回 `[taskType]`，注释：`Embeddings and image generation never leak into chat fallbacks.`）。System One 决策层有独立解析器 `services/api/src/services/system-one/config-resolver.ts:121`（store-first，缺 key 则 env）。

## 回退与重试

数字全部来自 `services/api/src/lib/ai-adapter.ts:164-169`：

```ts
const DEFAULT_AI_TIMEOUT_MS = 90_000 // 90s per attempt
const MIN_AI_TIMEOUT_MS = 5_000
const MAX_AI_TIMEOUT_MS = 120_000
const EMBED_TIMEOUT_MS = 30_000
const SELF_HOSTED_EMBED_TIMEOUT_MS = 60_000
const MAX_ATTEMPTS = 3          // 3 total attempts (1 initial + 2 retries) per config
```

- 超时来自 `AGENT_AI_TIMEOUT_MS`，经 `getAIRequestTimeoutMs()` 夹在 [5s,120s]（`:184-188`）；compose 默认 `AGENT_AI_TIMEOUT_MS: ${AGENT_AI_TIMEOUT_MS:-120000}`（`docker-compose.prod.yml:227`、staging `:92`）。
- 可重试判定 `isRetryableProviderError`（`:171`）：`code === 408 || code === 429 || code >= 500`；`AIContentSafetyError` 不重试；无状态码视为可重试。
- 退避 `Math.pow(2, attempt) * 1000` → 1s、2s（`:416, 505`）。
- 超时**不重试**：`if (e.name === 'AbortError') { lastError = new Error('AI 服务响应超时，请稍后重试'); break }`（`:406-409`，failover 内 `:497-500`）。
- 链式失败转移 `callAIWithFailover`（`:431`）：对每个 config 内层重试最多 3 次，非瞬态错误立刻 `break` 换下一个 config（`:489-494`）。工具调用版 `callAIWithToolsWithFailover`（`:518`）；流式版 `streamAIWithFailover`（`ai-adapter-streaming.ts:362`）**每个 config 只尝试一次**（`for (const config of configs)` 内无重试），失败即 `[AI Stream] Config failed, trying next...`。
- 链的顺序即 `failover_priority ASC`（`config-resolver.ts:85`）；语义"1(primary), 2+(fallback), NULL = not in chain"（`V5.9__feat_failover_priority.sql:4`）。
- 任务级回退链 `getTaskFallbackChain`：视觉任务可回落 `ocr`，最后回落 `all`（`ai-routing-contract.ts:98-106`）。
- 上下文超窗 `AIContextWindowExceededError` 直接跳出不再重试（`:401-404`）。
- 缓存：仅当 `response_cache_enabled === true` 时用 `generateCacheKey(messages, config, fingerprint)`；scope 为 workspace+workload+task+配置版本（`config-resolver.ts:25-27, 57-66`）。

## 密钥管理

存储：`api_key_encrypted`，注释为 `Encrypted API key using AES-256-GCM. Format: salt:iv:authTag:ciphertext`（`V1.0.0__baseline_schema.sql:10185`）。`encryptApiKey` → `encryptManagedData(apiKey, 'ai-provider-api-key', keyRing)`（`lib/crypto.ts:127`）；旧格式解密 `decrypt`（`:82`）；密钥来自 `ENCRYPTION_KEY`，生产缺失即抛错（`:22-24`），开发回落 `'dev-key-not-secure'`（`:27`）。**解密对未加密值直接原样返回**（`:155-156`，为迁移兼容）。

轮换：`scripts/rotate-ai-provider-credentials.ts` 仅做**重加密**（re-encrypt），默认 dry-run；写入需 `DATA_ENCRYPTION_ROTATION_CONFIRMATION === 'ROTATE_AI_PROVIDER_CREDENTIALS'`，且要求具名 `DATA_ENCRYPTION_CURRENT_KEY_ID`；注释明确 `deliberately reports counts only: neither keys nor ciphertext are emitted`（`:23-27`）；用 `WHERE api_key_encrypted = ${old}` 做并发保护（`:61-65`）。

掩码：管理端 SQL 一律 `LEFT(api_key_encrypted, 8) || '****' AS api_key_masked`（`routes/admin/ai-config.ts:107-110, 176-178, 216-218, 275-277, 632-634`）——注意它截的是**密文**前缀。用户侧路由的字段白名单完全不含 key：`userFacingConfigFields`（`routes/ai-configurations.ts:236-241`），注释 `API keys are deliberately excluded even for workspace-owned overrides.`（`:244`）。调用日志 `recordAIInvocation` 只记 provider/model/base_url/protocol/outcome/cache_scope/usage，不含凭据（`ai-adapter.ts:201-222`），且 base_url/错误体过 `sanitizeOperationalDiagnosticMessage`；该函数有 `api_key` 等键名正则并替换为 `[REDACTED]`（`lib/operational-diagnostics.ts:10-13, 27-35`）。`ai-auth.ts:15` 规定只有 `custom` 可 `auth_mode:'none'`，其余强制 bearer。

## 管理面

`services/api/src/routes/admin/ai-config.ts`，整体 `router.use('*', superAdminMiddleware)`（`:21`），逐路由 `requireAdminPermission('ai-config:read'|'ai-config:write')`。端点：

- `GET /`、`GET /global`：列表/全局（掩码 key）。
- `POST /global`：按 `task_type` upsert 全局默认（`:140`）；`PATCH /:id`、`DELETE /:id`。
- `POST /test`：连通性探测（embedding 走 `/embeddings`，其余 `/chat/completions`，`:411-447`），`auth_mode` 校验。
- `GET /models`：有 `base_url` 则代理该 provider `/models` 并用库内凭据鉴权；否则聚合 AI Ping + OpenRouter 去重（`:471-583`）。
- `GET|POST /balance`：AI Ping 余额；**拒绝 query 传 key**：`API key query parameter is not supported`（`:594`）。
- `GET|POST /failover-chain`、`PATCH /failover-chain/reorder`、`DELETE /failover-chain/:id`：链的增删排序，reorder 在事务内先清 `is_default` 再按序写 `i+1`（`:730-757`）。
- `GET|POST /allowed-models`：写全局 `config_options.allowed_models / allowed_embedding_models / allow_workspace_model_override`（`:802-861`）。
- `GET /routing-stats`：按模型/任务聚合（`:864`，SQL 里用 `ai_usage_logs`）。

用户侧 `routes/ai-configurations.ts`：`authMiddleware` + `requireHumanCredential`（`:20-21`），写操作另过 `authorize(..., 'ai:configure', ...)`（`:78-101`）。`POST /` 被显式禁用：`Workspace AI connection settings are managed by the system administrator`（`:416-418`）。真正用户写路径只有 `PUT /override-model` 与 `PATCH /:id`。

## 优先级/多租户

优先级（代码）：workspace 精确任务行 → 任务链（task → ocr → all）→ env（`config-resolver.ts:150-198`；文档写法 `workspace → task → shared capability → all → env`，`ai-routing-unified-architecture.md:12`）。workspace override **只覆盖模型，不覆盖 provider/key**：行内 `config_options = { inherits_global:true, model_override }`，provider 固定 `'aiping'`/沿用全局（`config-resolver.ts:221-245`；`ai-configurations.ts:489-509`）。用户仅能改 `task_type==='bookkeeping'`（`:537-539`，`overrideModelSchema.task_type: z.literal('bookkeeping')`），且只能改 `model` 一个字段（`fields.length !== 1 ... 'Workspace users may only change the AI model'`，`:542-545`）。管理员开关 `allow_workspace_model_override` 默认 false（`:170-171, 232`）。全局每 task 仅一个 default，workspace 每 task 至多一个 active default（见上唯一索引）。

## 校验

- Zod：`providerSchema/modelNameSchema/optionalApiKeySchema/systemPromptSchema`（长度上限 `admin/ai-config.ts:23-28, 40-44`），`globalConfigSchema/updateSchema/testSchema/allowedModelsSchema`；64KB body 上限（`:23, 32-38`）。
- base_url：`aiBaseUrlSchema = z.string().max(2048).url().refine(isAllowedAIBaseUrl)`（`:57`）。`isAllowedAIBaseUrl`（`lib/ai-config-url.ts:107`）要求 https、无 userinfo/query/hash、拒绝 localhost、拒绝私有/保留 IP、host 必须在 allowlist（默认 12 个中国区域名，可用 `AI_ALLOWED_BASE_URL_HOSTS` 覆盖，`:82-101`）。
- 保存后仍在发请求路径上复筛：`dropUnapprovedProviders`（`config-resolver.ts:145-147`），注释 `Enforcement has to sit on the path that actually sends the request, not only on the path that stores it.`
- provider/model 一致性 `isModelCompatibleWithProvider`（`config-resolver.ts:40`）。
- capability 过滤即"模型是否满足 workload"的校验（见路由）。
- `aiConfigProtocolOptionsSchema.safeParse` 后只回写合法 `protocol/api_format/endpoint_format/auth_mode`（`ai-config-contract.ts:26-37` + `withSafeProtocolOptions`）。
- DB CHECK 约束兜底。

## 值得移植的设计

1. **task → workload → capability 三层词表**：业务方只说 `taskType`，模型适配集中在 `ai-routing-contract.ts`，调用方不维护 provider 启发式（注释 `callers should not maintain provider/model heuristics`，`:39`）。
2. **capability 交集过滤**：`requiredCapabilities.every(...)` 一个表达式替代各调用点各自的视觉/工具判断。
3. **有显式顺序的配置链 + 语义化 `failover_priority`**（1=主，2+=备，NULL=不在链），并以 `NULLS LAST` 兜底排序。
4. **base_url allowlist 双点执行**：写入校验 + 发送前再过滤，抗历史脏行与后续收紧。
5. **重试分级**：仅 408/429/5xx 重试；非瞬态立刻 failover；超时不重试（`no point retrying a timeout`）。
6. **缓存 scope 内含 `config:${id}:${updated_at}`**，配置一变缓存自然失效。
7. **轮换脚本工程化**：默认 dry-run、需具名 key id、需确认串、只报计数、`WHERE old = old` 并发保护。
8. **权限阶梯**：凭据与 provider 仅 super-admin；workspace 用户只能在管理员 allowlist 内选模型，且只能选 bookkeeping 的 `model` 字段。
9. **密钥不出接口**：用户侧字段白名单排除 key，日志只记 provider/model，诊断文本正则脱敏。
10. **能力声明优先于推断**：`config_options.capabilities` 存在即采用，兼容推理仅作兜底（可移植为"显式能力位优先"）。

## 不要移植的部分

1. **按模型名子串重排**：`routeByTier` 用 `c.model.includes('GLM') || includes('Qwen3-32B')`、`includes('opus'|'gpt-5'|'deepseek-r1')`（`ai-model-router.ts:60-75`），且 `userTier` 实际只用于重排、不用于准入。脆弱且会随模型改名失效。
2. **`isModelCompatibleWithProvider` 的命名猜测**（正则/子串，`config-resolver.ts:40-55`）与 **`VISION_PROVIDERS` provider 集合推断**（`ai-routing-contract.ts:23, 50`）——文档自己说能力应优先声明。
3. **`decryptApiKey` 对未加密值原样返回**（`crypto.ts:155-156`）——静默接受明文密钥；目标项目不应保留"明文兼容"路径。
4. **默认盐/开发密钥**：`ENCRYPTION_SALT || 'ssos-encryption-salt-2026'` 与 `scryptSync('dev-key-not-secure', ...)`（`crypto.ts:27, 31`）。
5. **密文前缀掩码** `LEFT(api_key_encrypted, 8) || '****'`——泄露的是密文头 8 字符，既非真实密钥掩码也无安全意义，容易误读为"只在服务端可见"。
6. **迁移里硬编码密文凭据**：`V11.8__feat_seed_global_ai_config.sql:45` 直接写入一整段 `salt:iv:authTag:ciphertext` 字面量。仓库即凭证泄漏面。
7. **明文内容经服务端**：`assertAIInputSafe/OutputSafe`、`AIContextWindowExceededError` 估算、响应缓存都要求服务端持有明文消息与解密后的密钥（`ai-adapter.ts:325, 383, 451-459`）。本地优先 + E2EE 的目标项目无法照搬——只能保留"配置形状/优先级/能力过滤"，不能保留"服务端代收发 + 服务端持钥"。
8. **单聚合商默认 + 中国区域名 allowlist**：默认 `aiping.cn`、allowlist 只列大陆 host（`ai-config-url.ts:82-95`），把司法辖区策略写死在代码里。
9. **流式与非流式回退不对称**：非流式每 config 重试 3 次，流式 0 次，只用 reasoning 长度去重来掩盖重放（`ai-streaming.ts:374-429`）。
10. **`rate_limit_rpm`、`prompt_variables`、`last_error_message` 等列**存在于表中但未见到配套读写/强制逻辑（见下节）。

## 未读到的/不确定的

- 未逐一审计所有路由，无法保证**没有任何**客户端接口回传明文 provider key；我能确认的只有用户侧白名单排除与管理端 SQL 掩码。
- `rate_limit_rpm`、`prompt_variables`、`last_error_message/last_error_at`、`last_used_at` 这些列**未找到**写入或强制读取的代码路径（未穷尽搜索）。
- `allowed_models` / `allow_workspace_model_override` 是否在 `PUT /override-model`、`PATCH /:id` 之外还有执行点，未穷尽确认。
- 未找到 provider key 的**自动轮换/刷新**机制；`rotate-ai-provider-credentials.ts` 只是加密密钥（KEK）重加密，不是内容轮换。
- `config_options.capabilities` 由谁写入、是否有校验，未找到。
- `services/api/src/lib/ai-adapter.ts` 之外（如 `dist/`、测试、`env.ts` 全量 AI_* 变量）未读。
- `docs/02-features/ai-knowledge/` 下仅 README、`03_PROMPT_TEMPLATES.md`、`knowledge-source-citation-contract.md` 被检查；前者与提示模板**不含** provider/model 配置。`ai-knowledge/README.md:255` 指向的另一文档 `../04_technical/AI_SERVICE_CONFIGURATION.md` 不在本次范围、未读。
- `docs/SSOS_MODEL_RECOMMENDATIONS.md`（`ai-model-router.ts:5` 引用的评估报告）**不存在**（实际路径 `docs/` 下未找到）。
- 未确认 `AGENT_AI_TIMEOUT_MS` 在 staging/prod 之外的实际部署值；代码会把它夹到最大 120000（`ai-adapter.ts:184-188`）。