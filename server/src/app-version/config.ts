/**
 * 版本策略的**配置来源**：env → 类型化配置 → 响应体拼装。
 * ======================================================
 *
 * 与服务端别处的 env 一样：**不合理的值在启动时炸**（抛 `AppVersionConfigError`），
 * 而不是在运行时给客户端下发一个说不出所以然的答案。默认值全部有据可依（见每个字段）。
 *
 * ## 取值规则（对应设计文档 3.3）
 *
 * | 字段 | env | 默认 |
 * |---|---|---|
 * | `latestVersion` | `APP_LATEST_VERSION` | 服务端部署的 app 版本（根 package.json 生成常量） |
 * | `minSupportedVersion` | `APP_MIN_SUPPORTED_VERSION` | `0.0.0`（不强制） |
 * | `latestBuild` / `minBuild` | `APP_LATEST_BUILD` / `APP_MIN_BUILD` | 无 |
 * | `rolloutPercent` | `APP_ROLLOUT_PERCENT` | `100`（全量） |
 * | `releaseNotes` / `publishedAt` | `APP_RELEASE_NOTES` / `APP_PUBLISHED_AT` | 空串 |
 * | `downloadUrls` | `APP_DOWNLOAD_URLS`（JSON） | `{}` |
 *
 * `APP_DOWNLOAD_URLS` 的键是 `platform` 或 `platform/channel`，查表时先查更具体的那个。
 */

import {
  APP_UPDATE_PLATFORMS,
  type AppUpdatePlatform,
  type AppVersionQuery,
  type AppVersionResponse,
  isValidAppVersion,
} from '@heyta/shared-schema';

import { HEYTA_DEPLOYED_APP_VERSION } from './deployed-app-version.generated';
import { decideVersionPolicy } from './policy';

export class AppVersionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppVersionConfigError';
  }
}

export interface AppVersionPolicyConfig {
  latestVersion: string;
  minSupportedVersion: string;
  latestBuild?: number;
  minBuild?: number;
  rolloutPercent: number;
  releaseNotes: string;
  publishedAt: string;
  /** `platform` 或 `platform/channel` → 下载地址。 */
  downloadUrls: Record<string, string>;
}

function requireValidVersion(field: string, value: string): string {
  const v = value.trim();
  if (!isValidAppVersion(v)) {
    throw new AppVersionConfigError(
      `${field}=${JSON.stringify(value)} 不是合法版本形状（只收 1–4 段纯数字，点分隔，如 0.1.0）`,
    );
  }
  return v;
}

function parseOptionalInt(field: string, raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 0 || String(n) !== raw.trim()) {
    throw new AppVersionConfigError(`${field}=${JSON.stringify(raw)} 不是非负整数`);
  }
  return n;
}

function parseDownloadUrls(raw: string | undefined): Record<string, string> {
  if (raw === undefined || raw.trim() === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppVersionConfigError('APP_DOWNLOAD_URLS 不是合法 JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AppVersionConfigError('APP_DOWNLOAD_URLS 必须是一个 JSON 对象（键=platform[/channel]，值=URL 字符串）');
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      throw new AppVersionConfigError(`APP_DOWNLOAD_URLS["${key}"] 必须是字符串`);
    }
    out[key] = value;
  }
  return out;
}

/** 从 env 组装配置。缺省的 `latestVersion` 取服务端部署版本（生成常量）。 */
export function loadAppVersionPolicyConfig(
  env: NodeJS.ProcessEnv = process.env,
): AppVersionPolicyConfig {
  const latestVersion = requireValidVersion(
    'APP_LATEST_VERSION',
    env.APP_LATEST_VERSION?.trim() || HEYTA_DEPLOYED_APP_VERSION,
  );
  const minSupportedVersion = requireValidVersion(
    'APP_MIN_SUPPORTED_VERSION',
    env.APP_MIN_SUPPORTED_VERSION?.trim() || '0.0.0',
  );

  const rolloutRaw = env.APP_ROLLOUT_PERCENT?.trim();
  let rolloutPercent = 100;
  if (rolloutRaw !== undefined && rolloutRaw !== '') {
    const n = Number.parseInt(rolloutRaw, 10);
    if (!Number.isInteger(n) || n < 0 || n > 100 || String(n) !== rolloutRaw) {
      throw new AppVersionConfigError(`APP_ROLLOUT_PERCENT=${JSON.stringify(env.APP_ROLLOUT_PERCENT)} 必须是 0–100 的整数`);
    }
    rolloutPercent = n;
  }

  return {
    latestVersion,
    minSupportedVersion,
    latestBuild: parseOptionalInt('APP_LATEST_BUILD', env.APP_LATEST_BUILD),
    minBuild: parseOptionalInt('APP_MIN_BUILD', env.APP_MIN_BUILD),
    rolloutPercent,
    releaseNotes: env.APP_RELEASE_NOTES?.trim() ?? '',
    publishedAt: env.APP_PUBLISHED_AT?.trim() ?? '',
    downloadUrls: parseDownloadUrls(env.APP_DOWNLOAD_URLS),
  };
}

/** 下载地址查表：先查 `platform/channel`，再查 `platform`，都没有就空串。 */
export function downloadUrlFor(
  config: AppVersionPolicyConfig,
  platform: AppUpdatePlatform,
  channel: string,
): string {
  return config.downloadUrls[`${platform}/${channel}`] ?? config.downloadUrls[platform] ?? '';
}

/** 把「配置 + 一次请求」拼成对外响应。判定全部来自 `decideVersionPolicy`。 */
export function buildAppVersionResponse(
  config: AppVersionPolicyConfig,
  query: AppVersionQuery,
): AppVersionResponse {
  const decision = decideVersionPolicy({
    currentVersion: query.currentVersion,
    currentBuild: query.currentBuild,
    latestVersion: config.latestVersion,
    minSupportedVersion: config.minSupportedVersion,
    latestBuild: config.latestBuild,
    minBuild: config.minBuild,
    rolloutPercent: config.rolloutPercent,
    deviceId: query.deviceId,
  });

  return {
    platform: query.platform,
    channel: query.channel,
    latestVersion: config.latestVersion,
    minSupportedVersion: config.minSupportedVersion,
    updateAvailable: decision.updateAvailable,
    forceUpdate: decision.forceUpdate,
    downloadUrl: downloadUrlFor(config, query.platform, query.channel),
    releaseNotes: config.releaseNotes,
    publishedAt: config.publishedAt,
    rolloutPercent: config.rolloutPercent,
  };
}

export { APP_UPDATE_PLATFORMS };
