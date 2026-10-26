#!/usr/bin/env node
/**
 * 服务端凭据页与它的脚本，必须在**在服务的边缘**上被代理到同步服务端（常驻门禁，纯读盘）。
 *
 * ## 为什么要有这条
 *
 * `server/src/pages.ts` 每注册一张凭据页（`/verify-email`、`/reset-password` …），
 * 边缘就要多一条把那个路径代理到 `127.0.0.1:1900` 的规则。这两处**隔着一个仓库边界**：
 * 加页面的人在 `pages.ts` 里写 `fastify.get('/reset-password')`，构建过、测过、上线了，
 * 而边缘那片是另一个文件、由另一次改动决定 —— 于是没有任何一步会失败。
 *
 * 症状不是报错，是**用户点开邮件里的链接得到一张 404**。2026-10-26 实测：
 * `/reset-password` 与 `/change-email` 在 `heyta.waytofuture.cn` 上都是 404，
 * 而同一族的 `/verify-email`、`/magic-login`、`/recover-passkey` 是 400
 * （400 = 缺 `?token=`，说明那三条**代理是通的**）。差别的唯一来源是边缘那两条
 * 写死的正则里没被加进来 —— 落地页的兜底是诚实 404，所以这次连"200 但内容是别的页"
 * 都没有，直接是一个打不开的重置密码入口。
 *
 * 这一族在本仓库已经被数过七次（`server/deploy/nginx/heyta.waytofuture.cn.conf`
 * 的注释里逐条记着 `/health`、`/terms.html`、`/*.js`、`/en/assets`、`/legal/*` …），
 * 每一次的根因都是同一个：**边缘的白名单是手写的枚举，而它要覆盖的集合长在代码里**。
 * 本脚本把那两句"要一起对"的话变成一把尺 —— 枚举在代码里，比对在 CI 里。
 *
 * ## 判据（四条，逐条可失败）
 *
 *  ① `pages.ts` 里每张凭据页的路径，必须被边缘上某条**代理到 1900** 的规则覆盖。
 *     缺 ⇒ 红：那张页的邮件链接点开是 404。
 *  ② `pages.ts` 里每张页 `scripts: [...]` 引用的脚本，同样必须被覆盖。
 *     缺 ⇒ 红：只代页不代脚本 = 页面画得出来、按钮是死的（`/recover-passkey.js`
 *     那一事故的原文形状）。
 *  ③ 反向对账：边缘上代理到 1900 的**精确**路径，除 `NON_CREDENTIAL_UPSTREAMS`
 *     那几张已知服务端页外，必须真的对应 `pages.ts` 里的一张页或一个脚本。
 *     多出来的 ⇒ 红：那是"页已经没了、代理还留着"，下一个人会以为它还在服务。
 *  ④ **阳性对照**：两侧都必须读到非空集合，且 `pages.ts` 至少有一张页引用脚本。
 *     读不到就 `exit 2` 报探针，而不是报"全部合规"（§7 元规则一：先怀疑探针；
 *     空对空会判绿）。
 *
 * ## 为什么**不**查 `server/deploy/nginx/`
 *
 * 那一份（连同 `heyta.finlaw.cloud.conf`）自 2026-10-24 起是**死配置**：本域名由
 * `caddy-edge` 服务，`nginx.service` 是 masked（现量：`ssh finlaw 'ss -ltnp | grep :443'`）。
 * 它的定位是"线上文件的逐字节镜像"，`nginx-sync.sh --check` 靠它报漂移 ——
 * 往一个没人读的文件里补规则，除了制造一次假漂移什么都不改变。
 * 2026-10-25 上线 `/admin` 时已经为这一枚白跑过一趟 `--apply`（见
 * `server/deploy/caddy/README.md`）。所以这把尺**只钉在真的在服务的边缘上**。
 *
 * `--self-test` 用夹具逐臂证明每条真会红、干净夹具真不红（臂数由它自己打印，文档里不许抄）。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { stripTsComments } from './lib/strip-ts-comments.mjs';

const argv = process.argv.slice(2);
const rootFlag = argv.indexOf('--root');
const ROOT = rootFlag >= 0 && argv[rootFlag + 1] ? resolve(argv[rootFlag + 1]) : process.cwd();

const PAGES = 'server/src/pages.ts';
const EMAIL = 'server/src/email.ts';
const EDGE = 'server/deploy/caddy/sites.d/00-heyta.caddy';
/** 邮件里允许出现的**非凭据页**目的地：应用本体（`/app/` 与它的 `?signin=1` 深链）。
 *  它由边缘从磁盘服务，不经 1900，所以不能拿代理白名单去要求它。 */
const APP_ROUTE = '/app/';
/** 代理到 1900、但**不是**凭据页的服务端路径（健康检查与法务页，形状与凭据页无关）。 */
const NON_CREDENTIAL_UPSTREAMS = new Set(['/health', '/live', '/terms.html', '/privacy.html']);

