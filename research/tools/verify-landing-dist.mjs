#!/usr/bin/env node
/**
 * `research/tools/verify-landing-dist.mjs` —— 落地页**产物层**的自洽判据。
 *
 * ## 它管的是"发出去的东西"，不管"代码逻辑对不对"
 *
 * 分工是这样切的，不是随手加的：
 *
 *  - 「每一条应用入口都带 `?lang=`」是**代码级**判据，归 `apps/landing/tests`
 *    （1312 条），并用变异验证过能红；
 *  - 「真浏览器点下去落在哪、界面是不是中文」是**线上**判据，归
 *    `e2e/live-site/live-domain.spec.ts`；
 *  - **这一份**管的是中间那一段：`vite build` 吐出来的那棵目录树，
 *    在"脱离 dev server、挂到 nginx 子路径之外"之后还是不是一个**自洽的站点**。
 *
 * 为什么需要这一段：本仓库踩过两次同一形状的事故 ——
 *   · Windows 打包机装出来的包里 `web-dist` 引用 `/app/assets/…` 而文件在根下，
 *     sha256 对账照样通过（`AGENTS.md` §7 第 82 条）；
 *   · PWA 的 `start_url`/`icons[].src` 写成根绝对路径，线上 `/sw.js` 拿回的是
 *     **落地页 HTML**，不报错、只是"点登录打开了官网"（`docs/runbooks/deployment.md` §3.7）。
 * 两次的共同点是**产物引用了不存在的东西，而命令退出码是 0**。
 *
 * ## 判据（全部是存在性/计数，不编阈值）
 *
 *  1. 入口页必须在：中文 + 英文的首页，和 `docs/selfhost/` 那一篇文章的两语版本。
 *  2. `index.html` 里引用的**每一个本地资源**必须真的在磁盘上（`/assets/…`、`/icons/…`、
 *     `/manifest.webmanifest`）。外链不归它管。
 *  3. 烘焙进产物的域名必须是预期的那一个：预期域名命中 ≥ 1，
 *     旧域名 `heyta.finlaw.cloud` 命中 **0**（R14 那条缺陷的形状就是"页面不报错但印着旧地址"）。
 *  4. 对外文案落在**它自己那一篇**上：中文 `docs/selfhost/index.html` 里
 *     现行那句（「服务起来不等于以后都不用管」）必须 ≥ 1、作废那句必须 0；
 *     作废那句在**整棵树**里也必须 0（英文页也扫，但现行句只在中文页逐篇断 —— 理由见下）。
 *     ⚠️ 这里踩过一次：第一版把"现行句"做成**全树计数 ≥1**，变异（把那一篇里的 4 处抹掉）
 *     **活了下来** —— 因为同一句话还散落在别处 3 处。全树计数只挡得住"整篇没了"，
 *     挡不住"这一篇被换回旧文案"。判据要钉在**它所属的那个文件**上才有牙。
 *     （两语文案的源头对账在 `scripts/check:selfhost-entry-command`，那是源码层；
 *     这一条量的是**产物**：源码对得上不等于发出去的字节对得上。入口 HTML 只负责
 *     路由和元数据，正文由共享的语言 chunk 在 hydration 时载入，因此现行句要在
 *     该入口的产物集合中检查，而不是只读空的 `<div id="root">`。）
 *
 * 任何一条不过 ⇒ exit 1 并点名是哪一条。判据强度是量出来的：拿一份真实产物跑绿，
 * 再把其中一条引用指向不存在的文件 / 把那一篇的现行句抹掉 / 往英文页塞旧域名，
 * 看它是否逐条转红（读数记在 `docs/research/self-host-distribution-audit.md`）。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const OLD_DOMAIN = 'heyta.finlaw.cloud';
const STALE_NEEDLE = '不是一个命令就完事';
/** 现行那句**只在它自己那一页上断**（理由见文件头判据 4 那条变异记录）。 */
const FRESH_PAGE = 'docs/selfhost/index.html';
// 文章正文先以 Markdown 字符串进入语言 chunk，构建产物因此保留强调标记。
// 这里按产物中的真实序列化形式校验，避免把源码阅读形态误当成发布字节。
const FRESH_NEEDLE = '服务**起来**不等于以后都不用管';
const REQUIRED_PAGES = [
  'index.html',
  'en/index.html',
  'docs/selfhost/index.html',
  'en/docs/selfhost/index.html',
];

