/**
 * 同意留痕里那个"版本"到底能不能写 —— **一处裁决，三个写入口共用**。
 * ================================================================
 *
 * 背景：`users.termsAcceptedAt` 一直只有时间戳，而对外文本
 * （`packages/legal/src/documents/terms.ts` 的「同意留痕」条、`privacy.ts` 第 12 条）
 * 承诺的是"**一整套版本指纹**"。本模块负责把那句承诺落到一个可判别的值上。
 *
 * ## 🔴 为什么这里可能返回 `null`，而且 `null` 是对的答案
 *
 * 版本号不是"当前代码里那套文本的版本"这么随便的一串 —— 它是**对用户宣告过的那份文本**
 * 的身份。heyta 的部署方可以是任何人（`PRIVACY_*` 模板写的是德语法、莱比锡管辖，
 * `terms.html` 干脆由运营者自己上传），所以：
 *
 * | 这台实例 | 用户在勾选框旁边点开的是 | 留痕能写的版本 |
 * |---|---|---|
 * | 官方托管实例（`PUBLIC_URL` 主机名 = `OPERATOR.hostedDomain`） | heyta 的 `/legal/*`（就是 `@heyta/legal` 那九份） | `legalSetVersion()` |
 * | 任何别的实例 | `<baseUrl>/terms.html`、`/privacy.html` —— 运营者自己的东西 | **`null`** |
 *
 * 给第二行盖上 heyta 的版本号，就是**替别人宣告他发布了什么** ——
 * 与 D-01 里"替别人作出没有依据的承诺"是同一条错误，只不过这次写进的是数据库，
 * 三年后它会被当成证据读。`null` 说的才是实话："这条记录只有时间戳，
 * 文本身份由该实例的运营者掌握"。
 *
 * ## 为什么判定只看主机名，且逐字相等
 *
 * 与客户端那条分流（`packages/app-host/src/legal-links.ts`）**必须同构**：
 * 那边决定用户读到哪份文本，这边决定记录写哪份文本的版本。两边判法不一样，
 * 就会出现"读的是 A、记的是 B"的留痕 —— 而那正是留痕要防的失效。
 * 兄弟域名（`heyta.waytofuture.cn.evil.net`）不算官方，所以是 hostname 的
 * **相等**比较，不是 `startsWith` / `includes`。
 *
 * ⚠️ `OFFICIAL_HOSTED_DOMAIN` 是官方域名的第三份拷贝（另两份在 `@heyta/legal`
 * 与 `app-host`），由 `pnpm check:legal-host` 逐字对账钉住。
 */
import { loadConfigFromEnv } from './config';
import { LEGAL_SET_VERSION, OFFICIAL_HOSTED_DOMAIN } from './legal.generated';

/**
 * 这台实例是不是**法律意义上**的 heyta 官方托管实例。
 *
 * `publicUrl` 解析不出主机名时按"不是"处理 —— 拿不到自己的公网地址，
 * 就没有任何依据宣称自己是官方实例（fail-closed：宁可不写版本，也不写一个可能假的）。
 */
export const isOfficialHostedInstance = (publicUrl: string): boolean => {
  let hostname: string;
  try {
    hostname = new URL(publicUrl).hostname;
  } catch {
    return false;
  }
  return hostname.toLowerCase() === OFFICIAL_HOSTED_DOMAIN.toLowerCase();
};

/**
 * 写 `termsAcceptedAt` 时**必须同时**写进 `termsDocumentVersion` 的值。
 *
 * 返回 `null` = 这台实例无法为那份文本命名版本，留痕只留时间。
 * 调用点只在"确实要写时间戳"时调用它：没有时间戳却有一列版本号，
 * 是一条没有同意时刻的同意记录，比两列都空更误导人。
 */
export const consentedLegalSetVersion = (): string | null =>
  isOfficialHostedInstance(loadConfigFromEnv().publicUrl) ? LEGAL_SET_VERSION : null;
