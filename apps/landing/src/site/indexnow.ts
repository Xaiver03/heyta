/**
 * IndexNow 的站点索引键 —— **全站唯一一份定义点**
 * ==================================================
 *
 * ## 这是什么
 *
 * IndexNow 是一个**不需要账号**的索引提交协议：站点在根路径放一个
 * `<key>.txt`（**内容就是 key 本身**），之后把 URL 提交给
 * `https://api.indexnow.org/indexnow`，Bing / Yandex / Seznam / Naver 会据此
 * 优先来抓。
 *
 * 🔴 **它不是 Google 的通道** —— Google 不参与 IndexNow。它换来的是 Bing 及其
 * 联盟引擎的抓取优先级，所以它**不能替代** Search Console / Bing 站长平台的
 * 所有权验证。那两件事仍然要做，只是都需要人的账号会话（见
 * `docs/plans/seo-program.md` §6.2）。
 *
 * ## 为什么键值写在源码里，而不是 `public/` 下一个手写的文件
 *
 * `apps/landing/scripts/gen-entries.mjs` 会用这个常量生成
 * `public/<INDEXNOW_KEY>.txt`，于是它和 `sitemap.xml` / `robots.txt` 走**同一条**
 * `check:entries` 逐字节对账。
 *
 * 手写的失败方式是**改 key 时只改一处** —— 比如重新生成了一个 key、把新值贴进了
 * 提交脚本，站点上那份却还是旧的。而症状是 IndexNow 回 `403 / key not found`，
 * 看起来像"协议不认这个站点"，实际是两份 key 不一致。⇒ 只有这一个定义点。
 *
 * ## 为什么可以签进仓库
 *
 * 键值**不是秘密**：按协议它必须能被公开取到（`https://<域名>/<key>.txt`）。
 * 它只能证明"提交者对站点根有写权限"，与任何账号凭据无关。
 * ⇒ 不要把它当成秘密去轮换、也不要放进 `.env`（放进环境变量反而会让
 * 生成物依赖构建环境，而 `check:entries` 要对它逐字节对账）。
 */
export const INDEXNOW_KEY = '5df57f5b75d4db6e6aaa93c188a4f9b9';
