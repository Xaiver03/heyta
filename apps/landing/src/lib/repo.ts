/**
 * 仓库公开地址 —— **全站唯一一份定义**
 * =====================================
 *
 * 🔴 这里曾经（私有时期）被整链摘掉：导航、首屏、收尾 CTA、页脚全都不再
 * 指向 GitHub，因为死链接比没有链接更坏。2026-09-29 仓库转公开
 * （`github.com/Xaiver03/heyta`），这条链路按 `Nav.tsx` 文件头的清单恢复。
 *
 * 消费方：导航的 GitHub 图标、收尾 CTA 的「看源码」、页脚的「在 GitHub 上查看」
 * 与文档分组、自建区的「自建指南」链接。
 *
 * ⚠️ 哪天仓库再转私有：先摘消费方，再删这个文件 —— 顺序反了就是一屏死链接。
 */
import { SITE_PAGES } from '../site/pages.js';

export const GITHUB_URL = 'https://github.com/Xaiver03/heyta';

/**
 * 自建指南 —— 公页上指向它的**唯一一处定义**，有两个消费方：自建区（`SelfHost.tsx`）
 * 与页脚的「部署指南」（`Footer.tsx`）。
 *
 * 🔴 为什么是常量而不是页面上的命令：**命令属于指南，不属于落地页**
 * （判据与缘由见 `tests/public-copy-register.spec.tsx` 文件头）。
 * 自建区只负责把"这件事做起来是什么样"说清楚，然后把需要逐条执行的东西
 * 交回给指南。
 *
 * ⚠️ 路径**不要**在别处再抄一遍：页脚的文档分组以前自己写了一份，
 * 于是"指南搬家"要改两处，而漏掉的那一处表现为链接 404。
 *
 * 🔴 2026-10-03 第一次换目标：这里以前指 `docs/runbooks/local-server-verification.md`
 * —— 那是给 **P0 验收**写的手册，它的第一节是一张**本团队内部机器表**
 * （SSH 别名、公网 IP、哪台同时是我们的公网部署机），而落地页把"跟着跑一遍就能起来"
 * 的承诺挂在它身上。也就是说：**对外承诺的路径上既没有面向陌生人的部署路径，
 * 又把内部运维现场暴露在公开页面上。** 当时改指 `docs/runbooks/self-host.md`。
 * 那件事登记在 `docs/research/self-host-distribution-audit.md` G-40③。
 *
 * 🔴 2026-10-03 第二次换目标，理由与第一次不同 —— **第一次是内容不对，这次是链不到**：
 * 发布落地页后实测 `curl -o /dev/null -w '%{http_code}'`，
 * `https://github.com/Xaiver03/heyta/blob/main/docs/runbooks/self-host.md` 回 **404**
 * （仓库根回 200，页脚另外四条 `blob/main/…` 全部回 200 —— 只有这一条是死的，
 * 因为它只存在于还没合入的分支上）。
 * 而当时的判据是 `existsSync(仓库根/<路径>)`，**它量的是我这棵工作树，不是链接真正
 * 指向的那个公开远端的默认分支** —— 所以门禁绿、线上死链。
 *
 * ⇒ 站内文章才是与落地页**同一次发布**的 target：`/docs/selfhost/` 由同一个构建产出、
 * 同一条 rsync 上线，不存在"改了落地页但目标还没发布"这种中间态。
 * 路径从页面注册表里取（不抄第二份），并做成**同源相对路径** —— 换域名时它不需要跟着改。
 * ✅ 代价登记在 G-49 的**已经关掉**（2026-10-03）：站内那篇文章原本是入口命令的第 4 份抄件，
 * 而现在 `packages/i18n/src/locales/{zh-CN,en}.ts` 两份词条表都在
 * `check:selfhost-entry-command` 的扫描集里（`source: 'copy'` 那一档），
 * 浏览器侧另有一条独立读 runbook 的对照判据。留这一行是为了记下"这条链的目标同时是一份抄件"
 * 这件事本身 —— 它不再是风险，但它是这个链接为什么必须与文档同批发布的理由。
 */
export const SELF_HOST_GUIDE_URL = (() => {
  const page = SITE_PAGES.find((p) => p.id === 'selfhost');
  if (!page) {
    throw new Error(
      '页面注册表里没有 id="selfhost" 的条目 —— 自建指南的链接会静默指向一个不存在的页面。',
    );
  }
  return `${page.path}/`;
})();

