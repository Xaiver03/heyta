/**
 * 站点的**部署地址**（绝对 URL 的根）
 * ======================================
 *
 * 为什么要单独一个文件、而不是写在生成器或 `paths.ts` 里：
 *
 * 🔴 **它被两个世界同时需要，而那两个世界的模块系统不同。**
 *   - **入口生成器**（`scripts/gen-entries.mjs`）跑在 Node 里，读不到
 *     `import.meta.env`（那是 Vite 注入的），只能读 `process.env`；
 *   - **测试**（`tests/seo-head.spec.ts`）跑在 vitest 里，要按同一个口径
 *     算出"canonical 应该是什么"，否则测试与生成器会各算一套。
 *
 * 于是"默认地址"和"怎么规范化"只能有一份 —— 就是这里。放在 `paths.ts` 里
 * 不行：那个文件在顶层读 `import.meta.env.BASE_URL`，Node 一 import 就抛。
 *
 * ## 为什么这一个地址有默认值，而应用地址（`VITE_APP_URL`）没有
 *
 * 应用地址没配时**什么都不渲染** —— 一个猜出来的应用地址点下去是 404，
 * 比没有链接更坏。
 * canonical / hreflang / sitemap 不一样：规范和爬虫都要求它们**必须是绝对
 * 地址**，所以不能"没有就不输出"。那就只剩一个选择：给一个明确的部署地址，
 * 并在换域名时用 `VITE_SITE_URL` 重建站点（换域名是一次构建参数，
 * 不是一次改代码 —— 与 `VITE_APP_URL` 同一条设计）。
 */

/**
 * 当前真实部署地址（2026-09-30 起 `https://heyta.waytofuture.cn`）。
 *
 * 🔴 换域名时**两件事必须一起做**，只做一件都会留下一个自己声明旧地址的站点：
 *   ① 部署构建传 `VITE_SITE_URL`（这一条是原设计的"一次构建参数"）；
 *   ② **改这里并重跑 `pnpm --filter @heyta/landing gen:entries`**。
 *
 * 为什么②不能省：`index.html` 与各入口页是**已提交的生成物**，而
 * `pnpm check` 的第一道门禁 `check:entries` 会用**本常量的默认值**重新生成
 * 一遍再与提交物逐字节比对（`scripts/gen-entries.mjs --check`）。
 * 只做①，仓库里提交的产物继续自我声明旧域名；只做②，部署时又漏掉新域名。
 *
 * （2026-09-27 的 tmp → finlaw 那次迁移同时做了这两件事；这里沿用同一口径。）
 */
export const DEFAULT_SITE_ORIGIN = 'https://heyta.waytofuture.cn';

/**
 * 把环境变量规范化成"不带尾斜杠的绝对地址"。
 *
 * 去掉尾斜杠不是洁癖：拼接处全部写成 `${origin}/${path}`，只要传进来的值
 * 带一个尾斜杠，就会得到 `https://x//features/` —— 而**双斜杠在爬虫眼里
 * 是另一个地址**，于是 canonical 与实际地址不一致，页面自己声明"我不是正版"。
 */
export function siteOriginFrom(raw: string | undefined): string {
  return (raw ?? DEFAULT_SITE_ORIGIN).replace(/\/+$/, '');
}
