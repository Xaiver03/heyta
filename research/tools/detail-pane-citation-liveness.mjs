#!/usr/bin/env node
/**
 * 详情面调研文档的**出处对账**：把文中每一条外链真的取一次，按"取到了什么"分类。
 *
 * 为什么需要它（不是顺手加的）：`docs/research/detail-pane-alignment-and-spaced-review.md`
 * 的 C1 表是五格拍板的依据面，而常驻门禁 `check:detail-pane-c1-coverage` 判的是
 * **每个对照节有没有外部锚**（形状），它**不取 URL** —— 也就是说"锚在，但锚指向 404"
 * 这一档今天没有任何东西在看。本脚本量的正是那一档。
 *
 * 🔴 它**不是**门禁，也不进 `pnpm check`：判据依赖外网与对端反爬策略，
 * 拿它拦提交会得到一批与文档质量无关的红。跑法与 `verify:legal-links` 同档：显式调用。
 *
 * 分类口径（每一条都写进输出，不许只报"失败 N 条"）：
 *   LIVE        最终 2xx/3xx 且没被重定向到别的站点
 *   REDIRECT    最终 2xx 但发生过重定向（同站换 slug 也算，要打出来给人看一眼落点）
 *   BLOCKED     403/429/503 —— **对端反爬**，不是"链接坏了"，不许混进 DEAD
 *   DEAD        404/410 或 DNS/连接失败 —— 这才是要在文档里改的那一档
 *   OTHER       其余状态码（逐条列出，不归类）
 *
 * 退出码：0 = 没有 DEAD；1 = 有 DEAD（逐条点名）；2 = 探针自己不可用（文档读不到 / 一条 URL 都没解析出来）
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

const root = (() => {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    return process.cwd();
  }
})();
const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const DEFAULT_DOC = 'docs/research/detail-pane-alignment-and-spaced-review.md';
const DOC = !arg ? join(root, DEFAULT_DOC) : isAbsolute(arg) ? arg : join(root, arg);

let text = '';
try {
  text = readFileSync(DOC, 'utf8');
} catch (e) {
  console.log(`VERDICT=PROBE_BROKEN 读不到文档 ${DOC}：${String(e.message).split('\n')[0]}`);
  process.exit(2);
}
// markdown 里 URL 常写成 [文本](https://…) 或直接 `https://…`，而正文紧跟中文标点与反引号。
// 🔴 两件事都要做，缺一件就把"活的出处"读成死链（本轮实测 12 条 DEAD 里 9 条是这么来的）：
//   ① 在第一个**反引号 / 引号 / 空白 / 中文标点**处截断 —— ⚠️ ASCII 冒号**不是**截断字符，
//      它是 scheme 的一部分（把 `:` 放进切分集合会让每条 URL 都变成 "https"，
//      然后被格式过滤器全部丢掉，探针看起来"活着"而分母是 0）；
//   ② 括号要**配平**：Wikipedia 的 `Anki_(software)` 若按"右括号一律不算 URL 的一部分"切，
//      会得到 `Anki_(software` —— 那是真 404，而原链接是活的。
const cut = (u) => {
  // 切分集合里**必须有汉字本身**（`\u4e00-\u9fff`），不能只放中文标点：
  // 实测第三趟的分母自检抓到 `[文本](https://…html)界定` 这种写法 —— 右括号后面紧跟汉字、中间没有空格，
  // 只切标点的话 `界定` 会粘在 URL 上，而它看起来"像一条 URL"，于是又被判成一条假死链。
  let x = (u.split(/[`"'\s\u4e00-\u9fff（），。、：；「」]/)[0] || '').replace(/[.,;:!?]+$/, '');
  // 收尾要**反复剥到不动点**，三种尾巴会互相挡：
  //   `…/Anki_(software)>)` —— CommonMark 的角括号目标 `<…>` 与链接的右括号叠在一起。
  //   先剥 `>` 的话会被那个 `)` 挡住，先剥 `)` 的话剩下的 `>` 又让这条真 URL 被误判成模板
  //   （实测它就是这样从分母里**消失**的 —— 既不在可取集合也不在模板清单的 tail 里）。
  for (;;) {
    const before = x;
    if (x.endsWith('>')) x = x.slice(0, -1);
    while (x.endsWith(')') && (x.match(/\)/g) || []).length > (x.match(/\(/g) || []).length) x = x.slice(0, -1);
    x = x.replace(/[.,;:!?]+$/, '');
    if (x === before) break;
  }
  return x;
};
// 🔴 第三类不是"死链"也不是"探针坏了"，而是**模板 URL**：文档里写的是取法，不是可取的地址 ——
// 实测本档有两条：`…/human-interface-guidelines/<slug>.json`（Apple HIG 正文通道）与
// `https://help.dida365.com/articles/<任一 id>`。它们含 `<…>` ⇒ 单独归一档 **TEMPLATE，不发请求**。
// 把它们算进 DEAD 会得到"文档有死链"这个假结论；把它们悄悄丢掉又会让分母少两枚而没人知道。
// 🔴 匹配集合里必须**排除汉字与全角标点**（不只是截断层排除）。
// 实测：同一行连着两条链接 `…/wiki/Anki)、[Anki（软件）](<…/wiki/Anki_(software)>)` ——
// 只让截断层管中文的话，第一条的 match 会一路吞到下一个空白，把**第二条整条 URL 吃进自己肚子里**，
// 于是分母少一枚而没有任何东西报红（截断层随后把它切成第一条，看起来完全正常）。
const raw = text.match(/https?:\/\/[^\s`"'[\]一-鿿　-〿＀-￯]+/g) || [];
const parsed = [...new Set(raw.map(cut))];
const isTemplate = (u) => u.includes('<') || u.includes('>');
const templates = parsed.filter(isTemplate);
const urls = parsed.filter((u) => !isTemplate(u) && /^https?:\/\/[^\s]+\.[^\s]+$/.test(u));
// 🔴 分母自检：解析结果里只要还剩反引号、引号或**任何中日韩字符**，那就是**截断层坏了**，
// 不是"文档里有个带这些字符的 URL"。必须响亮失败，不许拿脏分母去判生死 ——
// 本装置头两趟各踩了一次这个形状：第一趟没切反引号与中文标点（12 条"死链"里 9 条是脏的），
// 第二趟修第一趟时把 `>` 从切分集合里丢了（`<https://…>` 这种自动链接全部带尾 `>` ⇒ 31 条"死链"）。
// 症状一模一样：一批 404。差别只在**是谁**的 URL 被拼坏了。
const dirty = urls.filter((u) => /[`"'（）【】、，。：；\u3000-\u303f\u4e00-\u9fff]/.test(u));
if (dirty.length > 0) {
  console.log(`VERDICT=PROBE_BROKEN 解析出 ${dirty.length} 条含非法字符的 URL —— 先修截断，别拿脏分母判生死：`);
  for (const d of dirty.slice(0, 10)) console.log(`  ${JSON.stringify(d)}`);
  process.exit(2);
}
// `--list`：只打印解析出来的分母就退出。加这一档的理由不是省事 ——
// 上一版探针把 ASCII 冒号当截断字符时，**分母静默变成 0**，而"0 条里 0 条死"看起来是绿的。
// 这一档让"解析层坏了"与"链接都活着"在输出上长得不一样。
if (process.argv.includes('--list')) {
  for (const u of urls) console.log(u);
  for (const t of templates) console.log(`TEMPLATE ${t}`);
  console.log(`URLS_PARSED=${urls.length} TEMPLATE=${templates.length}`);
  process.exit(0);
}
if (urls.length === 0) {
  console.log(`VERDICT=PROBE_BROKEN ${DOC} 里解析出 0 条 URL —— 空集合上"全部存活"是永真的，拒绝报绿。`);
  process.exit(2);
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const probe = (url, follow) => {
  const args = [
    '-sS',
    '-o',
    '/dev/null',
    '--max-time',
    '25',
    '-A',
    UA,
    '-w',
    '%{http_code}\t%{url_effective}\t%{redirect_url}',
  ];
  if (follow) args.push('-L');
  args.push(url);
  try {
    const out = execFileSync('curl', args, { encoding: 'utf8' }).trim();
    const [code, effective, redirect] = out.split('\t');
    return { code: Number(code), effective: effective || url, redirect: redirect || '', err: '' };
  } catch (e) {
    return { code: 0, effective: url, redirect: '', err: String(e.message).split('\n')[0].slice(0, 90) };
  }
};

const classify = (u) => {
  const first = probe(u, false);
  const final = first.code >= 300 && first.code < 400 ? probe(u, true) : first;
  const c = final.code;
  const movedHost = () => {
    try {
      return new URL(final.effective).host !== new URL(u).host;
    } catch {
      return false;
    }
  };
  let kind = 'OTHER';
  // 🔴 "跟着跳就失败" 与 "这条 URL 是死的" 不是一件事，而它们在旧版输出里长得一样（都是 DEAD）。
  // 实测：developer.android.com 的两条规范页对匿名请求返回 302 → accounts.google.com/oauth2，
  // 跟进去是 50 跳的登录回路 ⇒ curl 以 (47) 退出。那是**对端把探针挡在门外**，不是文档写了个死链。
  // 判据：首发是 3xx、跟随失败（code 0），且首发报出的那一跳落在登录/OAuth 端点 ⇒ BLOCKED。
  const loginLoop =
    c === 0 && first.code >= 300 && first.code < 400 && /accounts\.google\.com|oauth|login|signin/i.test(first.redirect);
  if (loginLoop) kind = 'BLOCKED';
  else if (c === 0) kind = 'DEAD';
  else if (c === 404 || c === 410) kind = 'DEAD';
  else if (c === 403 || c === 429 || c === 503) kind = 'BLOCKED';
  else if (c >= 200 && c < 300) kind = first.code !== c || movedHost() ? 'REDIRECT' : 'LIVE';
  else if (c >= 300 && c < 400) kind = 'REDIRECT';
  return { url: u, first: first.code, final: c, effective: final.effective, kind, err: final.err };
};

// 并发压到 8：这是对端站点，不是本地测试。
const results = [];
const queue = [...urls];
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (queue.length) results.push(classify(queue.shift()));
  }),
);
results.sort((a, b) => a.kind.localeCompare(b.kind) || a.url.localeCompare(b.url));

const by = (k) => results.filter((r) => r.kind === k);
for (const r of results) {
  if (r.kind === 'LIVE') continue;
  console.log(`${r.kind.padEnd(8)} ${r.first}→${r.final} ${r.url}${r.err ? ` [${r.err}]` : ''}`);
  if (r.kind === 'REDIRECT' || r.kind === 'DEAD') console.log(`         落点 ${r.effective}`);
}
for (const t of templates) console.log(`TEMPLATE 不取（写的是取法，不是地址） ${t}`);
console.log(
  `分母：可取 URL ${urls.length} 条 + 模板 ${templates.length} 条｜LIVE=${by('LIVE').length} ` +
    `REDIRECT=${by('REDIRECT').length} BLOCKED=${by('BLOCKED').length} DEAD=${by('DEAD').length} ` +
    `OTHER=${by('OTHER').length}`,
);
const out = join(tmpdir(), 'dp-citations.json');
writeFileSync(
  out,
  JSON.stringify({ doc: DOC, at: new Date().toISOString(), templates, results }, null, 1),
  'utf8',
);
console.log(`明细 JSON=${out}`);
if (by('DEAD').length) {
  console.log('VERDICT=DEAD 有出处取不到，逐条点名见上');
  process.exit(1);
}
console.log('VERDICT=OK 没有 DEAD（BLOCKED 与 REDIRECT 仍需人看一眼，已逐条打印）');
