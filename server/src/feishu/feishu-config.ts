/**
 * 飞书网页应用登录的**配置**（只从运维环境读，绝不从请求头/浏览器推导）。
 * ======================================================================
 *
 * 与 `server/src/config.ts` 里支付那几段同一条纪律：**显式配置，缺就禁用**。
 * 没有配 `FEISHU_LOGIN_APP_ID` / `FEISHU_LOGIN_APP_SECRET` 时返回 `null`，
 * 上层据此让 `/status` 报 `enabled:false`、`/start` 回 503 —— 而不是"看起来配了但
 * 授权页报 20027"那种最晚才被发现的失败。
 *
 * 🔴 `origin`（回调域名）**不接受请求 Host 推导**：生产配漏就是换票 20071，
 * 配错就是把授权码送到别人的域名。默认取 `PUBLIC_URL`（运营者早已必须显式配）。
 *
 * 环境变量（全部可选，成对出现才启用）：
 *   FEISHU_LOGIN_APP_ID            飞书自建应用的 App ID
 *   FEISHU_LOGIN_APP_SECRET        对应 App Secret（也可用 FEISHU_LOGIN_APP_SECRET_FILE 指向文件）
 *   FEISHU_LOGIN_ORIGIN            对外可达的站点 origin（默认 PUBLIC_URL）
 *   FEISHU_LOGIN_SCOPE             申请的权限范围（默认空 —— 不传 scope，避免未开通时报 20027）
 *   FEISHU_LOGIN_AUTHORIZE_ENDPOINT / _TOKEN_ENDPOINT / _USERINFO_ENDPOINT  覆盖协议端点（测试/私有化）
 *   FEISHU_LOGIN_ADMIN_OPEN_IDS    逗号分隔：只有这些 open_id 能自动关联到唯一管理员（空 = 不限）
 *   FEISHU_LOGIN_TENANT_KEY        只允许该飞书租户的用户登录（空 = 不限）
 *   FEISHU_LOGIN_AUTO_PROVISION    'false' 关闭普通面首次登录自动建号（默认开启）
 */

import * as fs from 'fs';

export interface FeishuLoginConfig {
  readonly appId: string;
  readonly appSecret: string;
  /** 对外可达的站点 origin，无尾斜杠。回调与产物页都基于它。 */
  readonly origin: string;
  /** 申请的权限范围；空串表示授权 URL 不传 scope。 */
  readonly scope: string;
  readonly authorizeEndpoint: string;
  readonly tokenEndpoint: string;
  readonly userInfoEndpoint: string;
  /** 回调地址（绝对 URL）。 */
  readonly redirectUri: string;
  /** 允许自动关联到唯一管理员的 open_id 白名单；空数组 = 不限制（单运营者私有部署的默认）。 */
  readonly adminOpenIds: readonly string[];
  /** 只允许该飞书租户登录；null = 不限制。 */
  readonly tenantKey: string | null;
  /** 普通面（app）首次登录是否自动建号。管理面永远不自动建号/提权。 */
  readonly autoProvision: boolean;
}

const DEFAULT_AUTHORIZE = 'https://accounts.feishu.cn/open-apis/authen/v1/authorize';
// v2 端点文档明确、实现广泛（与 x-c 的 feishuOAuthClient 同源）。
const DEFAULT_TOKEN = 'https://open.feishu.cn/open-apis/authen/v2/oauth/token';
const DEFAULT_USERINFO = 'https://open.feishu.cn/open-apis/authen/v1/user_info';

/** 读 App Secret：优先内联变量，其次 `_FILE`；两处都空返回空串。只报键名，绝不打印内容。 */
function readAppSecret(): string {
  const inline = (process.env.FEISHU_LOGIN_APP_SECRET ?? '').trim();
  if (inline) return inline;
  const filePath = (process.env.FEISHU_LOGIN_APP_SECRET_FILE ?? '').trim();
  if (!filePath) return '';
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'unknown';
    throw new Error(`FEISHU_LOGIN_APP_SECRET_FILE 指向的文件读不出来（${code}）：${filePath}`);
  }
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

export function loadFeishuLoginConfig(publicUrl: string): FeishuLoginConfig | null {
  const appId = (process.env.FEISHU_LOGIN_APP_ID ?? '').trim();
  const appSecret = readAppSecret();
  if (!appId || !appSecret) return null;

  const configuredOrigin = (process.env.FEISHU_LOGIN_ORIGIN ?? '').trim();
  const origin = trimTrailingSlashes(configuredOrigin || publicUrl);
  if (!origin) return null;

  const adminOpenIds = (process.env.FEISHU_LOGIN_ADMIN_OPEN_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  const tenantKey = (process.env.FEISHU_LOGIN_TENANT_KEY ?? '').trim() || null;

  return {
    appId,
    appSecret,
    origin,
    scope: process.env.FEISHU_LOGIN_SCOPE !== undefined ? String(process.env.FEISHU_LOGIN_SCOPE) : '',
    authorizeEndpoint: (process.env.FEISHU_LOGIN_AUTHORIZE_ENDPOINT ?? '').trim() || DEFAULT_AUTHORIZE,
    tokenEndpoint: (process.env.FEISHU_LOGIN_TOKEN_ENDPOINT ?? '').trim() || DEFAULT_TOKEN,
    userInfoEndpoint: (process.env.FEISHU_LOGIN_USERINFO_ENDPOINT ?? '').trim() || DEFAULT_USERINFO,
    redirectUri: `${origin}/api/auth/feishu/callback`,
    adminOpenIds,
    tenantKey,
    autoProvision: String(process.env.FEISHU_LOGIN_AUTO_PROVISION ?? '').toLowerCase() !== 'false',
  };
}
