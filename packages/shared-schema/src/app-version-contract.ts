/**
 * 自动更新：**版本策略接口**的线协议契约。
 * ==========================================
 *
 * 定性见 [`docs/plans/app-auto-update.md`](../../../docs/plans/app-auto-update.md)。
 * 这份文件只钉三件东西，客户端与服务端**共用同一份**，谁也不许再写一遍字符串：
 *
 *   1. 路径常量（`APP_VERSION_PATHS`）；
 *   2. 请求查询串的形状（`appVersionQuerySchema`）；
 *   3. 响应体的形状（`appVersionResponseSchema`）。
 *
 * ## 🔴 为什么判定标志由服务端算、客户端只读
 *
 * 「当前版本比最新版高还是低」是一个**会读错**的判断：字符串比较下
 * `"1.2.10" < "1.2.9"`，一旦哪一端图省事用了字符串比较，就会让 `1.2.10`
 * 这类版本**永远检测不到更新**。把它收进服务端一处（`compareVersions` 数字段比较），
 * 客户端只读 `updateAvailable` / `forceUpdate` 两个布尔，这个坑在客户端就不可能再踩一次。
 *
 * ## 🔴 载荷零身份维度
 *
 * `deviceId` 只用于**灰度分桶**（同一设备多次请求落同一桶），不进响应、不落库、
 * 不参与任何按人给的判断。所以这条通道匿名可读，和 `holiday-adjustments` 同属
 * 「公共事实」那一类（ADR-0052）。
 */

import { z } from 'zod';

/**
 * 相对服务端根的路径（注册在 `/api` 前缀下，与 `HOLIDAY_ADJUSTMENT_PATHS` 同形状）。
 *
 * 名字取 `app-version` 而不是 `version`：后者太泛，将来 `/api/version` 很容易被
 * 别的语义占走（服务端自身版本、协议版本……），而这一条专指**客户端应用**的发布版本。
 */
export const APP_VERSION_PATHS = {
  /** `GET` 版本策略。匿名、只读、`Cache-Control: no-store`。注册在 `/api` 前缀下。 */
  public: 'app-version',
} as const;

/**
 * 端标识。
 *
 * 🔴 这是**封闭词表**：加一端要同时决定它「能不能自更新 / 能不能强装」（见设计文档第 4 节），
 * 而不是只在客户端随手传一个字符串就完事。服务端按它选 `downloadUrl`。
 */
export const APP_UPDATE_PLATFORMS = ['web', 'desktop', 'ios', 'android', 'harmony'] as const;
export type AppUpdatePlatform = (typeof APP_UPDATE_PLATFORMS)[number];

export function isAppUpdatePlatform(value: unknown): value is AppUpdatePlatform {
  return typeof value === 'string' && (APP_UPDATE_PLATFORMS as readonly string[]).includes(value);
}

/** 默认渠道。渠道用来给「同端不同分发」返回不同的下载地址（如 `stable` / `beta` / `googleplay` / `apk`）。 */
export const APP_UPDATE_DEFAULT_CHANNEL = 'stable';

/**
 * 版本号的**形状**：1–4 段纯数字，点分隔（`1`、`1.0`、`0.1.0`、`1.0.0.0`）。
 *
 * 🔴 刻意**只收数字段**：带前缀/后缀（`v1.2`、`1.2.0-beta`）会让「数字段比较」失义，
 * 而比较语义正是这条接口存在的理由。遇到这种值宁可 400，也不要在比较里猜。
 * 各壳的版本空间差异（`1.0` ≡ `1.0.0`）由「缺段补 0」在比较层吸收，不在形状层强求。
 */
export const APP_VERSION_RE = /^\d+(?:\.\d+){0,3}$/;

export function isValidAppVersion(value: unknown): value is string {
  return typeof value === 'string' && APP_VERSION_RE.test(value);
}

/**
 * 请求查询串。
 *
 * `platform` 与 `currentVersion` **必填**：一条「不知道该拿什么比」的更新检查如果静默成功，
 * 客户端就会以为自己是最新的 —— 那正是本机制最不该出的假绿。缺了直接 400。
 * `currentBuild` 可选（整数），iOS 同一 `MARKETING_VERSION` 下靠 build 号区分内测包。
 * `deviceId` 可选，只做灰度分桶。
 */
export const appVersionQuerySchema = z.strictObject({
  platform: z.enum(APP_UPDATE_PLATFORMS),
  channel: z.string().min(1).max(32).default(APP_UPDATE_DEFAULT_CHANNEL),
  currentVersion: z.string().regex(APP_VERSION_RE),
  currentBuild: z.coerce.number().int().min(0).optional(),
  deviceId: z.string().min(1).max(128).optional(),
});

/** 响应体。字段齐全、类型明确；`downloadUrl` 可为空串（某些端没有可点的下载地址时）。 */
export const appVersionResponseSchema = z.strictObject({
  platform: z.enum(APP_UPDATE_PLATFORMS),
  channel: z.string(),
  latestVersion: z.string(),
  minSupportedVersion: z.string(),
  updateAvailable: z.boolean(),
  forceUpdate: z.boolean(),
  downloadUrl: z.string(),
  releaseNotes: z.string(),
  publishedAt: z.string(),
  rolloutPercent: z.number().int().min(0).max(100),
});

export type AppVersionQuery = z.infer<typeof appVersionQuerySchema>;
export type AppVersionResponse = z.infer<typeof appVersionResponseSchema>;
