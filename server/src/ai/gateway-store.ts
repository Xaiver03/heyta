/**
 * AI 网关上游的**持久化存储**（管理后台可改、运行时热生效）。
 *
 * 存储 = 一个 JSON 文件（`AI_GATEWAY_FILE` 或 `dataDir/ai-gateway.json`）。
 * 为什么不建表：本仓服务端迁移纪律很重（`db-migrations.md`：永不改已应用迁移、
 * 不用 `prisma migrate deploy` 直连部署）。网关配置是**运维级、低频、单实例主控**，
 * 用文件足够且零迁移风险；多实例部署时把该文件挂共享卷或改用配置下发即可（已注明）。
 *
 * 🔴 文件里含 **apiKey 明文** → 权限 0600；不给客户端、不进日志。
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { ManagedAiConfig } from '../config';
import { parseGatewayFromEnv, selectUpstream, type GatewayParseResult, type GatewayUpstream } from './ai-gateway';

/** 默认文件路径：`AI_GATEWAY_FILE` 优先，否则 `dataDir/ai-gateway.json`（相对 cwd）。 */
export function defaultGatewayFile(env: Record<string, string | undefined> = process.env): string {
  const explicit = env['AI_GATEWAY_FILE']?.trim();
  if (explicit !== undefined && explicit !== '') return explicit;
  const dataDir = env['HEYTA_DATA_DIR']?.trim() || './data';
  return `${dataDir.replace(/\/+$/, '')}/ai-gateway.json`;
}

/** 读文件里的上游（不存在/坏 → undefined，交回 env 回退）。 */
function readFileUpstreams(file: string): { upstreams: GatewayUpstream[]; skipped: GatewayParseResult['skipped'] } | undefined {
  if (!existsSync(file)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const arr = Array.isArray(parsed) ? parsed : (parsed as { upstreams?: unknown }).upstreams;
    // 复用 env 解析器的校验逻辑：把它塞回一个假 env 再解析。
    const result = parseGatewayFromEnv({ MANAGED_AI_UPSTREAMS: JSON.stringify(arr ?? []) });
    return { upstreams: [...result.upstreams], skipped: [...result.skipped] };
  } catch {
    return undefined;
  }
}

/**
 * 载入上游集合：**文件优先**（后台配置），文件不存在则回退 env。
 * `source` 说明生效来源，供后台展示"现在到底按哪份在跑"。
 */
export function loadGatewayUpstreams(
  env: Record<string, string | undefined> = process.env,
  file: string = defaultGatewayFile(env),
): GatewayParseResult & { source: 'file' | 'env' } {
  const fromFile = readFileUpstreams(file);
  if (fromFile !== undefined && fromFile.upstreams.length > 0) {
    return { upstreams: fromFile.upstreams, skipped: fromFile.skipped, source: 'file' };
  }
  return { ...parseGatewayFromEnv(env), source: 'env' };
}

/** 存盘（原子写：临时文件 + rename；0600 权限）。返回落盘后的上游（已校验）。 */
export function saveGatewayUpstreams(
  incoming: readonly unknown[],
  env: Record<string, string | undefined> = process.env,
  file: string = defaultGatewayFile(env),
): GatewayParseResult {
  const result = parseGatewayFromEnv({ MANAGED_AI_UPSTREAMS: JSON.stringify(incoming) });
  if (result.skipped.length > 0) {
    // 有非法项 → 拒绝整份写入（不半信半疑地存一半）。
    const err = new Error(`网关配置含非法项：${result.skipped.map((s) => `#${String(s.index)} ${s.reason}`).join('; ')}`) as Error & { code?: string };
    err.code = 'INVALID_GATEWAY';
    throw err;
  }
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${String(process.pid)}`;
  writeFileSync(tmp, JSON.stringify(result.upstreams, null, 2), { mode: 0o600 });
  renameSync(tmp, file);
  try { chmodSync(file, 0o600); } catch { /* 非 POSIX 忽略 */ }
  return result;
}

/** 运行时取主上游（托管代理每请求调用 → 后台改完即生效）。 */
export function storePrimaryConfig(
  env: Record<string, string | undefined> = process.env,
  file: string = defaultGatewayFile(env),
): ManagedAiConfig | undefined {
  const picked = selectUpstream(loadGatewayUpstreams(env, file).upstreams);
  return picked === undefined ? undefined : { baseUrl: picked.baseUrl, apiKey: picked.apiKey, modelId: picked.modelId };
}