/** 从 `pages.ts` 读"需要被边缘代理的路径"：每张凭据页 + 它引用的每个脚本。
 *  顺带产出**页→它自己那几支脚本**的映射：线上验收要拿它判"这张页服务的是不是它自己"
 *  （只看"正文不等于落地页"判不出两张凭据页互换了）。按位置配对：一张页的 `scripts: [...]`
 *  写在它自己那次 `fastify.get(...)` 之后、下一张页之前。 */
function readPages(src) {
  const code = stripTsComments(src);
  const pages = new Set();
  const pageScripts = {};
  const scripts = new Set();
  for (const m of code.matchAll(/fastify\s*\.\s*get\s*(?:<[^)]*>)?\s*\(\s*'(\/[a-z0-9-]+)'/g)) {
    pages.add(m[1]);
    const own = [];
    const after = code.slice(m.index);
    const next = after.slice(1).search(/fastify\s*\.\s*get\s*(?:<[^)]*>)?\s*\(\s*'/);
    const block = next < 0 ? after : after.slice(0, next + 1);
    const s = block.match(/scripts\s*:\s*\[([^\]]*)\]/);
    if (s) for (const x of s[1].matchAll(/'(\/[^']+\.js)'/g)) { own.push(x[1]); scripts.add(x[1]); }
    pageScripts[m[1]] = own;
  }
  return { pages, scripts, pageScripts };
}

/**
 * 从 `email.ts` 读**发出去的信里到底写了哪些地址**（去重后的 pathname）。
 *
 * 为什么分母要长在这里而不是写一份清单：本条要防的正是"信里写了个打不开的地址"。
 * 抄的清单会在下一个发信功能上失效 —— 而那与本轮那两张 404 的页是同一件事。
 * 形状：`` `${config.publicUrl}/verify-email?token=${token}` ``，
 * 所以取 `publicUrl}` 之后、遇到下一个 `$` 或反引号之前的那一段。
 */
