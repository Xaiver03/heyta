/**
 * `selfhost-voice.mjs` 的类型声明
 * ==============================
 *
 * 实现是**纯 JS**而不是 TS，因为它要被两个不同的消费方读到：
 *
 *   - `scripts/check-docs-voice.mjs` —— 由 `node` 直接当脚本跑的门禁，仓库里没有为
 *     `scripts/*.mjs` 配任何 TS 加载步骤；
 *   - `apps/landing/tests/public-copy-register.spec.tsx` —— vitest + `tsc` 类型检查。
 *
 * 而只写成 `.mjs` 时第二个消费方会在 `pnpm --filter @heyta/landing typecheck` 上报
 * **TS7016**（本仓库没开 `allowJs`，隐式 `any` 在 `strict` 下即错 —— 这句是本轮实测到的，
 * 报错原文就带着那个模块路径）。所以是「JS 实现 + 一份手写 `.d.mts`」。
 *
 * ⚠️ 这里**只做类型**，不复制判据。规则本体只住在 `.mjs` 里那一份。
 */

/** 词条表侧：某个 `site.*` key 是否落在自托管豁免区。 */
export function isSelfhostCopyKey(key: string): boolean;

/**
 * 渲染文本侧：整页豁免的页面 id。
 *
 * 类型是 `readonly string[]` 而不是字面量联合，是因为它要能在**站点注册表改名之后
 * 仍然编译通过** —— 那个漂移的捕获点是测试里的防呆断言（"豁免区里的 id 必须在注册表里
 * 真实存在"），而不是编译器。让编译器拦住反而会让下一次改名变成"改类型让它过"。
 */
export const SELFHOST_EXEMPT_PAGE_IDS: readonly string[];
