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
export const GITHUB_URL = 'https://github.com/Xaiver03/heyta';

/**
 * 自建指南 —— 公页上**唯一**指向它的地方由 `SelfHost.tsx` 渲染。
 *
 * 🔴 为什么是常量而不是页面上的命令：**命令属于指南，不属于落地页**
 * （判据与缘由见 `tests/public-copy-register.spec.tsx` 文件头）。
 * 自建区只负责把"这件事做起来是什么样"说清楚，然后把需要逐条执行的东西
 * 交回给仓库里那份会随构建一起更新的 runbook。
 *
 * ⚠️ 路径**不要**在别处再抄一遍：页脚的文档分组以前自己写了一份，
 * 于是"指南搬家"要改两处，而漏掉的那一处表现为链接 404。
 */
export const SELF_HOST_GUIDE_URL = `${GITHUB_URL}/blob/main/docs/runbooks/local-server-verification.md`;
