/**
 * 🔴 **生成物 —— 不要手改。** 改版本号去改仓库根 `package.json` 的 `version`，
 * 然后 `node scripts/gen-server-app-version.mjs` 重新生成。
 *
 * 用途：版本策略接口（`GET /api/app-version`）`latestVersion` 的**默认值**（可被 env 覆盖）。
 * 真源与理由见 `scripts/gen-server-app-version.mjs` 文件头。
 * `pnpm check:app-version-server`（= 本脚本 `--check`）钉住这份与真源逐字相同。
 */
export const HEYTA_DEPLOYED_APP_VERSION = '0.1.0';