const dist = process.argv[2];
const expectDomain = process.argv[3];
if (!dist || !expectDomain) {
  console.error('用法：node verify-landing-dist.mjs <dist 目录> <预期域名>');
  console.error('例如：node verify-landing-dist.mjs apps/landing/dist https://heyta.waytofuture.cn');
  process.exit(2);
}
if (!existsSync(dist) || !statSync(dist).isDirectory()) {
  console.error(`❌ dist 目录不存在或不是目录：${dist}`);
  process.exit(1);
}

const fails = [];
const notes = [];

/** 递归列出目录里所有文件（判"引用了但不在"要先有全集）。 */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(dist);
const rel = files.map((f) => f.slice(dist.length + 1));
notes.push(`产物共 ${String(files.length)} 个文件`);

// ① 入口页
const missingPages = REQUIRED_PAGES.filter((p) => !rel.includes(p));
if (missingPages.length) fails.push(`缺入口页 ${String(missingPages.length)} 张：${missingPages.join(', ')}`);
else notes.push(`四张必需页面都在（${REQUIRED_PAGES.join(' / ')}）`);

// ② index.html 引用的本地资源必须存在
const rootHtml = readFileSync(join(dist, 'index.html'), 'utf8');
const refs = [...rootHtml.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1] ?? '');
const local = refs.filter((r) => r.startsWith('/') || (!/^[a-z]+:\/\//u.test(r) && !r.startsWith('#')));
const absent = local.filter((r) => !existsSync(join(dist, r.replace(/^\//u, '').split('?')[0] ?? '')));
if (local.length === 0) fails.push('index.html 里没有引用任何本地资源 —— 这条判据没被走到，不算通过');
else if (absent.length) fails.push(`index.html 引用了 ${String(absent.length)} 个不存在的本地资源：${absent.join(', ')}`);
else notes.push(`index.html 的 ${String(local.length)} 个本地引用全部在磁盘上`);

// ③④ 域名对账走全树；文案走**它自己那一页**
const scanned = files.filter((f) => /\.(html|js)$/u.test(f));
const text = scanned.map((f) => readFileSync(f, 'utf8')).join('\n');
const count = (haystack, needle) => haystack.split(needle).length - 1;
const oldHits = count(text, OLD_DOMAIN);
const staleTree = count(text, STALE_NEEDLE);
const domainHits = count(text, expectDomain);
if (domainHits === 0) fails.push(`产物里一次都没有出现预期域名 ${expectDomain} —— 构建时没带 VITE_SITE_URL？`);
if (oldHits > 0) fails.push(`产物里残留旧域名 ${OLD_DOMAIN} ${String(oldHits)} 处`);
if (staleTree > 0) fails.push(`作废文案「${STALE_NEEDLE}」全树仍出现 ${String(staleTree)} 处`);

const freshPage = readFileSync(join(dist, FRESH_PAGE), 'utf8');
const freshPageHits = count(freshPage, FRESH_NEEDLE);
const freshAssetHits = scanned
  .filter((f) => f.endsWith('.js'))
  .reduce((total, f) => total + count(readFileSync(f, 'utf8'), FRESH_NEEDLE), 0);
const freshHits = freshPageHits + freshAssetHits;
const staleOnPage = count(freshPage, STALE_NEEDLE);
const staleInAssets = scanned
  .filter((f) => f.endsWith('.js'))
  .reduce((total, f) => total + count(readFileSync(f, 'utf8'), STALE_NEEDLE), 0);
if (freshHits === 0) fails.push(`${FRESH_PAGE} 对应产物集合里没有现行那句「${FRESH_NEEDLE}」—— 这一篇发出去的还是旧文案`);
if (staleOnPage + staleInAssets > 0) fails.push(`${FRESH_PAGE} 对应产物集合里仍印着作废那句 ${String(staleOnPage + staleInAssets)} 处`);
notes.push(
  `文本层扫了 ${String(scanned.length)} 个 .html/.js：预期域名 ${String(domainHits)} 处、旧域名 ${String(oldHits)} 处、作废文案全树 ${String(staleTree)} 处；${FRESH_PAGE} 现行句 ${String(freshHits)} 处`,
);

for (const n of notes) console.log(`   ${n}`);
if (fails.length) {
  for (const f of fails) console.error(`❌ ${f}`);
  console.error(`结论：${String(fails.length)} 条不过`);
  process.exit(1);
}
console.log(`结论：产物自洽判据 ${String(notes.length)} 条全过`);
