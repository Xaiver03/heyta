/**
 * @heyta/node-host
 *
 * 非 Web 宿主的**程序化入口**。CLI 见 `cli.ts`。
 */
export * from './host.js';

export {
  KEYCHAIN_SERVICE,
  createKeychainSecretStore,
  createSecurityCliRunner,
  isKeychainAvailable,
  quoteForSecurity,
  type KeychainRunner,
  type KeychainSecretStoreOptions,
  type WritableSecretStore,
} from './keychain-secret-store.js';

export {
  TOKEN_ENV_VAR,
  describeStdioStartup,
  startMcpStdioServer,
  type McpStdioOptions,
  type McpStdioServer,
} from './mcp-stdio-server.js';

export {
  readToken,
  startLocalApiServer,
  type LocalApiServer,
  type LocalApiServerOptions,
} from './local-api-server.js';

/**
 * 自动更新检查核心（宿主无关）—— 从 `@heyta/app-host` 透出。
 *
 * 🔴 为什么在这里再导出一次，而不是让壳直接 import `@heyta/app-host`：
 * 桌面壳（`apps/desktop`）的主进程**只允许**经 `@heyta/node-host` 接业务
 * （`apps/desktop/tests/reuse.spec.ts` 钉死）。更新检查要发请求、校验响应契约、
 * 决定弹哪一种，属于共享语义，住在 `packages/app-host/src/app-update.ts`。
 * 所以由宿主这一层把它透出去，壳从**唯一入口**拿到即可，不必自己接一遍。
 */
export {
  APP_UPDATE_START_DELAY_MS,
  APP_UPDATE_INTERVAL_MS,
  buildAppVersionUrl,
  checkAppUpdate,
  decideAppUpdatePrompt,
  type AppUpdateCheckInput,
  type AppUpdateCheckResult,
  type AppUpdatePrompt,
} from '@heyta/app-host';
