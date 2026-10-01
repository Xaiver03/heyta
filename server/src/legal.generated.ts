/**
 * 🔴 **生成物 —— 不要手改。**
 *
 * 由 `server/scripts/gen-server-legal.mjs` 从 `@heyta/legal` 生成，
 * `pnpm check:server-legal` 钉住它与真源一致。
 *
 * 为什么要生成而不是 import：`server/Dockerfile` 不打包 `@heyta/legal`
 * （九份对外文本的全量 AST，同步服务进程不该为两个字符串装它）。
 * 真源只有一份，理由与写法见 `server/scripts/gen-server-legal.mjs` 文件头。
 */

/**
 * **整套对外文本的版本指纹**，形如 `terms@1.0;privacy@1.0;…`（按 id 排序）。
 *
 * 它是 `users.terms_document_version` 里写进去的那个值，也就是对外文本
 * 「同意留痕」那一条承诺的东西：用户勾选时同意的是一**套**文件，
 * 所以钉住的是整套指纹，而不是单份文件的版本。
 *
 * ⚠️ 只有**官方托管实例**才有权写它（判定在 `src/legal-consent.ts`）：
 * 自托管机器对外发布的是运营者自己的文本，它的版本我们无法命名。
 */
export const LEGAL_SET_VERSION = "ai-and-transfer@1.0;data-rights@1.0;minors@1.0;permissions@1.0;personal-info-list@1.0;privacy@1.0;subscription-refund@1.0;terms@1.1;third-parties@1.0";

/**
 * 官方托管实例的域名 —— `@heyta/legal` 的 `OPERATOR.hostedDomain`。
 *
 * ⚠️ 这是这个域名的**第三份**拷贝（前两份：`@heyta/legal` 本体、
 * `packages/app-host/src/legal-links.ts` 的 `OFFICIAL_SITE_ORIGIN`）。
 * `pnpm check:legal-host` 逐字对账三份，漂移即红 ——
 * 客户端与服务端在这件事上给出不同答案，就是"注册时展示的文本"与
 * "留痕里写下的版本"指向两套东西，而那正是留痕要防的事。
 */
export const OFFICIAL_HOSTED_DOMAIN = "heyta.waytofuture.cn";