function readEmailLinks(src) {
  const paths = new Set();
  for (const m of stripTsComments(src).matchAll(/config\.publicUrl\}([^`$]*)/g)) {
    const path = m[1].split('?')[0];
    if (path.startsWith('/')) paths.add(path);
  }
  return paths;
}

/** 把一条 `path_regexp` 的形状展开成精确路径；展不开（前缀式/通配）就返回空。 */
function expandRegexp(pattern) {
  const m = pattern.match(/^\^\/\(([^)]+)\)(.*)\$$/);
  if (!m) return [];
  return m[1].split('|').map((alt) => `/${alt}${m[2].replace(/\\/g, '')}`);
}

/** 从边缘片段读"实际被代理到同步服务端的路径"。 */
function readEdge(src) {
  const matchers = new Map();
  const lines = src.split('\n');
  const proxied = new Set();
  let depth = 0;
  let openHeader = null;
  let openDepth = 0;
  let buffer = [];
  for (const line of lines) {
    // 只在站点这一层收匹配器与 handle：`handle /legal/*` 里面那层 `@dirLegal {`
    // 是块内局部匹配器，它的值不是路径，收进来只会污染对账。
    if (depth === 1) {
      const m = line.match(/^\s*@(\w+)\s+(.*)$/);
      if (m) matchers.set(`@${m[1]}`, m[2]);
      const header = line.match(/^\s*handle(?:_path)?\s+(\S+)\s*\{\s*$/);
      if (header) {
        openHeader = header[1];
        openDepth = depth;
        buffer = [];
      }
    }
    if (openHeader !== null) buffer.push(line);
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
    if (openHeader !== null && depth === openDepth) {
      if (buffer.some((l) => /reverse_proxy\s+127\.0\.0\.1:1900\b/.test(l))) {
        const source = openHeader.startsWith('@') ? (matchers.get(openHeader) ?? '') : openHeader;
        const regexp = source.match(/path_regexp\s+\w+\s+(.*)$/);
        if (regexp) for (const p of expandRegexp(regexp[1].trim())) proxied.add(p);
        // 精确 handle 里只认"一个带扩展名的文件"这种形态。`[a-z0-9._-]*` 是为了
        // `/simplewebauthn-browser.min.js` 这种**两个点**的文件名 —— 只写一个 `\.[a-z]+$`
        // 会把一条本来存在的代理量成缺失（尺的假红，不是对象的缺陷）。
        // `/api/*`、`/app*`、`/admin` 都匹配不上这里，所以不会被误当成精确路径。
        else if (/^\/[a-z0-9][a-z0-9._-]*\.[a-z]{2,}$/.test(openHeader)) proxied.add(openHeader);
      }
      openHeader = null;
      buffer = [];
    }
  }
  return proxied;
}

/** 算出四条判据的读数；`violations` 为空即绿。`probe` 为真表示探针本身不成立。 */
function evaluate({ pages, scripts, emailPaths, proxied }) {
  const violations = [];
  const probe = [];
  if (pages.size === 0) probe.push(`${PAGES} 里一张凭据页都没读到 —— 探针不成立，不是"全部合规"`);
  if (scripts.size === 0) probe.push(`${PAGES} 里一个 scripts: [...] 都没读到 —— 探针不成立`);
  if (proxied.size === 0) probe.push(`${EDGE} 里一条代理到 1900 的精确路径都没读到 —— 探针不成立`);
  if (emailPaths.size === 0) probe.push(`${EMAIL} 里一个 publicUrl 链接都没读到 —— 探针不成立`);
  if (probe.length) return { violations, probe, pages, scripts, emailPaths, proxied };

  for (const p of [...pages].sort()) {
    if (!proxied.has(p)) {
      violations.push(`① 凭据页 ${p} 没有被边缘代理到 1900 ⇒ 发到用户邮箱里的 ${p}?token=… 点开是 404`);
    }
  }
  for (const s of [...scripts].sort()) {
    if (!proxied.has(s)) {
      violations.push(`② 凭据页脚本 ${s} 没有被边缘代理到 1900 ⇒ 页面画得出来、按钮是死的（一次请求都不发）`);
    }
  }
  for (const p of [...emailPaths].sort()) {
    if (p !== APP_ROUTE && !pages.has(p)) {
      violations.push(`⑤ ${EMAIL} 往用户邮箱里发 ${p}，但 ${PAGES} 里没有这张页、也不是 ${APP_ROUTE} ⇒ 那封信点开必然打不开`);
    }
  }
  const known = new Set([...pages, ...scripts]);
  for (const p of [...proxied].sort()) {
    if (!known.has(p) && !NON_CREDENTIAL_UPSTREAMS.has(p)) {
      violations.push(`③ 边缘把 ${p} 代理到 1900，但 ${PAGES} 里没有这张页/脚本 ⇒ 孤儿代理，删掉它或把页加回来`);
    }
  }
  return { violations, probe, pages, scripts, emailPaths, proxied };
}

function readBoth(root) {
  return {
    ...readPages(readFileSync(join(root, PAGES), 'utf8')),
    emailPaths: readEmailLinks(readFileSync(join(root, EMAIL), 'utf8')),
    proxied: readEdge(readFileSync(join(root, EDGE), 'utf8')),
  };
}

if (argv.includes('--self-test')) {
  const fixture = join(process.cwd(), '.tmp-check-credential-page-routes');
  rmSync(fixture, { recursive: true, force: true });
  const arms = [];
  const plant = (name, mutate) => {
    const dir = join(fixture, name);
    mkdirSync(join(dir, 'server/src'), { recursive: true });
    mkdirSync(join(dir, 'server/deploy/caddy/sites.d'), { recursive: true });
    mkdirSync(join(dir, 'scripts/lib'), { recursive: true });
    writeFileSync(join(dir, 'scripts/lib/strip-ts-comments.mjs'), 'export const stripTsComments = (s) => s;\n');
    const pagesPath = join(dir, PAGES);
    const emailPath = join(dir, EMAIL);
    const edgePath = join(dir, EDGE);
    writeFileSync(emailPath, readFileSync(join(ROOT, EMAIL), 'utf8'));
    writeFileSync(pagesPath, readFileSync(join(ROOT, PAGES), 'utf8'));
    writeFileSync(edgePath, readFileSync(join(ROOT, EDGE), 'utf8'));
    mutate(pagesPath, edgePath, emailPath);
    const run = spawnSync(process.execPath, [resolve('scripts/check-credential-page-routes.mjs'), '--root', dir], { encoding: 'utf8' });
    arms.push({ name, code: run.status, out: `${run.stdout}${run.stderr}` });
  };
  plant('clean', () => {});
  plant('drop-a-page', (_p, e) => {
    writeFileSync(e, readFileSync(e, 'utf8').replace('verify-email|', ''));
  });
  // 🔴 抽脚本的臂**只许**动 `@credJs` 那一行。写成 `reset-password|` 会连 `@credPages`
  //    一起改掉，于是这一臂实际证明的是"少一张页会红"（另一臂已经证过了），
  //    而它声称的"少一个脚本会红"从没被量过。
  plant('drop-a-script', (_p, e) => {
    writeFileSync(e, readFileSync(e, 'utf8').replace('magic-login-confirm|reset-password|', 'magic-login-confirm|'));
  });
  plant('orphan-proxy', (_p, e) => {
    writeFileSync(e, readFileSync(e, 'utf8').replace('verify-email|', 'verify-email|gone-away|'));
  });
  /*
    ⑤ 的臂：把信里一枚目的地换成**没有对应页面**的地址（本轮那两张 404 的页就是这个形状）。
    🔴 必须动 `email.ts` —— ⑤ 的分母读的是发信侧。第一版把这枚改动种进了 `pages.ts`，
    而 `pages.ts` 里多一个**裸字符串**并不会注册出一张页（读页面靠的是 `fastify.get(...)` 的形状），
    于是那一臂安静地退化成"什么都没发生"、退码 0，看起来像"⑤ 没有牙"。
    它其实有牙，是臂种错了文件 —— 这种"臂不红"要先怀疑臂，再怀疑尺。
  */
  plant('email-to-nowhere', (_p, _e, em) => {
    writeFileSync(em, readFileSync(em, 'utf8').replace(
      'config.publicUrl}/verify-email',
      'config.publicUrl}/no-such-mail-target',
    ));
  });
  plant('empty-edge', (_p, e) => {
    writeFileSync(e, readFileSync(e, 'utf8').replace(/127\.0\.0\.1:1900/g, '127.0.0.1:9999'));
  });
  rmSync(fixture, { recursive: true, force: true });
  // 每臂既要对退码，也要对**报的是哪一条判据** —— 只比退码会让"因为别的原因红"混过去。
  const expect = {
    clean: { code: 0, mark: '' },
    'drop-a-page': { code: 1, mark: '① 凭据页 /verify-email' },
    'drop-a-script': { code: 1, mark: '② 凭据页脚本 /reset-password.js' },
    'orphan-proxy': { code: 1, mark: '③ 边缘把 /gone-away' },
    'email-to-nowhere': { code: 1, mark: '⑤ server/src/email.ts 往用户邮箱里发 /no-such-mail-target' },
    'empty-edge': { code: 2, mark: '探针不成立' },
  };
  let bad = 0;
  for (const arm of arms) {
    const want = expect[arm.name];
    const codeOk = arm.code === want.code;
    const markOk = want.mark === '' || arm.out.includes(want.mark);
    const ok = codeOk && markOk;
    if (!ok) bad += 1;
    const first = arm.out.trim().split('\n').find((l) => l.trim().startsWith('·')) ?? '';
    console.log(`${ok ? '✅' : '❌'} ${arm.name}: exit ${arm.code}（期望 ${want.code}）` +
      `${markOk ? '' : ` 🔴 没报到它声称的那条判据「${want.mark}」`}${first ? `\n     ${first.trim()}` : ''}`);
  }
  console.log(`\nself-test ${arms.length} 臂，${bad} 臂不符`);
  process.exit(bad === 0 ? 0 : 1);
}

let reading;
try {
  reading = readBoth(ROOT);
} catch (err) {
  console.error(`❌ 读不到判据的输入：${err.message}`);
  process.exit(2);
}
const { violations, probe, pages, scripts, emailPaths, proxied } = evaluate(reading);

// 🔴 `--json` 是**分母的唯一出口**：`e2e/live-site/live-credential-pages.spec.ts` 从这里取
//    "该在线上量哪些路径"。线上判据若自己抄一份清单，加第 6 张页时它会像这一族的前五次一样
//    静默漏掉 —— 清单必须长在代码那一侧。
if (argv.includes('--json')) {
  console.log(JSON.stringify({
    pages: [...pages].sort(),
    scripts: [...scripts].sort(),
    emailPaths: [...reading.emailPaths].sort(),
    proxied: [...proxied].sort(),
    // 页→自己那几支脚本。线上验收用它判"这张页服务的是不是它自己"，
    // 所以它必须和上面三枚出自**同一次读盘**，不能由那份 spec 自己再抄一遍。
    pageScripts: Object.fromEntries(Object.entries(reading.pageScripts ?? {}).sort()),
  }));
  process.exit(0);
}

if (probe.length) {
  console.error(`❌ 探针不成立（${PAGES} / ${EDGE}）：\n  ${probe.join('\n  ')}`);
  process.exit(2);
}
if (violations.length) {
  console.error(`❌ 凭据页与边缘代理白名单对不上（页 ${pages.size} 张 / 脚本 ${scripts.size} 个 / 边缘精确路径 ${proxied.size} 条）：`);
  for (const v of violations) console.error(`  · ${v}`);
  console.error(`\n  修法：在 ${EDGE} 的 @credPages / @credJs 里补上缺的那几枚，`);
  console.error('  再跑 server/scripts/caddy-sync.sh --apply，最后用 curl 复验状态码不是 404。');
  process.exit(1);
}
console.log(`✅ 凭据页对账通过：${pages.size} 张页 + ${scripts.size} 个脚本全部被边缘代理到 1900（边缘精确路径 ${proxied.size} 条，无孤儿）`);
