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
